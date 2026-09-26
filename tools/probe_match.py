#!/usr/bin/env python3
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from devurl import goto_menu

URL = os.environ.get("SFH3_URL", "http://localhost:5178/")
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "shots")

SHOW_PICKER = """() => {
  const g = window.__sfh3.screen;
  g.combat.player.human = false;
  return true;
}"""


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(SHOTS, exist_ok=True)
    fails = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 800, "height": 600},
                        device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(pg, URL)
        time.sleep(2.5)

        started = pg.evaluate("""() => {
          const D = window.sfh3Dev, SD = D.SD;
          let stage = 0;
          for (let i = 1; i < 60; i++) {
            if ((D.mission(i)?.team1 ?? 0) >= 3) { stage = i; break; }
          }
          if (!stage) return 0;
          SD.curStage = stage;
          while (SD.heroes.length < 3) SD.heroes.push(D.newHero('mer'));
          SD.squad = [0, 1, 2];
          window.__sfh3.screen.startMatch();
          return 3;
        }""")
        if not started:
            print("FAIL  no campaign stage fields a squad of three")
            b.close()
            return 1
        for _ in range(60):
            if pg.evaluate("() => !!(window.__sfh3.screen && window.__sfh3.screen.combat)"):
                break
            time.sleep(0.5)

        state = pg.evaluate("""() => {
          const g = window.__sfh3.screen;
          if (!g || !g.combat) return null;
          return { units: g.combat.units.length,
                   player: g.combat.units.indexOf(g.combat.player),
                   human: g.combat.player.human,
                   heads: g.hud.heads.map(h => h && h.cls) };
        }""")
        if not state:
            print("FAIL  the match never started (no combat world)")
            print("\n".join(errs[:10]))
            b.close()
            return 1
        print("match:", state)
        if state["units"] < started:
            fails.append(f"roster is {state['units']}, want >= {started}")

        for _ in range(40):
            if pg.evaluate("() => window.__sfh3.screen.hud.mode === 'idle'"):
                break
            time.sleep(0.25)

        for _ in range(60):
            if pg.evaluate("() => !window.__sfh3.screen.combat.player.dead"):
                break
            time.sleep(0.5)
        pg.evaluate("""() => { const p = window.__sfh3.screen.combat.player;
          p.status.hpCur = p.status.hpMax;
          if (p.status.arMax) p.status.arCur = p.status.arMax; }""")
        time.sleep(0.3)
        live = pg.evaluate("""() => {
          const g = window.__sfh3.screen, h = g.hud, p = g.combat.player;
          return {
            hp: h.txtHp.text, gun: h.txtCurgun.text, ammo: h.txtAmmo.text,
            hpBar: h.barSprites.hp.width,
            radarParented: h.children.indexOf(h.radar) >= 0,
            radarMap: h.radar.map.texture.width > 2,
            options: !!h.options,
            clip: p.gun.curGun.clipAmmo, spare: p.gun.curGun.spareAmmo,
          };
        }""")
        print("live:", live)
        if not live["hp"] or not live["gun"] or not live["ammo"]:
            fails.append(f"HUD readouts are blank: {live}")
        if live["hpBar"] <= 0:
            fails.append("the health bar has zero width")
        if not live["radarParented"]:
            fails.append("the radar is not on the HUD's display list")
        if not live["radarMap"]:
            fails.append("the radar has no map texture")
        if not live["options"]:
            fails.append("the match never received SD.options (pause rows blank)")

        for _ in range(60):
            if pg.evaluate("() => !window.__sfh3.screen.combat.player.dead"):
                break
            time.sleep(0.5)
        pg.evaluate("""() => { const p = window.__sfh3.screen.combat.player;
          p.status.hpCur = p.status.hpMax;
          p.gun.curGun.spareAmmo = Math.max(p.gun.curGun.spareAmmo, 30);
          p.gun.curGun.clipAmmo = 0; }""")
        pg.keyboard.press("r")
        time.sleep(3.5)
        rel = pg.evaluate("""() => {
          const p = window.__sfh3.screen.combat.player;
          const cg = p.gun.curGun;
          return { clip: cg.clipAmmo, spare: cg.spareAmmo, size: cg.clipSize,
                   infSpare: cg.infSpare };
        }""")
        print("reload:", rel)
        if rel["clip"] <= 0:
            fails.append(f"R did not reload: clip {rel['clip']}")
        if not rel["infSpare"] and rel["spare"] >= 30:
            fails.append("the reload did not draw from spare ammo")

        before = pg.evaluate("() => window.__sfh3.screen.hud.scoreTxt1.text")
        pg.evaluate("""() => {
          const g = window.__sfh3.screen, p = g.combat.player;
          const foe = g.combat.units.find(u => u.team !== p.team && !u.dead);
          if (foe) foe.status.damage(99999, p, p.gun.curGun, {}, true);
        }""")
        time.sleep(0.6)
        after = pg.evaluate("() => window.__sfh3.screen.hud.scoreTxt1.text")
        print("score:", before, "->", after)
        if before == after:
            fails.append(f"a kill did not move the scorebar (stuck at {before!r})")

        pg.evaluate(SHOW_PICKER)
        time.sleep(0.4)
        vis = pg.evaluate("""() => {
          const h = window.__sfh3.screen.hud;
          return { heads: h.headCont.visible, sel: h.selectBtn.visible,
                   tiles: h.headTiles.map(t => t.root.visible) };
        }""")
        print("visible:", vis)
        if not vis["heads"]:
            fails.append("the head row did not come up when the player stopped being human")
        if not vis["sel"]:
            fails.append("bt_select did not come up")
        pg.screenshot(path=os.path.join(SHOTS, "heads_row.png"))

        target = pg.evaluate("""() => {
          const h = window.__sfh3.screen.hud;
          for (let i = 0; i < 5; i++) {
            if (h.heads[i] && i !== h.headSel) {
              const t = h.headTiles[i].root;
              return { i, x: t.x, y: t.y };
            }
          }
          return null;
        }""")
        if not target:
            fails.append("no unselected squad tile to click")
        else:
            print("clicking head", target)
            pg.mouse.move(target["x"], target["y"])
            time.sleep(0.2)
            pg.mouse.down()
            time.sleep(0.12)
            pg.mouse.up()
            time.sleep(0.5)
            after = pg.evaluate("""() => {
              const g = window.__sfh3.screen, h = g.hud;
              const p = g.combat.player;
              return { sel: h.headSel, human: p.human, charSelect: p.charSelect,
                       changing: !!g.changeHero,
                       preview: g.combat.units.indexOf(p),
                       anyHuman: g.combat.units.some(u => u.human) };
            }""")
            print("after head click:", after)
            if after["sel"] != target["i"]:
                fails.append(f"ring is on slot {after['sel']}, want {target['i']}")
            if not after["changing"]:
                fails.append("the click did not stage a changeHero")
            if after["anyHuman"]:
                fails.append("a preview left somebody human")
            if not after["charSelect"]:
                fails.append("the previewed unit is not charSelect")
            pg.screenshot(path=os.path.join(SHOTS, "heads_preview.png"))

            sel = pg.evaluate("""() => {
              const s = window.__sfh3.screen.hud.selectBtn;
              return { x: s.x, y: s.y, w: s.width, h: s.height };
            }""")
            pg.mouse.move(sel["x"] + sel["w"] / 2, sel["y"] + sel["h"] / 2)
            time.sleep(0.2)
            pg.mouse.down()
            time.sleep(0.12)
            pg.mouse.up()
            time.sleep(0.5)
            done = pg.evaluate("""() => {
              const g = window.__sfh3.screen;
              const p = g.combat.player;
              return { human: p.human, charSelect: p.charSelect,
                       changing: !!g.changeHero,
                       brains: g.combat.brains.size,
                       braindPlayer: g.combat.brains.has(p),
                       player: g.combat.units.indexOf(p),
                       selVisible: g.hud.selectBtn.visible };
            }""")
            print("after select:", done)
            if not done["human"]:
                fails.append("bt_select did not hand over control")
            if done["player"] != after["preview"]:
                fails.append("the commit landed on a different unit than the preview")
            if done["changing"]:
                fails.append("changeHero was not cleared")
            if done["braindPlayer"]:
                fails.append("the new human kept its brain")
            if done["brains"] != state["units"] - 1:
                fails.append(
                    f"brains is {done['brains']}, want {state['units'] - 1} "
                    "(every unit but the human)")
            pg.screenshot(path=os.path.join(SHOTS, "heads_committed.png"))

        hard = [e for e in errs if "Failed to load" not in e]
        if hard:
            fails.append(f"console errors: {hard[:3]}")
        b.close()

    if fails:
        for f in fails:
            print("FAIL ", f)
        return 1
    print("\nOK - readouts, radar, options, reload, score and the squad picker")
    return 0


if __name__ == "__main__":
    sys.exit(main())
