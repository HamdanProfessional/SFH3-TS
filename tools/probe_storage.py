#!/usr/bin/env python3
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from devurl import goto_menu

URL = os.environ.get("SFH3_URL", "http://localhost:5178/")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shots")


def shot(name):
    os.makedirs(SHOTS, exist_ok=True)
    return os.path.join(SHOTS, name)

SETUP = """(n) => {
  const D = window.sfh3Dev, SD = D.SD;
  SD.storageLevel = 0;
  SD.funds = 5000;
  for (const b of SD.items) b.length = 0;
  for (let i = 0; i < n; i++) {
    const g = D.makeGun(0);
    if (!g) return null;
    SD.items[0].push(g);
  }
  D.setItemCat(0);
  window.__sfh3.screen.goto('inventory');
  return {cat: 0, n: SD.items[0].length};
}"""

STATE = """() => {
  const SD = window.sfh3Dev.SD;
  const p = window.__sfh3.screen.page;
  return {
    lvl: SD.storageLevel,
    cap: SD.itemCap(),
    cost: SD.storageCost(),
    funds: SD.funds,
    first: p.cellHits ? p.cellHits[0].i : -1,
    pager: !!p.pager,
    label: p.storage ? p.storage.text : null,
  };
}"""


def centre(pg, path):
    return pg.evaluate("""(path) => {
      const p = window.__sfh3.screen.page;
      let b = p;
      for (const k of path.split('.')) b = b?.[k];
      if (!b) return null;
      return p.view.toGlobal({x: b.x + b.w / 2, y: b.y + b.h / 2});
    }""", path)


def click(pg, path, fails):
    pt = centre(pg, path)
    if not pt:
        fails.append(f"no control at page.{path}")
        return False
    pg.mouse.move(pt["x"], pt["y"])
    time.sleep(0.4)
    pg.mouse.click(pt["x"], pt["y"])
    time.sleep(1.0)
    return True


def main():
    from playwright.sync_api import sync_playwright

    fails = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 800, "height": 600},
                        device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(pg, URL)
        time.sleep(2.5)

        if not pg.evaluate(SETUP, 30):
            fails.append("could not stock bucket 0")
        time.sleep(1.5)

        st = pg.evaluate(STATE)
        if st["cap"] != 24:
            fails.append(f"fresh cap is {st['cap']}, expected 24")
        if st["cost"] != 5000:
            fails.append(f"first rung costs {st['cost']}, expected 5000")
        if not st["pager"]:
            fails.append("30 items in a 24-cell grid drew no pager")
        if "+10 SLOTS" not in (st["label"] or ""):
            fails.append(f"storage button reads {st['label']!r}")

        click(pg, "storage", fails)
        st = pg.evaluate(STATE)
        if st["lvl"] != 0:
            fails.append("the first click already spent the money")
        if "CONFIRM" not in (st["label"] or ""):
            fails.append(f"the first click did not arm: {st['label']!r}")

        pg.mouse.move(400, 300)
        time.sleep(0.8)
        st = pg.evaluate(STATE)
        if "CONFIRM" in (st["label"] or ""):
            fails.append("moving off the button left it armed")
        if st["lvl"] != 0:
            fails.append("moving off the button spent the money")

        click(pg, "storage", fails)
        st = pg.evaluate(STATE)
        if "CONFIRM" not in (st["label"] or ""):
            fails.append(f"re-arming did not take: {st['label']!r}")
        click(pg, "storage", fails)
        st = pg.evaluate(STATE)
        if st["lvl"] != 1:
            fails.append(f"the second click did not buy (level {st['lvl']})")
        if st["cap"] != 34:
            fails.append(f"cap is {st['cap']} after one upgrade, expected 34")
        if st["funds"] != 0:
            fails.append(f"funds are {st['funds']}, expected 0")
        if st["cost"] != 10000:
            fails.append(f"next rung costs {st['cost']}, expected 10000")
        if pg.evaluate("() => window.__sfh3.screen.page.storage.hit()"):
            fails.append("an unaffordable storage button still hit-tests")

        pg.screenshot(path=shot("probe_storage_page1.png"))
        click(pg, "pager.next", fails)
        st = pg.evaluate(STATE)
        if st["first"] != 24:
            fails.append(f"page 2 starts at {st['first']}, expected 24")
        pg.screenshot(path=shot("probe_storage_page2.png"))

        card = pg.evaluate("""() => {
          const p = window.__sfh3.screen.page;
          const SD = window.sfh3Dev.SD;
          const c = p.cellHits[0];
          const g = p.view.toGlobal({x: c.x + 71.48, y: c.y + 39.8});
          return {x: g.x, y: g.y, want: SD.items[0][c.i].id,
                  other: SD.items[0][0].id};
        }""")
        pg.mouse.move(card["x"], card["y"])
        time.sleep(0.4)
        pg.mouse.click(card["x"], card["y"])
        time.sleep(1.2)
        got = pg.evaluate("""() => {
          const m = window.__sfh3.screen.getItem;
          return {open: m.isOpen, id: m.item?.id ?? null};
        }""")
        if not got["open"]:
            fails.append("a page-2 card click raised no sell confirmation")
        elif got["id"] != card["want"]:
            fails.append(f"the sheet named {got['id']!r}, expected {card['want']!r}"
                         f" (page-1 card in the same window is {card['other']!r})")
        cancel = pg.evaluate("""() => {
          const m = window.__sfh3.screen.getItem;
          if (!m.discardHit) return null;
          const [x, y, w, h] = m.discardHit;
          return m.toGlobal({x: x + w / 2, y: y + h / 2});
        }""")
        if not cancel:
            fails.append("the sell sheet has no CANCEL to dismiss it with")
        else:
            pg.mouse.move(cancel["x"], cancel["y"])
            time.sleep(0.4)
            pg.mouse.click(cancel["x"], cancel["y"])
            time.sleep(1.2)
            if pg.evaluate("() => window.__sfh3.screen.getItem.isOpen"):
                fails.append("CANCEL did not close the sell sheet")

        click(pg, "pager.prev", fails)
        st = pg.evaluate(STATE)
        if st["first"] != 0:
            fails.append(f"back on page 1 starts at {st['first']}, expected 0")

        pg.evaluate("""() => {
          window.sfh3Dev.SD.items[1].length = 0;
          window.sfh3Dev.setItemCat(1);
          window.__sfh3.screen.host.refresh();
        }""")
        time.sleep(1.0)
        st = pg.evaluate(STATE)
        if st["first"] != 0:
            fails.append(f"an empty bucket opened at {st['first']}")
        if st["pager"]:
            fails.append("an empty bucket drew a pager")

        pg.screenshot(path=shot("probe_storage.png"))
        b.close()

    hard = [e for e in errs if "favicon" not in e]
    for e in hard[:5]:
        print("console error:", e[:160])
    for f in fails:
        print("FAIL", f)
    print("probe_storage:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
