#!/usr/bin/env python3
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from devurl import goto_menu

URL = os.environ.get("SFH3_URL", "http://localhost:5175/")
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "shots")

SAMPLE = """() => {
  const g = window.__sfh3.screen, p = g.combat.player;
  const view = g.unitViews.get(p);
  const out = [];
  if (view) {
    for (const [k, sp] of view.sprites) {
      if (!k.endsWith('.muzzle')) continue;
      out.push({ key: k, visible: sp.visible,
                 tex: sp.texture && sp.texture.width || 0,
                 w: Math.round(sp.width), h: Math.round(sp.height) });
    }
  }
  return { frame: p.gun.curFrame, arm: p.MC.arm1.frame,
           label: p.MC.arm1.label, clip: p.gun.curGun.clipAmmo,
           gun: p.gun.curGun.id, muzzles: out };
}"""


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(SHOTS, exist_ok=True)
    fails = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False)
        pg = b.new_page(viewport={"width": 800, "height": 600},
                        device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(pg, URL)
        time.sleep(2.0)

        started = pg.evaluate("""() => {
          const D = window.sfh3Dev, SD = D.SD;
          SD.curStage = 1;
          while (SD.heroes.length < 1) SD.heroes.push(D.newHero('mer'));
          SD.squad = [0];
          window.__sfh3.screen.startMatch();
          return true;
        }""")
        if not started:
            print("FAIL  could not start a match")
            b.close()
            return 1
        for _ in range(60):
            if pg.evaluate("() => !!(window.__sfh3.screen && window.__sfh3.screen.combat)"):
                break
            time.sleep(0.5)
        for _ in range(40):
            if pg.evaluate("() => window.__sfh3.screen.hud.mode === 'idle'"):
                break
            time.sleep(0.25)
        for _ in range(60):
            if pg.evaluate("() => !window.__sfh3.screen.combat.player.dead"):
                break
            time.sleep(0.5)

        pg.evaluate("""() => {
          const p = window.__sfh3.screen.combat.player;
          p.status.hpCur = p.status.hpMax;
          p.status.sSpawn = 0; p.status.sFrozen = 0;
          p.gun.curGun.clipAmmo = Math.max(p.gun.curGun.clipSize, 20);
          p.gun.reloading = false; p.gun.shootDelay = 0;
          p.gun.shotPressed = false;
        }""")
        time.sleep(0.2)
        base = pg.evaluate(SAMPLE)
        print("before:", base)
        if base["frame"] != "idle":
            fails.append(f"the arm was not idle before the shot ({base['frame']})")
        if any(m["visible"] for m in base["muzzles"]):
            fails.append("a flash was already up before the shot")

        pg.mouse.move(700, 320)
        pg.mouse.down()
        seen, fired, shot_at = [], False, None
        for i in range(60):
            s = pg.evaluate(SAMPLE)
            seen.append(s)
            if s["frame"] == "fire" or (s["label"] or "").endswith("_fire"):
                fired = True
            hot = [m for m in s["muzzles"] if m["visible"] and m["tex"] > 0]
            if hot and shot_at is None:
                shot_at = i
                pg.screenshot(path=os.path.join(SHOTS, "muzzle_flash.png"))
            time.sleep(0.016)
        pg.mouse.up()

        for i, s in enumerate(seen[:20]):
            vis = [f"{m['key']}({m['w']}x{m['h']})"
                   for m in s["muzzles"] if m["visible"]]
            print(f"  t{i:<2} frame={s['frame']:<8} arm={s['arm']:<5}"
                  f" label={str(s['label']):<18} flash={vis}")

        ever = any(s["muzzles"] for s in seen)
        if not fired:
            fails.append("the gun never played its fire animation -- the shot "
                         "was refused, so this run proves nothing about the flash")
        elif not ever:
            fails.append("`drawMuzzle` never made a sprite at all: either the "
                         "arm rows carry no `muzzle:` placement (re-bake "
                         "tools/units/bake_arm_anim.py) or the atlas group is "
                         "missing (tools/units/bake_unit_parts.py)")
        elif shot_at is None:
            fails.append("a muzzle sprite exists but never became visible with "
                         "a texture on any frame of the burst")
        else:
            print(f"\nflash first visible at sample {shot_at}"
                  f" -> shots/muzzle_flash.png")

        hard = [e for e in errs if "Failed to load" not in e]
        if hard:
            fails.append(f"console errors: {hard[:3]}")
        b.close()

    if fails:
        for f in fails:
            print("FAIL ", f)
        return 1
    print("\nOK - the weapon flashes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
