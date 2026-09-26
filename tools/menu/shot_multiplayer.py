#!/usr/bin/env python3
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from devurl import goto_menu, wait_for_art

OUT = os.path.normpath(os.path.join(HERE, "..", "..", "shots"))
URL = os.environ.get("SFH3_URL", "http://localhost:5175/")

SIZE = (800, 600)

UNLOCK = """() => {
  const SD = window.sfh3Dev?.SD;
  const s = window.__sfh3?.screen;
  if (!SD || !s) return false;
  SD.stages = [0, 1, 2, 3, 4];
  SD.gotAkq = true;
  SD.mapItem.length = 0;
  SD.storeItem = null;
  SD.workshopItem = null;
  s.goto('missions');
  return true;
}
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": SIZE[0], "height": SIZE[1]},
                        device_scale_factor=2)
        errs = []
        pg.on("console", lambda m: errs.append(m.text)
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))

        goto_menu(pg, URL)
        if not pg.evaluate(UNLOCK):
            print("!! no dev hook -- is this a DEV build?")
            return 1
        wait_for_art(pg)

        pg.screenshot(path=os.path.join(OUT, "mp_nav.png"),
                      clip={"x": 0, "y": 24, "width": 800, "height": 36})
        print("wrote mp_nav.png")

        pg.evaluate("() => window.__sfh3.screen.goto('multiplayer')")
        wait_for_art(pg)
        time.sleep(2.5)
        pg.screenshot(path=os.path.join(OUT, "mp_browser.png"))
        print("wrote mp_browser.png")

        pg.mouse.move(400, 64 + 50 + 23)
        time.sleep(0.4)
        pg.screenshot(path=os.path.join(OUT, "mp_hover.png"))
        print("wrote mp_hover.png")

        pg.mouse.click(400, 64 + 50 + 23)
        time.sleep(1.5)
        pg.screenshot(path=os.path.join(OUT, "mp_lobby.png"))
        print("wrote mp_lobby.png")

        b.close()

    if errs:
        print(f"\n!! {len(errs)} console error(s):")
        for e in dict.fromkeys(errs):
            print("  ", e[:300])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
