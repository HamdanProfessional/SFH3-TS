#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
sys.path.insert(0, SC)
import check_unit_parts as C

SHOTS = os.path.join(REPO, "shots")
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5176/"

SETUP = """async () => {
  const { newHero } = await import('/src/game/newHero.ts');
  const SD = window.sfh3Dev.SD;
  const mk = (hero, look) => { Object.assign(hero, look); return hero; };
  const h0 = mk(SD.heroes[0],
    { name: 'Wes', cls: 'eng', level: 1, head: 81, body: 81, color: 1,
      face: 1, skin: 1, hair: 1, primary: null, secondary: null });
  const h1 = mk(newHero('med'),
    { name: 'Ada', cls: 'med', level: 1, head: 101, body: 101, color: 4,
      face: 2, skin: 5, hair: 2, primary: null, secondary: null });
  const h2 = mk(newHero('sni'),
    { name: 'Iris', cls: 'sni', level: 1, head: 61, body: 61, color: 6,
      face: 3, skin: 8, hair: 3, primary: null, secondary: null });
  SD.heroes = [h0, h1, h2];
  SD.squad = [0, 1, 2];
  return SD.heroes.map(h => [h.name, h.head, h.body, h.color, h.face, h.skin, h.hair]);
}"""

INFO = """() => {
  const e = window.__sfh3, s = e.screen;
  const canvas = document.querySelector('canvas');
  const k = canvas.clientWidth / e.app.screen.width;
  return [...s.unitViews.entries()].map(([u, v]) => {
    const g = v.getGlobalPosition();
    const gun = u.gun;
    const cur = gun && gun.curGun, other = gun && gun.otherGun;
    return {
      name: u.unitInfo.name, cls: u.unitInfo.cls, human: u.human,
      sx: g.x * k, sy: g.y * k, scale: k,
      hero: { head: u.unitInfo.head, body: u.unitInfo.body, color: u.unitInfo.color,
              face: u.unitInfo.face, skin: u.unitInfo.skin, hair: u.unitInfo.hair },
      anim: u.MC.curAnim, frame: u.MC.currentFrame, flip: u.flip,
      arm: Math.round(u.armRotation * 100) / 100,
      head: Math.round(u.headRotation * 100) / 100,
      armX: u.MC.armX, rot: u.MC.rotation,
      cur: cur ? { sprite: cur.sprite, rarity: cur.rarity, idle: cur.frameIdle } : null,
      other: other ? { sprite: other.sprite, rarity: other.rarity, unequip: other.unequip } : null,
      spriteArm: v.sprites.get('arm1.gun') ? Math.round(v.sprites.get('arm1.gun').rotation * 180 / Math.PI * 100) / 100 : null,
      spriteHead: v.sprites.get('head') ? Math.round(v.sprites.get('head').rotation * 180 / Math.PI * 100) / 100 : null,
    };
  });
}"""


def crop_player(shot: str, info: dict, out: str, scale: float, w=260, h=340) -> tuple[Image.Image, float, float]:
    im = Image.open(shot)
    cx, cy = info["sx"], info["sy"]
    box = (int(cx - w / 2), int(cy - h * 0.65), int(cx + w / 2), int(cy + h * 0.35))
    got = im.crop(box)
    tw, th = round(got.width / scale), round(got.height / scale)
    got = got.resize((tw, th), Image.LANCZOS)
    got.save(out)
    return got, (cx - box[0]) / scale, (cy - box[1]) / scale


def diff_mask(label: str, mask: Image.Image, ref: Image.Image) -> int:
    if mask.size != ref.size:
        print(f"  FAIL {label}: size {mask.size} != {ref.size}")
        return 1
    ma = mask.load()
    ra = ref.getchannel("A").load()
    w, h = mask.size
    bad = 0
    for y in range(h):
        for x in range(w):
            if (ma[x, y] > 32) == (ra[x, y] > 32):
                continue
            hit = False
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and ma[nx, ny] > 32 and ra[nx, ny] > 32:
                        hit = True
            if not hit:
                bad += 1
    frac = bad / (w * h)
    status = "ok" if frac < 0.02 else "FAIL"
    print(f"  {status} {label}: {bad} edge px differ ({frac * 100:.2f}%)")
    return 0 if status == "ok" else 1


def ensure_match(pg) -> None:
    pg.wait_for_function("() => window.__sfh3 && window.__sfh3.screen", timeout=60000)
    if pg.evaluate("() => window.__sfh3.screen.constructor.name") != "GameScreen":
        pg.wait_for_timeout(1500)
        pg.evaluate(SETUP)
        pg.evaluate("() => window.__sfh3.screen.startMatch()")
        pg.wait_for_function("() => window.__sfh3.screen.constructor.name === 'GameScreen'",
                             timeout=30000)
        pg.wait_for_timeout(2000)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 1600, "height": 900})
        pg.goto(URL)
        pg.wait_for_function("() => window.__sfh3 && window.__sfh3.screen && window.sfh3Dev",
                             timeout=30000)
        pg.wait_for_timeout(1200)
        print("heroes:", pg.evaluate(SETUP))
        pg.evaluate("() => window.__sfh3.screen.startMatch()")
        pg.wait_for_function("() => window.__sfh3.screen.constructor.name === 'GameScreen'",
                             timeout=30000)
        pg.wait_for_timeout(2500)

        for tag, (mx, my) in (("up", (1150, 180)), ("down", (240, 780))):
            pg.mouse.move(mx, my)
            pg.wait_for_timeout(650)
            ensure_match(pg)
            shot = os.path.join(SHOTS, f"_ws3_match_aim_{tag}.png")
            pg.screenshot(path=shot)
            infos = pg.evaluate(INFO)
            print(f"aim {tag}:", json.dumps(infos, indent=1)[:1400])
            human = next((i for i in infos if i["human"]), None)
            if human:
                crop_player(shot, human, os.path.join(SHOTS, f"_ws3_player_aim_{tag}.png"),
                            human["scale"])

        ensure_match(pg)
        pg.evaluate("""() => {
          const s = window.__sfh3.screen;
          const p = s.player;
          let i = 0;
          for (const [u] of s.unitViews) {
            if (u === p || u.team !== p.team) continue;
            u.x = p.x + 80 + i * 80; u.y = p.y; u.mov.xVel = 0; u.mov.yVel = 0;
            i++;
          }
        }""")
        pg.wait_for_timeout(400)
        pg.evaluate("""() => {
          const s = window.__sfh3.screen;
          for (const [u] of s.unitViews) {
            if (u.team !== s.player.team) continue;
            u.MC.playing = false; u.MC.curAnim = 'idle'; u.MC.currentFrame = 1;
            u.unitInfo.extra.noAim = true; u.aimX = u.x + 140; u.aimY = u.y - 140;
          }
        }""")
        pg.wait_for_timeout(250)
        pg.evaluate("""() => {
          const s = window.__sfh3.screen;
          s.paused = true; s.hud.visible = false; s.aimer.visible = false;
        }""")
        pg.wait_for_timeout(150)
        infos = [i for i in pg.evaluate(INFO) if i["name"] in ("Wes", "Ada", "Iris")]
        pg.evaluate("""() => {
          const s = window.__sfh3.screen;
          for (const v of s.unitViews.values()) v.visible = false;
        }""")
        pg.screenshot(path=os.path.join(SHOTS, "_ws3_heroes_bg.png"))
        rows = []
        for info in infos:
            pg.evaluate("""(name) => {
              const s = window.__sfh3.screen;
              for (const [u, v] of s.unitViews) v.visible = (u.unitInfo.name === name);
            }""", info["name"])
            pg.wait_for_timeout(120)
            full = os.path.join(SHOTS, f"_ws3_hero_{info['name']}_full.png")
            pg.screenshot(path=full)
            info = [i for i in pg.evaluate(INFO) if i["name"] == info["name"]][0]
            got = Image.open(full).convert("RGB")
            bg = Image.open(os.path.join(SHOTS, "_ws3_heroes_bg.png")).convert("RGB")
            k = info["scale"]
            cx, cy = info["sx"], info["sy"]
            box = (int(cx - 160), int(cy - 280), int(cx + 140), int(cy + 60))
            gc = got.crop(box).resize((round(300 / k), round(340 / k)), Image.LANCZOS)
            bc = bg.crop(box).resize((round(300 / k), round(340 / k)), Image.LANCZOS)
            mask = ImageChops.difference(gc, bc).convert("L").point(lambda v: 255 if v > 28 else 0)
            fox, foy = (cx - box[0]) / k, (cy - box[1]) / k
            gun_frame = -1
            if info["cur"]:
                gun_frame = C.RIG["gunLabels"].get(info["cur"]["sprite"], -1)
                if 0 <= info["cur"]["rarity"] <= 3:
                    gun_frame += info["cur"]["rarity"]
            stow = None
            if info["other"] and info["other"]["unequip"]:
                f2 = C.RIG["stowLabels"].get(info["other"]["sprite"], -1)
                if 0 <= info["other"]["rarity"] <= 3:
                    f2 += info["other"]["rarity"]
                stow = {"target": info["other"]["unequip"], "frame": f2}
            ref = C.compose_figure(info["frame"], info["hero"], info["cur"]["idle"], gun_frame,
                                   info["arm"], info["head"], fox, foy, mask.size, stow=stow,
                                   flip=info["flip"])
            print(f"== {info['name']} {info['hero']} arm={info['arm']} flip={info['flip']}")
            diff_mask(f"{info['name']} browser vs composed", mask, ref)
            side = Image.new("RGBA", (mask.width * 2 + 4, mask.height), (20, 24, 30, 255))
            side.alpha_composite(Image.merge("RGBA", (mask, mask, mask, mask)), (0, 0))
            side.alpha_composite(ref, (mask.width + 4, 0))
            side.save(os.path.join(SHOTS, f"_ws3_hero_{info['name']}_compare.png"))
            mask.save(os.path.join(SHOTS, f"_ws3_hero_{info['name']}_mask.png"))
            ref.save(os.path.join(SHOTS, f"_ws3_hero_{info['name']}_ref.png"))
            rows.append((info["name"], side))
        if rows:
            w = rows[0][1].width
            h = rows[0][1].height
            montage = Image.new("RGBA", (w * len(rows), h), (20, 24, 30, 255))
            for i, (_n, im) in enumerate(rows):
                montage.alpha_composite(im, (i * w, 0))
            montage.save(os.path.join(SHOTS, "_ws3_heroes_montage.png"))
            print("montage:", [r[0] for r in rows])
        pg.evaluate("""() => {
          const s = window.__sfh3.screen;
          s.hud.visible = true; s.aimer.visible = true;
          for (const v of s.unitViews.values()) v.visible = true;
          s.paused = false;
        }""")

        ensure_match(pg)
        pg.evaluate("""() => {
          window.__sfh3.screen.units.forEach((u, i) => {
            u.spawn(220 + i * 110, 300, 'spawn', true);
            u.MC.currentFrame = 45;
            u.MC.playing = false;
          });
          window.__sfh3.screen.paused = true;
        }""")
        pg.wait_for_timeout(250)
        pg.screenshot(path=os.path.join(SHOTS, "_ws3_spawn.png"))
        pg.evaluate("() => { window.__sfh3.screen.paused = false; }")
        spawn = pg.evaluate("""() => window.__sfh3.screen.units.map(
          u => [u.unitInfo.name, u.MC.curAnim, u.MC.currentFrame, u.MC.gunsVisible])""")
        print("spawn:", spawn)

        pg.evaluate("""() => {
          const s = window.__sfh3.screen;
          const bot = s.units.find(u => !u.human && !u.dead);
          bot.status.damage(9999, s.player, s.player.gun.curGun, {}, true);
          bot.respawnTimer = 1;
          window.__respawnTest = bot.unitInfo.name;
        }""")
        pg.wait_for_function("""() => {
          const s = window.__sfh3.screen;
          const u = s.units.find(x => x.unitInfo.name === window.__respawnTest);
          if (u && !u.dead && u.MC.curAnim === 'spawn' && u.MC.currentFrame > 40) {
            s.paused = true;
            return true;
          }
          return false;
        }""", timeout=10000)
        pg.screenshot(path=os.path.join(SHOTS, "_ws3_spawn_respawn.png"))
        pg.evaluate("() => { window.__sfh3.screen.paused = false; }")
        print("respawn:", pg.evaluate("""() => {
          const s = window.__sfh3.screen;
          const u = s.units.find(x => x.unitInfo.name === window.__respawnTest);
          return [u.unitInfo.name, u.MC.curAnim, u.MC.currentFrame, u.MC.gunsVisible, u.dead ? 'dead' : 'alive'];
        }"""))
        b.close()


if __name__ == "__main__":
    main()
