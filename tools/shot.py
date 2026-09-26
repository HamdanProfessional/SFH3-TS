#!/usr/bin/env python3
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from devurl import goto_menu, wait_for_art

OUT = os.path.normpath(os.path.join(HERE, "..", "shots"))
URL = os.environ.get("SFH3_URL", "http://localhost:5173/")

FRAMES = ["missions", "heroes", "heroesInv", "inventory", "workshop",
          "workshopInv", "store", "deploy", "options", "optionsTut",
          "medals", "tips", "credits", "changelog", "appstore"]

DEFAULT_SIZE = (1280, 720)


def parse_size(argv):
    for i, a in enumerate(argv):
        if a == "--size" and i + 1 < len(argv):
            m = re.fullmatch(r"(\d+)x(\d+)", argv[i + 1])
            if m:
                return (int(m.group(1)), int(m.group(2))), \
                    argv[:i] + argv[i + 2:]
    return DEFAULT_SIZE, argv


def main():
    args = sys.argv[1:]
    (vw, vh), args = parse_size(args)
    wanted = args or FRAMES
    os.makedirs(OUT, exist_ok=True)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": vw, "height": vh},
                        device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text)
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))

        goto_menu(pg, URL)
        time.sleep(1.5)

        for label in wanted:
            ok = pg.evaluate(
                "(f) => { const s = window.__sfh3?.screen;"
                " if (!s || !s.goto) return false; s.goto(f); return true; }",
                label)
            if not ok:
                print(f"!! no debug hook; cannot reach {label!r}")
                break
            wait_for_art(pg)
            path = os.path.join(OUT, f"{label}.png")
            pg.screenshot(path=path)
            print("wrote", path)

        b.close()

    if errs:
        print(f"\n!! {len(errs)} console error(s):")
        for e in dict.fromkeys(errs):
            print("  ", e[:300])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
