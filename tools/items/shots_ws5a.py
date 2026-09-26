#!/usr/bin/env python3
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "tools"))
import svgraster as R
import swfio as S

OUT = os.path.join(REPO, "shots")
URL = os.environ.get("SFH3_URL", "http://localhost:5178/")


def reference_frames():
    jobs = {
        "_ws5a_ref_itembox_idle1.png": ("DefineSprite_2380_ItemBox", 1),
        "_ws5a_ref_itembox_open1.png": ("DefineSprite_2380_ItemBox", 6),
        "_ws5a_ref_itembox_idle2.png": ("DefineSprite_2380_ItemBox", 13),
        "_ws5a_ref_getitem_get.png": ("DefineSprite_2408_GetItem", 2),
        "_ws5a_ref_getitem_unlock.png": ("DefineSprite_2408_GetItem", 137),
        "_ws5a_ref_slotface_gun.png": ("DefineSprite_2736", 6),
        "_ws5a_ref_slotmachine.png": ("DefineSprite_2742_SlotMachine", 1),
        "_ws5a_ref_upgradebox.png": ("DefineSprite_2759", 1),
    }
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=2)
        for out, (folder, frame) in jobs.items():
            path = os.path.join(S.SPRITES, folder, f"{frame}.svg")
            if not os.path.isfile(path):
                print("!! missing ref", path)
                continue
            svg = open(path, encoding="utf-8").read()
            m = re.search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
            w, h = float(m.group(2)), float(m.group(1))
            R.render(pg, svg, os.path.join(OUT, out), rect=(0, 0, w, h))
            print("ref", out)
        b.close()


def game_shots():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_selector("canvas", timeout=30000)
        time.sleep(1.5)

        def shot(name):
            pg.screenshot(path=os.path.join(OUT, name))
            print("wrote", name)

        pg.evaluate("""() => {
          const { SD } = window.sfh3Dev;
          SD.newGame();
          SD.stages = [0, 1, 2, 3];
          SD.funds = 999999;
          const guns = SD.storeItems.filter((x) => typeof x === 'object').slice(0, 8);
          for (const g of guns) SD.items[0].push(g);
          SD.items[11].push("theif");
          SD.items[12].push("gold1");
          const s = window.__sfh3.screen;
          s.goto('missions'); s.goto('inventory');
        }""")
        time.sleep(1.0)
        pg.mouse.move(413, 103)
        time.sleep(0.2)
        pg.evaluate("() => window.__sfh3.screen.onClick()")
        time.sleep(1.2)
        shot("_ws5a_inventory.png")

        pg.evaluate("""() => {
          const { SD } = window.sfh3Dev;
          SD.stages = [0, 1, 2, 3];
          SD.funds = 999999;
          window.__sfh3.screen.goto('store');
        }""")
        time.sleep(1.0)
        pg.mouse.move(250, 250)
        time.sleep(0.2)
        pg.evaluate("() => window.__sfh3.screen.onClick()")
        time.sleep(0.4)
        shot("_ws5a_store_spin.png")
        time.sleep(1.6)
        shot("_ws5a_store_stock.png")

        pg.evaluate("""() => {
          const { SD } = window.sfh3Dev;
          SD.stages = [0, 1, 2, 3];
          SD.findBlueprint('Vulcan');
          window.__sfh3.screen.goto('workshop');
        }""")
        time.sleep(1.0)
        pg.mouse.move(505, 164)
        time.sleep(0.2)
        pg.evaluate("() => window.__sfh3.screen.onClick()")
        time.sleep(1.0)
        shot("_ws5a_workshop.png")

        pg.evaluate("""() => {
          const { SD } = window.sfh3Dev;
          SD.mapItem.push(SD.storeItems.find((x) => typeof x === 'object'));
          const s = window.__sfh3.screen;
          s.goto('store'); s.goto('missions');
        }""")
        time.sleep(0.8)
        shot("_ws5a_getitem.png")

        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_selector("canvas", timeout=30000)
        time.sleep(1.2)
        pg.evaluate("""() => {
          const g = window.sfh3Dev.SD;
          g.newGame();
          const s = window.__sfh3.screen;
          s.getItem.item = null; s.getItem.onDone = null; s.getItem.removeChildren();
          g.mapItem.push('$eng');
          s.goto('inventory'); s.goto('missions');
        }""")
        time.sleep(0.8)
        shot("_ws5a_getitem_unique.png")

        b.close()
        if errs:
            print(f"\n!! {len(errs)} console error(s):")
            for e in dict.fromkeys(errs):
                print("  ", e[:300])
            return 1
    return 0


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    reference_frames()
    sys.exit(game_shots())
