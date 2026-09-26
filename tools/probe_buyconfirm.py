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
  const g = D.makeGun(0, 1);
  if (!g) return 'no gun';
  SD.storeItems = SD.storeItems || [];
  SD.storeItems[0] = g;
  const s = window.__sfh3.screen;
  s.goto('store');
  s.host ? s.host.openTransaction(g, 'buy')
         : s.getItem.openTransaction(g, 'buy', () => {});
  return 'ok';
}"""

DUMP = """() => {
  const m = window.__sfh3.screen.getItem;
  const out = {ok: null, cancel: null, hits: {}};
  const box = (b) => {
    if (!b) return null;
    const r = b.getBounds();
    return {x: +r.x.toFixed(1), y: +r.y.toFixed(1),
            w: +r.width.toFixed(1), h: +r.height.toFixed(1),
            sx: +b.scale.x.toFixed(3), sy: +b.scale.y.toFixed(3)};
  };
  out.ok = box(m.ok);
  out.cancel = box(m.discardBtn);
  out.hits = {ok: m.okHit, cancel: m.discardHit};
  return out;
}"""


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(SHOTS, exist_ok=True)
    ui = json.load(open(os.path.join(REPO, "src/assets/itemUi.json"),
                        encoding="utf-8"))
    men = json.load(open(os.path.join(REPO, "src/assets/menuUi.json"),
                         encoding="utf-8"))
    art = men["buttons"]["2087"]
    get = ui["get"]["get"]
    print(f"button 2087 art: {art['w']}x{art['h']}")
    for name in ("bt_take", "bt_sell"):
        p = next(q for q in get["place"] if q["name"] == name)
        sx, sy = p["m"][0], p["m"][3]
        print(f"  {name:8} at ({p['m'][4]}, {p['m'][5]}) scale ({sx}, {sy})"
              f"  -> want {art['w'] * sx:.1f} x {art['h'] * sy:.1f}")
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
        time.sleep(1.0)
        d = pg.evaluate(DUMP)
        for key, label in (("ok", "BUY"), ("cancel", "CANCEL")):
            v, hit = d[key], d["hits"][key]
            if not v:
                print(f"  {label}: not built")
                continue
            print(f"  {label:7} art w={v['w']:7.1f} h={v['h']:6.1f} "
                  f"(container scale {v['sx']}, {v['sy']})")
            if hit:
                print(f"  {'':7} hit w={hit[2]:7.1f} h={hit[3]:6.1f}"
                      + ("   <-- MISMATCH" if abs(v["w"] - hit[2]) > 2 else ""))
        path = os.path.join(SHOTS, "buyconfirm.png")
        pg.screenshot(path=path)
        print("wrote", path)
        for e in errs[:3]:
            print("  !! pageerror:", e[:140])
        b.close()


if __name__ == "__main__":
    main()
