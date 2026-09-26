#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from devurl import goto_menu, wait_for_art

URL = os.environ.get("SFH3_URL", "http://localhost:5174/")
SHOTS = os.path.join(REPO, "shots")

SETUP = """(s) => {
  const SD = window.sfh3Dev.SD;
  SD.stages = Array.from({length: s.stages}, (_, i) => i);
  while (SD.heroes.length > s.heroes) SD.heroes.pop();
  while (SD.heroes.length < s.heroes) {
    const h = SD.heroes[0];
    SD.heroes.push(Object.create(Object.getPrototypeOf(h),
                                 Object.getOwnPropertyDescriptors(h)));
  }
  SD.bpBuilt = Array.from({length: s.bp}, (_, i) => i);
  SD.mapItem = [];
  SD.storeItem = null;
  window.__sfh3.screen.goto('missions');
  return {stages: SD.stages.length, heroes: SD.heroes.length,
          bp: SD.bpBuilt.length};
}"""

SHOWN = """() => {
  const sc = window.__sfh3.screen;
  const p = sc.page || sc.curPage;
  const vis = (b) => (b ? !!b.visible : null);
  return {play: vis(p.playBtn), custom: vis(p.customBtn),
          daily: vis(p.dailyBtn), banner: sc.tutorialFrame};
}"""


def check(label, got, want):
    ok = all(got.get(k) == v for k, v in want.items())
    print(f"{'ok  ' if ok else 'FAIL'} {label}: {got}")
    return ok


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(SHOTS, exist_ok=True)
    bad = 0
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(pg, URL)
        time.sleep(1.0)

        print("setup:", pg.evaluate(SETUP, {"stages": 2, "heroes": 1, "bp": 0}))
        wait_for_art(pg)
        bad += not check("mid-tutorial (2 stages, 1 hero)", pg.evaluate(SHOWN),
                         {"play": False, "custom": False, "banner": 2})
        pg.screenshot(path=os.path.join(SHOTS, "tut_hire_before.png"))

        print("setup:", pg.evaluate(SETUP, {"stages": 2, "heroes": 2, "bp": 0}))
        wait_for_art(pg)
        bad += not check("hired (2 stages, 2 heroes)", pg.evaluate(SHOWN),
                         {"play": True, "custom": False, "banner": 0})
        pg.screenshot(path=os.path.join(SHOTS, "tut_hire_after.png"))

        print("setup:", pg.evaluate(SETUP, {"stages": 3, "heroes": 2, "bp": 11}))
        wait_for_art(pg)
        bad += not check("mid-tutorial (3 stages, 11 bp)", pg.evaluate(SHOWN),
                         {"play": False, "custom": False, "banner": 4})
        print("setup:", pg.evaluate(SETUP, {"stages": 3, "heroes": 2, "bp": 12}))
        wait_for_art(pg)
        bad += not check("built (3 stages, 12 bp)", pg.evaluate(SHOWN),
                         {"play": True, "custom": False, "banner": 0})

        print("setup:", pg.evaluate(SETUP, {"stages": 5, "heroes": 2, "bp": 12}))
        wait_for_art(pg)
        bad += not check("past it (5 stages)", pg.evaluate(SHOWN),
                         {"play": True, "custom": True, "daily": True,
                          "banner": 0})
        pg.screenshot(path=os.path.join(SHOTS, "tut_done.png"))

        for e in errs[:3]:
            print("  !! pageerror:", e[:200])
        b.close()
    print("FAILURES:", bad) if bad else print("all clear")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
