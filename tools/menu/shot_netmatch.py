#!/usr/bin/env python3
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from devurl import goto_menu, wait_for_art

OUT = os.path.normpath(os.path.join(HERE, "..", "..", "shots"))
URL = os.environ.get("SFH3_URL", "http://localhost:5175/")
SIZE = (800, 600)

UNLOCK = """
() => {
  const SD = window.sfh3Dev?.SD;
  const s = window.__sfh3?.screen;
  if (!SD || !s) return false;
  SD.stages = [0, 1, 2, 3, 4];
  SD.gotAkq = true;
  SD.mapItem.length = 0;
  SD.storeItem = null;
  SD.workshopItem = null;
  s.goto('multiplayer');
  return true;
}
"""

PROBE = """() => {
  const s = window.__sfh3?.screen;
  if (!s || !s.units || !s.units.length) return null;
  const u = s.units;
  const anims = {};
  for (const x of u) anims[x.MC.curAnim] = (anims[x.MC.curAnim] || 0) + 1;
  const p = s.player;
  return {
    screen: s.constructor.name,
    spectating: !u.some((x) => x.human),
    started: s.gameStarted,
    ended: s.gameEnded,
    units: u.length,
    alive: u.filter((x) => !x.dead).length,
    visible: u.filter((x) => x.visible).length,
    anims,
    arms: [...new Set(u.map((x) => x.MC.arm1.frame))].length,
    rots: [...new Set(u.map((x) => Math.round(x.rotArm)))].length,
    guns: [...new Set(u.map((x) => x.gun.curGun && x.gun.curGun.id))].length,
    kills: u.reduce((n, x) => n + x.score.kills, 0),
    deaths: u.reduce((n, x) => n + x.score.deaths, 0),
    xs: u.map((x) => Math.round(x.x)),
    ys: u.map((x) => Math.round(x.y)),
    me: p ? {
      hp: Math.round(p.status.hpCur), hpMax: Math.round(p.status.hpMax),
      ammo: p.gun.curGun ? p.gun.curGun.clipAmmo : -1,
      gun: p.gun.curGun ? p.gun.curGun.id : "",
      team: p.team, pscore: p.pscore,
    } : null,
  };
}
"""


def shot(pg, name, **clip):
    path = os.path.join(OUT, name)
    pg.screenshot(path=path, **clip)
    print(f"wrote {name}")


def main():
    os.makedirs(OUT, exist_ok=True)
    from playwright.sync_api import sync_playwright

    errs = []

    def on_console(m):
        if m.type != "error":
            return
        where = (m.location or {}).get("url", "")
        if "servers.json" in where or "favicon.ico" in where:
            return
        errs.append(f"{m.text}  <{where}>" if where else m.text)

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False)
        pg = b.new_page(viewport={"width": SIZE[0], "height": SIZE[1]},
                        device_scale_factor=2)
        pg.on("console", on_console)
        pg.on("pageerror", lambda e: errs.append(str(e)))

        goto_menu(pg, URL)
        if not pg.evaluate(UNLOCK):
            print("!! no dev hook -- is this a DEV build?")
            return 1
        wait_for_art(pg)
        time.sleep(2.5)

        pg.mouse.click(400, 64 + 50 + 23)
        time.sleep(1.2)
        shot(pg, "net_lobby.png")

        try:
            pg.wait_for_function(
                "() => window.__sfh3?.screen?.constructor?.name === 'GameScreen'",
                timeout=60000)
        except Exception:
            print("!! never reached GameScreen -- is the server running?")
            shot(pg, "net_stuck.png")
            return 1
        print("reached GameScreen")

        time.sleep(3.0)
        first = pg.evaluate(PROBE)
        shot(pg, "net_match.png")

        pg.keyboard.down("d")
        for i in range(12):
            pg.mouse.move(120 + i * 50, 300 + (i % 3) * 60)
            if i == 4:
                pg.mouse.down()
            time.sleep(0.25)
        pg.mouse.up()
        pg.keyboard.up("d")
        time.sleep(1.5)
        later = pg.evaluate(PROBE)
        shot(pg, "net_fight.png")
        shot(pg, "net_hud.png", clip={"x": 0, "y": 0, "width": 800, "height": 78})

        b.close()

    if not first or not later:
        print("!! the probe found no units at all")
        return 1

    print("\n-- first --\n" + json.dumps(first, indent=2)[:1400])
    print("\n-- later --\n" + json.dumps(later, indent=2)[:1400])

    bad = []
    if not later["started"]:
        bad.append("the server never lifted the intro gate")
    if later["units"] < 2:
        bad.append("fewer than two units were built")
    moved = sum(1 for a, b2 in zip(first["xs"], later["xs"]) if a != b2)
    if moved < 2:
        bad.append(f"only {moved} unit(s) moved between the two samples")
    if later["arms"] < 2:
        bad.append("every arm clip is on the same frame (ARM1 not applied?)")
    if later["rots"] < 2:
        bad.append("every unit aims the same way (ROT_ARM not applied?)")
    if later["spectating"]:
        print("\n!! joined MID-ROUND and is spectating; the input path was not"
              " exercised.\n!! restart the server and run again for the"
              " playing path.")
        if later["me"] is None:
            bad.append("spectating with no camera target (`follow` not wired?)")
    elif later["me"] is None:
        bad.append("there is no local player")
    elif later["me"]["ammo"] < 0:
        bad.append("the local player holds no weapon")

    if bad:
        print("\n!! " + "\n!! ".join(bad))
    if errs:
        print(f"\n!! {len(errs)} console error(s):")
        for e in dict.fromkeys(errs):
            print("  ", e[:300])
    if bad or errs:
        return 1
    print("\nOK -- a net match drew, moved, aimed and armed itself.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
