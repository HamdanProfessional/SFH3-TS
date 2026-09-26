#!/usr/bin/env python3
from __future__ import annotations

import math
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from devurl import goto_menu, wait_for_art

URL = os.environ.get("SFH3_URL", "http://localhost:5174/")
SHOTS = os.path.join(REPO, "shots")

PRIZE, WEAPON, QUALITY, SPINS = 0, 1, 2, 3

OPEN = """() => {
  const D = window.sfh3Dev, SD = D.SD;
  SD.stages = [0,1,2,3,4,5,6,7,8,9,10,11];
  SD.funds = 900000;
  SD.mapItem = [];
  SD.storeItem = null;
  window.__sfh3.screen.goto('store');
  return {funds: SD.funds, built: SD.bpBuilt.length};
}"""

SPIN_HIT = """() => {
  const p = window.__sfh3.screen.page || window.__sfh3.screen.curPage;
  const h = p.spinHit;
  const g = p.view.toGlobal({x: h[0], y: h[1]});
  return [+g.x.toFixed(2), +g.y.toFixed(2), +h[2].toFixed(2), +h[3].toFixed(2)];
}"""

BTN = """(name) => {
  const p = window.__sfh3.screen.page || window.__sfh3.screen.curPage;
  const b = p[name];
  if (!b) return null;
  const g = p.view.toGlobal({x: b.hit[0], y: b.hit[1]});
  return [+g.x.toFixed(2), +g.y.toFixed(2), b.hit[2], b.hit[3], b.enabled];
}"""

ROW = """(i) => {
  const p = window.__sfh3.screen.page || window.__sfh3.screen.curPage;
  const r = p.filterRows && p.filterRows[i];
  if (!r) return null;
  const at = (h) => {
    const g = p.view.toGlobal({x: h[0], y: h[1]});
    return [+g.x.toFixed(2), +g.y.toFixed(2), h[2], h[3]];
  };
  return {enabled: r.btn.enabled, prev: at(r.prev), next: at(r.next)};
}"""

PANEL = """() => {
  const p = window.__sfh3.screen.page || window.__sfh3.screen.curPage;
  const txt = [];
  const walk = (c) => { for (const ch of c.children) {
    if (typeof ch.text === 'string') txt.push(ch.text); walk(ch); } };
  walk(p.view);
  const rows = {};
  for (const name of ['PRIZE', 'WEAPON', 'QUALITY', 'SPINS']) {
    const i = txt.indexOf(name);
    if (i >= 0) {
      rows[name] = {value: (txt[i + 1] || '').replace(/[\\u2039\\u203a]/g, '').trim(),
                    right: txt[i + 2] || ''};
    }
  }
  return {rows, odds: txt.find((t) => t.includes('1 spin in')) || '',
          warn: txt.find((t) => t.includes('blanks') || t.includes('blueprint')) || '',
          price: txt.find((t) => /^\\$[\\d,]+$/.test(t)) || '', txt};
}"""

STATE = """() => {
  const D = window.sfh3Dev, SD = D.SD;
  const p = window.__sfh3.screen.page || window.__sfh3.screen.curPage;
  const txt = [];
  const walk = (c) => { for (const ch of c.children) {
    if (ch.text) txt.push(ch.text); walk(ch); } };
  walk(p.view);
  return {funds: SD.funds, queued: SD.mapItem.length,
          storeItem: SD.storeItem ? String(SD.storeItem.id || SD.storeItem) : null,
          modal: window.__sfh3.screen.getItem.isOpen, txt};
}"""

TAKE = """() => {
  const m = window.__sfh3.screen.getItem;
  if (!m.isOpen || !m.okHit) return null;
  const g = m.toGlobal({x: m.okHit[0], y: m.okHit[1]});
  return [+g.x.toFixed(2), +g.y.toFixed(2), m.okHit[2], m.okHit[3]];
}"""

QUEUE = """() => {
  const SD = window.sfh3Dev.SD;
  return {funds: SD.funds, queued: SD.mapItem.map((v) => (
    typeof v === 'string' ? {id: v, type: null, rarity: null}
      : {id: v.id, type: v.stats ? v.stats.type : null, rarity: v.rarity}))};
}"""


def click(pg, scale, rect):
    pg.mouse.click((rect[0] + rect[2] / 2) * scale,
                   (rect[1] + rect[3] / 2) * scale)


def step(pg, scale, row, direction="next", n=1):
    for _ in range(n):
        r = pg.evaluate(ROW, row)
        if not r or not r["enabled"]:
            return None
        click(pg, scale, r[direction])
        time.sleep(0.35)
    return pg.evaluate(PANEL)


def money(s):
    m = re.search(r"\$([\d,]+)", s or "")
    return int(m.group(1).replace(",", "")) if m else None


def mult(s):
    m = re.search(r"×([\d.]+)", s or "")
    return float(m.group(1)) if m else 1.0


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(SHOTS, exist_ok=True)
    bad = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(pg, URL)
        time.sleep(1.0)
        print("open:", pg.evaluate(OPEN))
        wait_for_art(pg)
        time.sleep(1.5)
        scale = pg.evaluate("() => window.__sfh3.app.renderer.canvas.width"
                            " / window.__sfh3.app.renderer.width")

        base = money(pg.evaluate(PANEL)["price"])
        print("base spin price:", base)

        hit = pg.evaluate(SPIN_HIT)
        click(pg, scale, hit)
        time.sleep(0.6)
        p = pg.evaluate(PANEL)
        print("chooser opened:")
        for k, v in p["rows"].items():
            print(f"   {k:<8} {v['value']:<14} {v['right']}")
        print("   odds:", p["odds"])
        print("   note:", p["warn"])
        path = os.path.join(SHOTS, "slots_choose.png")
        pg.screenshot(path=path)
        print("wrote", path)

        if len(p["rows"]) != 4:
            bad.append(f"chooser drew {len(p['rows'])} rows, want 4")
        if p["rows"].get("PRIZE", {}).get("value") != "Anything":
            bad.append("chooser did not open unfiltered")
        for i, name in ((WEAPON, "WEAPON"), (QUALITY, "QUALITY")):
            r = pg.evaluate(ROW, i)
            if r and r["enabled"]:
                bad.append(f"{name} row is live with no weapon selected")
        unfiltered = money(p["rows"]["SPINS"]["right"])
        if unfiltered != base:
            bad.append(f"unfiltered spin priced {unfiltered}, want {base}")

        p = step(pg, scale, PRIZE)
        print(f"\nPRIZE -> {p['rows']['PRIZE']['value']} "
              f"{p['rows']['PRIZE']['right']}  "
              f"total {p['rows']['SPINS']['right']}")
        if p["rows"]["PRIZE"]["value"] != "Weapon":
            bad.append("PRIZE did not step to Weapon")
        for i, name in ((WEAPON, "WEAPON"), (QUALITY, "QUALITY")):
            r = pg.evaluate(ROW, i)
            if not (r and r["enabled"]):
                bad.append(f"{name} row still off with a weapon selected")

        p = step(pg, scale, WEAPON)
        want_type = p["rows"]["WEAPON"]["value"]
        print(f"WEAPON -> {want_type} {p['rows']['WEAPON']['right']}  "
              f"total {p['rows']['SPINS']['right']}")
        if want_type == "Any":
            bad.append("WEAPON did not step off Any")

        p = step(pg, scale, QUALITY, n=3)
        want_rarity = p["rows"]["QUALITY"]["value"]
        print(f"QUALITY -> {want_rarity} {p['rows']['QUALITY']['right']}  "
              f"total {p['rows']['SPINS']['right']}")
        if want_rarity != "CUSTOM":
            bad.append(f"QUALITY landed on {want_rarity}, want CUSTOM")
        print("   odds:", p["odds"])

        rows = p["rows"]
        prod = (mult(rows["PRIZE"]["right"]) * mult(rows["WEAPON"]["right"])
                * mult(rows["QUALITY"]["right"]))
        shown = money(rows["SPINS"]["right"])
        want = math.ceil(base * prod)
        print(f"\nrows multiply to x{prod:.2f}; {base} -> {want}, "
              f"button says {shown}")
        if not shown or abs(shown - want) > want * 0.08:
            bad.append(f"SPIN button says {shown}, rows imply {want}")

        pg.screenshot(path=os.path.join(SHOTS, "slots_filtered.png"))
        print("wrote", os.path.join(SHOTS, "slots_filtered.png"))

        funds0 = pg.evaluate(STATE)["funds"]
        click(pg, scale, pg.evaluate(BTN, "cancelBtn"))
        time.sleep(0.5)
        gone = pg.evaluate(ROW, PRIZE) is None
        after_cancel = pg.evaluate(STATE)["funds"]
        print(f"cancel: chooser gone {gone}, funds {funds0} -> {after_cancel}")
        if not gone:
            bad.append("CANCEL left the chooser up")
        if after_cancel != funds0:
            bad.append("CANCEL charged the player")

        click(pg, scale, pg.evaluate(SPIN_HIT))
        time.sleep(0.6)
        p = pg.evaluate(PANEL)
        kept = (p["rows"]["WEAPON"]["value"], p["rows"]["QUALITY"]["value"])
        print("reopened with:", kept)
        if kept != (want_type, want_rarity):
            bad.append(f"reopening lost the filter: {kept}")

        p = step(pg, scale, SPINS)
        n = p["rows"]["SPINS"]["value"]
        total = money(p["rows"]["SPINS"]["right"])
        print(f"\nSPINS -> {n}, total {total}")
        funds0 = pg.evaluate(STATE)["funds"]
        go = pg.evaluate(BTN, "goBtn")
        print("SPIN button:", go)
        if not go or not go[4]:
            bad.append("SPIN button is not live with funds in hand")
        click(pg, scale, go)
        time.sleep(0.4)
        pg.screenshot(path=os.path.join(SHOTS, "slots_spinning.png"))
        charged = funds0 - pg.evaluate(STATE)["funds"]
        print(f"charged: {funds0} -> {pg.evaluate(STATE)['funds']} "
              f"({charged}, panel said {total})")
        if charged != total:
            bad.append(f"charged {charged}, panel said {total}")

        for _ in range(40):
            time.sleep(0.25)
            if pg.evaluate(BTN, "okBtn"):
                break
        ok = pg.evaluate(BTN, "okBtn")
        print("summary COLLECT:", ok)
        mid = pg.evaluate(STATE)
        print("summary lines:")
        for t in mid["txt"]:
            print("   ", repr(t))
        path = os.path.join(SHOTS, "slots_summary.png")
        pg.screenshot(path=path)
        print("wrote", path)
        if not ok:
            bad.append("the x10 never reached its summary")

        if ok:
            click(pg, scale, ok)
            time.sleep(1.2)
            after = pg.evaluate(QUEUE)
            print("after collect:", len(after["queued"]), "queued, funds",
                  after["funds"])
            path = os.path.join(SHOTS, "slots_collect.png")
            pg.screenshot(path=path)
            print("wrote", path)

            guns = [q for q in after["queued"] if q["type"] is not None]
            print(f"queued weapons: {len(guns)}")
            for q in guns:
                print(f"   {q['id']:<18} type {q['type']}  rarity {q['rarity']}")
            wrong = [q for q in guns if q["rarity"] != 3]
            if wrong:
                bad.append(f"{len(wrong)} of {len(guns)} prizes are not CUSTOM")
            types = {q["type"] for q in guns}
            if len(types) > 1:
                bad.append(f"filtered prizes span categories {sorted(types)}")
            junk = [q for q in after["queued"] if "poop" in str(q["id"]).lower()]
            if junk:
                bad.append(f"poop reached the queue: {junk}")

            taken = 0
            while taken < 24:
                r = pg.evaluate(TAKE)
                if not r:
                    break
                click(pg, scale, r)
                taken += 1
                time.sleep(0.7)
            print(f"reward cards cleared: {taken}")

        while pg.evaluate(TAKE):
            click(pg, scale, pg.evaluate(TAKE))
            time.sleep(1.2)
        for _ in range(6):
            click(pg, scale, pg.evaluate(SPIN_HIT))
            time.sleep(0.6)
            if pg.evaluate(ROW, PRIZE):
                break
        p = step(pg, scale, PRIZE, n=3)
        p = step(pg, scale, SPINS, direction="prev", n=1)
        print(f"\nback to {p['rows']['PRIZE']['value']} / "
              f"{p['rows']['SPINS']['value']}: "
              f"{p['rows']['SPINS']['right']}  ({p['odds']})")
        if p["rows"]["PRIZE"]["value"] != "Anything":
            bad.append("PRIZE did not wrap back to Anything")
        again = money(p["rows"]["SPINS"]["right"])
        if again != base:
            bad.append(f"unfiltered spin is {again} again, want {base}")
        for i, name in ((WEAPON, "WEAPON"), (QUALITY, "QUALITY")):
            r = pg.evaluate(ROW, i)
            if r and r["enabled"]:
                bad.append(f"{name} row stayed live after clearing PRIZE")

        pg.screenshot(path=os.path.join(SHOTS, "slots_unfiltered.png"))
        print("wrote", os.path.join(SHOTS, "slots_unfiltered.png"))

        for e in errs[:3]:
            bad.append(f"pageerror: {e[:160]}")
        b.close()

    print()
    if bad:
        for m in bad:
            print("  !!", m)
        print(f"\n{len(bad)} PROBLEM(S)")
    else:
        print("OK -- the chooser prices, applies and delivers the filter")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
