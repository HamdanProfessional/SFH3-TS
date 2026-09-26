#!/usr/bin/env python3
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "shots")
URL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    "SFH3_URL", "http://localhost:5173/")


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 800, "height": 600}, device_scale_factor=2)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="load")
        pg.wait_for_selector("canvas", timeout=30000)
        time.sleep(1.5)
        pg.wait_for_function("() => window.__sfh3?.screen", timeout=30000)
        pg.evaluate("() => window.__sfh3.screen.goto('deploy')")
        time.sleep(0.8)
        pg.mouse.click(400, 548)
        pg.wait_for_function(
            "() => window.__sfh3?.screen?.constructor?.name === 'GameScreen'",
            timeout=60000)
        time.sleep(3.0)
        pg.wait_for_function(
            "() => { const s = window.__sfh3?.screen;"
            " return s && s.gameStarted && s.hud.mode === 'idle'; }",
            timeout=30000)
        time.sleep(0.6)

        ok = pg.evaluate("""async () => {
          const s = window.__sfh3.screen;
          const { KillstreakArt } = await import('/src/game/killstreaks/KillstreakArt.ts');
          const { Killstreak_Turret } = await import('/src/game/killstreaks/Killstreak_Turret.ts');
          const art = new KillstreakArt();
          s.unitCont.addChild(art.root);
          await art.load();
          const host = s.combat ?? s;
          const owner = s.units[0];
          if (!owner) return 'no units';
          const mk = (kind, dx, dy, frame, head, rot) => {
            const k = new Killstreak_Turret(host, owner, 999999, kind);
            k.x = owner.x + dx;
            k.y = owner.y + dy;
            k.frame = frame;
            k.active = true;
            k.headFrame = head;
            k.rot = rot;
            k.setText();
            return k;
          };
          const devices = [
            mk('turret', 120, 0, 33, 1, -20),
            mk('sentry', 260, 0, 33, 1, 40),
          ];
          window.__ws6a = { art, devices };
          art.enterFrame(devices);
          return 'ok';
        }""")
        if ok != "ok":
            print("!! injection failed:", ok)
        time.sleep(0.5)
        path = os.path.join(OUT, "_ws6a_inmatch.png")
        pg.screenshot(path=path)
        print("wrote", path)

        pg.evaluate("""() => {
          const [turret, sentry] = window.__ws6a.devices;
          sentry.hpCur = sentry.hpMax * 0.45;
          sentry.setBars();
          turret.headFrame = 3;
          turret.rot = -60;
          window.__ws6a.art.enterFrame(window.__ws6a.devices);
        }""")
        time.sleep(0.4)
        path = os.path.join(OUT, "_ws6a_inmatch_damaged.png")
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
    os.makedirs(OUT, exist_ok=True)
    sys.exit(main())
