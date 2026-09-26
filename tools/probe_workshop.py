#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from devurl import goto_menu, wait_for_art

URL = os.environ.get("SFH3_URL", "http://localhost:5174/")
SHOTS = os.path.join(REPO, "shots")

OPEN = """() => {
  const D = window.sfh3Dev, SD = D.SD;
  SD.stages = [0,1,2,3,4,5,6,7,8,9,10,11];
  SD.funds = 9999999;
  SD.bpOwned = [6, 11];
  SD.bpBuilt = [0, 1, 5];
  window.__sfh3.screen.goto('workshop');
  return {owned: SD.bpOwned.length, built: SD.bpBuilt.length};
}"""

DUMP = """() => {
  const s = window.__sfh3.screen;
  const page = s.page || s.curPage || null;
  const view = page ? page.view : null;
  if (!view) return {err: 'no page view'};
  const b = (o) => {
    const r = o.getBounds();
    return [+r.x.toFixed(1), +r.y.toFixed(1),
            +(r.x + r.width).toFixed(1), +(r.y + r.height).toFixed(1)];
  };
  const out = {rows: [], pane: null, stage: window.__sfh3.app.renderer.width};
  const walk = (c, depth, into) => {
    for (const ch of c.children) {
      const kind = ch.constructor && ch.constructor.name;
      into.push({d: depth, kind, txt: ch.text || '', box: b(ch),
                 sx: +ch.scale.x.toFixed(3)});
    }
  };
  for (const ch of view.children) {
    if (ch.mask) {
      out.pane = b(ch.mask);
      for (const row of ch.children) {
        if (row === ch.mask) continue;
        const kids = [];
        walk(row, 0, kids);
        out.rows.push({x: +row.x.toFixed(2), y: +row.y.toFixed(2),
                       box: b(row), kind: row.constructor.name,
                       txt: row.text || '', kids});
      }
    }
  }
  return out;
}"""


ROW_HIT = """() => {
  const p = window.__sfh3.screen.page || window.__sfh3.screen.curPage;
  const h = p.bpHits[0];
  const g = p.view.toGlobal({x: h.x, y: h.y});
  return [+g.x.toFixed(2), +g.y.toFixed(2), +h.w.toFixed(2), +h.h.toFixed(2)];
}"""

GLOWS = """() => {
  const p = window.__sfh3.screen.page || window.__sfh3.screen.curPage;
  return p.bpHits.filter((h) => h.glow && h.glow.visible).length
       + '/' + p.bpHits.length;
}"""

IS_OPEN = """() => {
  const m = window.__sfh3.screen.getItem;
  return m.isOpen ? (m.confirmKind || 'reward') : false;
}"""

CLOSE = """() => {
  const m = window.__sfh3.screen.getItem;
  if (m.confirmKind) m.closeConfirm(false);
  return true;
}"""

NEXT_PAGE = """() => {
  const s = window.__sfh3.screen;
  const p = s.page || s.curPage;
  p.bpPage = 1;
  s.host.refresh();
  return true;
}"""

BUILD = """() => {
  const s = window.__sfh3.screen;
  s.host.openBuild(window.sfh3Dev.SD.bpOwned[0]);
  return window.sfh3Dev.SD.bpOwned[0];
}"""

BUILD_DUMP = """() => {
  const m = window.__sfh3.screen.getItem;
  let title = '';
  const walk = (c) => { for (const ch of c.children) {
    if (ch.text && !title) title = ch.text; walk(ch); } };
  walk(m);
  return {kind: m.confirmKind, title,
          ok: m.okHit && m.okHit.map((v) => +v.toFixed(1)),
          cancel: m.discardHit && m.discardHit.map((v) => +v.toFixed(1))};
}"""


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(SHOTS, exist_ok=True)
    ui = json.load(open(os.path.join(REPO, "src/assets/itemUi.json"),
                        encoding="utf-8"))
    pane = ui["layout"]["workshop"]["scrollpane"]
    print(f"scrollpane at {pane}")
    for st in ("blueprint1", "blueprint2", "blueprint3"):
        c = ui["cont"][st]
        rec = ui["img"][c["img"]]
        print(f"  {st}: plate {rec['w']}x{rec['h']} reg {rec['ox']},{rec['oy']}"
              f"  -> card x[{-rec['ox']:.1f}, {rec['w'] - rec['ox']:.1f}]"
              f" y[{-rec['oy']:.1f}, {rec['h'] - rec['oy']:.1f}]")
        for p in c["place"]:
            if p.get("name"):
                print(f"      {p['name']:10} {p['m']}")
    t = ui["text"].get("2337")
    if t:
        print(f"  txt_title 2337: x{t['x']} y{t['y']} w{t['w']} h{t['h']}"
              f" align={t['align']} size={t['size']} font={t['font']}")
    print()

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(pg, URL)
        time.sleep(1.0)
        print("open:", pg.evaluate(OPEN))
        wait_for_art(pg)
        time.sleep(2.0)
        d = pg.evaluate(DUMP)
        if d.get("err"):
            print("FAIL", d["err"])
        else:
            print(f"pane rect {d['pane']}  (stage {d['stage']})")
            for i, r in enumerate(d["rows"]):
                print(f"  row {i} {r['kind']} at ({r['x']}, {r['y']})"
                      f" box {r['box']} {r['txt']!r}")
                for k in r["kids"]:
                    print(f"      {k['kind']:10} sx={k['sx']:6}"
                          f" box {k['box']} {k['txt']!r}")
        path = os.path.join(SHOTS, "workshop.png")
        pg.screenshot(path=path)
        print("wrote", path)

        hit = pg.evaluate(ROW_HIT)
        print(f"row 0 bt rect (stage) {hit}")
        scale = pg.evaluate("() => window.__sfh3.app.renderer.canvas.width"
                            " / window.__sfh3.app.renderer.width")
        cx = hit[0] + hit[2] / 2
        cy = hit[1] + hit[3] / 2

        pg.mouse.move(cx * scale, cy * scale)
        time.sleep(0.4)
        print("  hover on card  -> glows lit:", pg.evaluate(GLOWS))
        path = os.path.join(SHOTS, "workshop_hover.png")
        pg.screenshot(path=path)
        print("  wrote", path)
        pg.mouse.move(cx * scale, (hit[1] - 12) * scale)
        time.sleep(0.4)
        print("  hover off card -> glows lit:", pg.evaluate(GLOWS))

        pg.mouse.click(cx * scale, cy * scale)
        time.sleep(0.8)
        print("  click on card    -> confirm open:", pg.evaluate(IS_OPEN))
        pg.evaluate(CLOSE)
        time.sleep(0.5)
        pg.mouse.click((hit[0] + hit[2] + 25) * scale, cy * scale)
        time.sleep(0.8)
        print("  click right of it-> confirm open:", pg.evaluate(IS_OPEN))
        pg.evaluate(CLOSE)
        time.sleep(0.5)

        pg.evaluate(NEXT_PAGE)
        time.sleep(1.5)
        d3 = pg.evaluate(DUMP)
        print("page 2 (NOT FOUND rows)")
        for r in d3.get("rows", []):
            for k in r["kids"]:
                if k["txt"]:
                    print(f"      {k['box']}  {k['txt']!r}")
        path = os.path.join(SHOTS, "workshop_notfound.png")
        pg.screenshot(path=path)
        print("wrote", path)

        print("build confirm:", pg.evaluate(BUILD))
        time.sleep(1.0)
        d2 = pg.evaluate(BUILD_DUMP)
        print(f"  kind={d2['kind']!r} title={d2['title']!r}")
        print(f"  BUILD  hit {d2['ok']}")
        print(f"  CANCEL hit {d2['cancel']}")
        path = os.path.join(SHOTS, "workshop_build.png")
        pg.screenshot(path=path)
        print("wrote", path)
        for e in errs[:3]:
            print("  !! pageerror:", e[:160])
        b.close()


if __name__ == "__main__":
    main()
