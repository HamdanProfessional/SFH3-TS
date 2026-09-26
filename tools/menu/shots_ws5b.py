#!/usr/bin/env python3
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "shots"))
URL = os.environ.get("SFH3_URL", "http://localhost:5173/")

SCALE = 1.2
OFF_X = 133.5


def s(x, y):
    return (OFF_X + x) * SCALE, y * SCALE


def seed(pg):
    pg.evaluate("() => window.__sfh3.screen.goto('missions')")
    time.sleep(0.4)
    ok = pg.evaluate("""() => {
      const key = 'sfh3.save';
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const ob = JSON.parse(raw);
      const h = ob.heroes[0];
      ob.heroes = [h,
        { ...h, name: 'Ada', cls: 'sni', head: 101, body: 101, color: 2 },
        { ...h, name: 'Bishop', cls: 'jug', head: 121, body: 121, color: 4 }];
      ob.squad = [0];
      ob.justHired = false;
      localStorage.setItem(key, JSON.stringify(ob));
      return true;
    }""")
    if not ok:
        print("!! could not seed save")
        return
    pg.reload(wait_until="networkidle")
    pg.wait_for_selector("canvas", timeout=30000)
    time.sleep(2.5)


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720},
                        device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_selector("canvas", timeout=30000)
        time.sleep(2.0)
        seed(pg)

        pg.evaluate("() => window.__sfh3.screen.goto('deploy')")
        time.sleep(1.2)
        pg.screenshot(path=os.path.join(OUT, "_ws5b_deploy_base.png"))

        cx, cy = s(399, 472)
        pg.mouse.click(cx, cy)
        time.sleep(2.5)
        pg.screenshot(path=os.path.join(OUT, "_ws5b_deploy_picker.png"))

        hx, hy = s(82.7, 538.35)
        pg.mouse.move(hx, hy)
        time.sleep(1.0)
        pg.screenshot(path=os.path.join(OUT, "_ws5b_deploy_hover.png"))

        pg.mouse.down()
        time.sleep(0.12)
        pg.mouse.up()
        time.sleep(1.0)
        pg.screenshot(path=os.path.join(OUT, "_ws5b_deploy_picked.png"))
        pg.evaluate("() => window.__sfh3.screen.goto('missions')")
        time.sleep(0.5)
        wrote = pg.evaluate("""() => {
          const ob = JSON.parse(localStorage.getItem('sfh3.save'));
          return [ob.squad.slice(), ob.selHero];
        }""")
        print("squad after pick:", wrote)

        pg.evaluate("() => window.__sfh3.screen.goto('heroes')")
        time.sleep(3.0)
        pg.mouse.move(*s(640, 560))
        time.sleep(1.0)
        pg.screenshot(path=os.path.join(OUT, "_ws5b_heroes.png"))

        pg.evaluate("""() => {
          const key = 'sfh3.save';
          const ob = JSON.parse(localStorage.getItem(key));
          const h = ob.heroes[0];
          h.level = 12; h.exp = 30; h.status = 250;
          ob.selHero = 0;
          localStorage.setItem(key, JSON.stringify(ob));
        }""")
        pg.reload(wait_until="networkidle")
        pg.wait_for_selector("canvas", timeout=30000)
        time.sleep(3.0)
        pg.evaluate("() => window.__sfh3.screen.goto('heroes')")
        time.sleep(3.0)
        pg.mouse.move(*s(640, 560))
        time.sleep(1.0)
        pg.screenshot(path=os.path.join(OUT, "_ws5b_heroes_status.png"))

        b.close()

    if errs:
        print(f"!! {len(errs)} console error(s):")
        for e in dict.fromkeys(errs):
            print("  ", e[:400])
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
