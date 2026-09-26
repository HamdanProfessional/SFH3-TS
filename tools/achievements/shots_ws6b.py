#!/usr/bin/env python3
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "shots")
URL = os.environ.get("SFH3_URL", sys.argv[1] if len(sys.argv) > 1
                     else "http://localhost:5178/")


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(
            viewport={"width": 1280, "height": 720}, device_scale_factor=1,
            permissions=["clipboard-read", "clipboard-write"],
        )
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_selector("canvas", timeout=30000)
        time.sleep(2.0)

        def shot(name):
            pg.screenshot(path=os.path.join(OUT, name))
            print("wrote", name)

        pg.evaluate("""() => {
          const { SD, awardAchievement } = window.sfh3Dev;
          SD.newGame();
          awardAchievement('secret2');
        }""")
        time.sleep(0.18)
        shot("_ws6b_toast_slide.png")
        time.sleep(1.3)
        shot("_ws6b_toast_hold.png")
        time.sleep(1.7)
        shot("_ws6b_toast_expire.png")

        pg.evaluate("""() => {
          const { SD, awardAchievement } = window.sfh3Dev;
          awardAchievement('classes');
        }""")
        time.sleep(1.7)
        shot("_ws6b_toast_second.png")
        pg.evaluate("() => window.__sfh3.screen.goto('medals')")
        time.sleep(1.0)
        shot("_ws6b_medals.png")

        pg.evaluate("""() => {
          const { SD } = window.sfh3Dev;
          SD.newGame();
          SD.stages = [0, 1, 2, 3];
          SD.funds = 999999;
          const s = window.__sfh3.screen;
          s.goto('deploy');
        }""")
        time.sleep(1.2)
        shot("_ws6b_deploy.png")

        result = pg.evaluate("""async () => {
          const { SD } = window.sfh3Dev;
          SD.createSquadCode();
          await navigator.clipboard.writeText(SD.squadCode);
          const readBack = await navigator.clipboard.readText();
          const ok = SD.readSquadCode(readBack);
          return { code: SD.squadCode, readBack, roundTrip: ok,
                   bots: SD.heroes.length, copied: readBack === SD.squadCode };
        }""")
        print("squad code:", result["code"])
        print("clipboard matches:", result["copied"], "round trip:", result["roundTrip"])

        pg.evaluate(
            """([code, copied, trip]) => {
              const bar = document.createElement('div');
              bar.style.cssText = 'position:fixed;left:190px;top:99px;width:878px;' +
                'height:22px;z-index:98;background:#f4f6f8;color:#123;' +
                'font:13px Consolas,monospace;padding:2px 6px;overflow:hidden;' +
                'white-space:nowrap';
              bar.textContent = code;
              document.body.appendChild(bar);
              const tag = document.createElement('div');
              tag.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:99;' +
                'background:#10161d;color:#ffcc00;border:2px solid #ffcc00;' +
                'font:13px monospace;padding:8px 12px;max-width:1100px;word-break:break-all';
              tag.textContent = 'SD.createSquadCode() -> clipboard (' +
                (copied ? 'read-back matches' : 'MISMATCH') + '), readSquadCode -> ' +
                trip + '\\n' + code;
              document.body.appendChild(tag);
            }""",
            [result["code"], result["copied"], result["roundTrip"]],
        )
        time.sleep(0.3)
        shot("_ws6b_deploy_copy.png")

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
