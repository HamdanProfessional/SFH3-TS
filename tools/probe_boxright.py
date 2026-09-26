#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from playwright.sync_api import sync_playwright

from devurl import URL, goto_menu, wait_for_art

SLOTS = [("primary", "idle2"), ("secondary", "idle2"),
         ("gun", "idle4"), ("armor", "idle4")]

DUMP = r"""() => {
  const s = window.__sfh3.screen, pg = s.page;
  if (!pg || !pg.rightBox) return {err: 'no rightBox on ' + (pg && pg.constructor.name)};
  const rb = pg.rightBox, out = {nodes: []};
  out.rightBox = {x: rb.x, y: rb.y};
  const rect = (c) => {
    const b = c.getBounds();
    const a = rb.toLocal({x: b.x, y: b.y});
    const z = rb.toLocal({x: b.maxX, y: b.maxY});
    return [+a.x.toFixed(2), +a.y.toFixed(2),
            +(z.x - a.x).toFixed(2), +(z.y - a.y).toFixed(2)];
  };
  const walk = (c, path, d) => {
    if (d > 2) return;
    out.nodes.push({path, type: c.constructor.name, rect: rect(c),
                    x: +c.x.toFixed(2), y: +c.y.toFixed(2),
                    sx: +c.scale.x.toFixed(4), masked: !!c.mask});
    (c.children || []).forEach((ch, i) => walk(ch, path + '.' + i, d + 1));
  };
  walk(rb, 'rightBox', 0);
  return out;
}"""


def main():
    ui = json.load(open(os.path.join(REPO, "src/assets/itemUi.json"),
                        encoding="utf-8"))
    pan = json.load(open(os.path.join(REPO, "src/assets/menuPanels.json"),
                         encoding="utf-8"))
    right = pan["box"]["right"]
    print(f"plate: w={right['w']} ox={right['ox']} "
          f"-> local x [{-right['ox']:.2f}, {right['w'] - right['ox']:.2f}]")
    print()
    print(f"{'slot':10} {'state':6} {'left':>9} {'right':>9} {'width':>8}")
    for name, state in SLOTS:
        m = pan["items"][name]
        cx, cy, cw, ch = ui["box"]["clip"][state]
        l = m[4] + cx * m[0]
        print(f"{name:10} {state:6} {l:9.2f} {l + cw * m[0]:9.2f} "
              f"{cw * m[0]:8.2f}")
    print()

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={"width": 1280, "height": 720})
        goto_menu(page, URL)
        time.sleep(1.5)
        page.evaluate("""() => {
          const SD = window.sfh3Dev.SD;
          SD.stages = [0,1,2,3,4,5,6,7,8,9,10,11];
          SD.bpClasses = [0,1,2,3,4,5,6,7,8];
          SD.funds = 9999999;
          while (SD.heroes.length < 5) { if (!SD.hireHero()) break; }
          SD.selHero = 0; SD.gotAkq = true;
        }""")
        page.evaluate("() => window.__sfh3.screen.goto('heroes')")
        wait_for_art(page)
        time.sleep(1.0)
        d = page.evaluate(DUMP)
        if d.get("err"):
            print("!!", d["err"])
        else:
            print(f"live rightBox at x={d['rightBox']['x']:.1f} "
                  f"y={d['rightBox']['y']:.1f}")
            for n in d["nodes"]:
                x, y, w, h = n["rect"]
                print(f"  {n['path']:14} {n['type']:10} "
                      f"x[{x:8.2f},{x + w:8.2f}] w{w:7.2f} "
                      f"y[{y:8.2f},{y + h:8.2f}]"
                      + ("  masked" if n["masked"] else ""))
        page.screenshot(path=os.path.join(REPO, "shots", "boxright_live.png"))
        b.close()


if __name__ == "__main__":
    main()
