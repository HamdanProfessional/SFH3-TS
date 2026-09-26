#!/usr/bin/env python3
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "shots"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from devurl import nointro

URL = os.environ.get("SFH3_URL", "http://localhost:5178/")

MENU_STATE = """async () => {
  const { SD } = await import(window.__ws5c_sd ?? '/src/state/SD.ts');
  SD.newGame();
  SD.stages = [0,1,0,2];
  SD.curStage = 1;
  SD.day = 42;
  SD.funds = 12345;
  SD.achievements = ['campaign','challenges','levelmax','hard','insane',
                     'upgrade','buy','sell','enemies','eng'];
  SD.achOb.enemies = 123; SD.achOb.buy = 500000; SD.achOb.classes = 3;
  SD.save();
}"""

TUT_STATE = """async () => {
  const { SD } = await import(window.__ws5c_sd ?? '/src/state/SD.ts');
  SD.newGame();
  SD.stages = [0];
  SD.save();
}"""

POSTGAME_STATE = """async () => {
  const { SD } = await import(window.__ws5c_sd ?? '/src/state/SD.ts');
  const { newHero } = await import('/src/game/newHero.ts');
  SD.newGame();
  SD.stages = [0,1,0,2]; SD.curStage = 1; SD.curDiff = 3;
  SD.day = 42; SD.funds = 12345;
  while (SD.heroes.length < 3) SD.heroes.push(newHero());
  SD.squad = [0, 1, 2];
  for (let i = 0; i < 3; i++) {
    const h = SD.heroes[i];
    h.level = 4 + i * 5; h.exp = 20 + i * 40; h.status = 380 - i * 130;
    h.earnedExp = 8 + i * 6; h.earnedFunds = 100 + i * 200; h.skills = {};
  }
  SD.save();
}"""

FINAL_STATE = """async () => {
  const { SD } = await import(window.__ws5c_sd ?? '/src/state/SD.ts');
  SD.stages = new Array(60).fill(3);
  SD.curStage = 59;
  SD.save();
}"""

CUTSCENE_TICKS = {
    "cutscene_frame11": 0,
    "cutscene_frame14": 330,
    "cutscene_frame18": 1230,
    "cutscene_credits": 2720,
    "cutscene_endcard": 4300,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    wanted = sys.argv[1:]
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        pg.route("**/@vite/client*", lambda route: route.abort())

        def fresh():
            for _ in range(8):
                try:
                    pg.goto(nointro(URL), wait_until="domcontentloaded",
                            timeout=20000)
                except Exception as e:
                    print("   fresh goto:", e)
                    time.sleep(0.4)
                    continue
                try:
                    pg.wait_for_selector("canvas", timeout=30000)
                except Exception as e:
                    print("   fresh canvas:", e)
                    continue
                for _ in range(80):
                    try:
                        if pg.evaluate("() => !!window.__sfh3?.screen"):
                            resolve_sd()
                            pg.evaluate("(u) => { window.__ws5c_sd = u; }", SD_URL)
                            return True
                    except Exception as e:
                        print("   fresh eval:", e)
                        break
                    time.sleep(0.25)
            return False

        def boot_with(state_js):
            for _ in range(8):
                try:
                    pg.evaluate(state_js)
                    if fresh():
                        return True
                except Exception as e:
                    print("   boot state:", e)
                    time.sleep(0.3)
            return False

        SD_URL = ""

        def resolve_sd():
            nonlocal SD_URL
            try:
                src = pg.evaluate(
                    "async () => (await fetch('/src/screens/PostGameScreen.ts')).text()")
                import re
                m = re.search(r"""["']([^"']*state/SD\.ts[^"']*)["']""", src)
                SD_URL = m.group(1) if m else "/src/state/SD.ts"
            except Exception:
                SD_URL = "/src/state/SD.ts"

        def cap(name):
            path = os.path.join(OUT, f"_ws5c_{name}.png")
            pg.screenshot(path=path)
            print("wrote", path)

        def menu_shot(name, state=MENU_STATE, frame=None):
            frame = frame or name
            for _ in range(6):
                if not boot_with(state):
                    continue
                try:
                    pg.evaluate("(f) => window.__sfh3.screen.goto(f)", frame)
                    time.sleep(3.0 if name == "medals" else 1.8)
                    if pg.evaluate("() => window.__sfh3.screen?.curFrame") != frame:
                        continue
                    cap(name)
                    return
                except Exception as e:
                    print(f"  retry {name}: {e}")
            print("!! gave up on", name)

        def postgame_shot(name, ticks):
            for _ in range(6):
                if not boot_with(POSTGAME_STATE):
                    print("  boot_with failed")
                    continue
                try:
                    pg.evaluate("""async (n) => {
                      const { SD } = await import(window.__ws5c_sd ?? '/src/state/SD.ts');
                      const { newHero } = await import('/src/game/newHero.ts');
                      SD.load();
                      while (SD.heroes.length < 3) SD.heroes.push(newHero());
                      SD.squad = [0, 1, 2];
                      for (let i = 0; i < 3; i++) {
                        const h = SD.heroes[i];
                        h.level = 4 + i * 5; h.exp = 20 + i * 40;
                        h.status = 380 - i * 130;
                        h.earnedExp = 8 + i * 6; h.earnedFunds = 100 + i * 200;
                        h.skills = {};
                      }
                      const g = await import('/src/screens/PostGameScreen.ts');
                      window.__sfh3.setScreen(g.PostGameScreen,
                        { won: true, afterCutscene: true });
                    }""", ticks)
                    time.sleep(2.0)
                    pg.evaluate("""async (n) => {
                      const g = await import('/src/screens/PostGameScreen.ts');
                      const s = window.__sfh3.screen;
                      if (!(s instanceof g.PostGameScreen)) return;
                      for (let i = 0; i < n; i++) s.tally.tick();
                      s.sync();
                    }""", ticks)
                    time.sleep(0.35)
                    if pg.evaluate("() => window.__sfh3.screen?.constructor?.name") \
                            != "PostGameScreen":
                        continue
                    cap(name)
                    return
                except Exception as e:
                    print(f"  retry {name}: {e}")
            print("!! gave up on", name)

        def cutscene_shot(name, ticks):
            for _ in range(6):
                if not boot_with(FINAL_STATE):
                    continue
                try:
                    pg.evaluate("""async () => {
                      const { SD } = await import(window.__ws5c_sd ?? '/src/state/SD.ts');
                      SD.load();
                      const g = await import('/src/screens/CutsceneScreen.ts');
                      window.__sfh3.setScreen(g.CutsceneScreen,
                        { start: 11, end: 19, showCredits: true });
                    }""")
                    time.sleep(0.7)
                    pg.evaluate("""async (n) => {
                      const g = await import('/src/screens/CutsceneScreen.ts');
                      const s = window.__sfh3.screen;
                      if (!(s instanceof g.CutsceneScreen)) return;
                      for (let i = 0; i < n; i++) s.tick();
                      s.enterFrame(0);
                    }""", ticks)
                    time.sleep(0.25)
                    if pg.evaluate("() => window.__sfh3.screen?.constructor?.name") \
                            != "CutsceneScreen":
                        continue
                    cap(name)
                    return
                except Exception as e:
                    print(f"  retry {name}: {e}")
            print("!! gave up on", name)

        fresh()

        jobs = ["options", "medals", "tips", "credits", "appstore", "optionsTut",
                "postgame_start", "postgame_mid", "postgame_done",
                "cutscene_frame11", "cutscene_frame14", "cutscene_frame18",
                "cutscene_credits", "cutscene_endcard"]
        for name in jobs:
            if wanted and name not in wanted:
                continue
            if name == "optionsTut":
                menu_shot(name, TUT_STATE, "options")
            elif name.startswith("postgame"):
                postgame_shot(name, {"postgame_start": 0, "postgame_mid": 90,
                                     "postgame_done": 520}[name])
            elif name.startswith("cutscene"):
                cutscene_shot(name, CUTSCENE_TICKS[name])
            else:
                menu_shot(name)

        b.close()


if __name__ == "__main__":
    main()
