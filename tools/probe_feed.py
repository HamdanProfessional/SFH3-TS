#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from devurl import goto_menu

URL = os.environ.get("SFH3_URL", "http://localhost:5174/")
SHOTS = os.path.join(REPO, "shots")

START = """() => {
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
  return stage;
}"""

FEED = """() => {
  const hud = window.__sfh3.screen.hud;
  const u = (name, team, human) => ({name, team, human});
  hud.addKillFeed(u('Johson', 1, true), u('Richards', 2, false), 'AWP.50 Cal');
  hud.addKillFeed(null, u('Perez', 2, false), 'Frag Grenade');
  hud.addKillstreakFeed(u('Johson', 1, true), 'Airstrike');
  hud.addCustomFeed(u('Wesley', 1, false), 'levelup');
  hud.addKillFeed(u('Bot Alpha', 2, false), u('Wesley', 1, false), 'M4A1');
  return hud.feeds.length;
}"""

DUMP = """() => {
  const hud = window.__sfh3.screen.hud;
  const c = hud.txtFeed;
  const b = c.getBounds();
  return {
    n: c.children.length,
    vis: c.visible,
    mode: hud.mode,
    stageW: window.__sfh3.app.renderer.width,
    pos: [c.x, c.y],
    bounds: [+b.x.toFixed(1), +b.y.toFixed(1),
             +b.width.toFixed(1), +b.height.toFixed(1)],
    stage: [window.__sfh3.width ?? null, window.__sfh3.height ?? null],
    lines: c.children.slice(0, 6).map((t) => ({
      s: t.text, x: +t.x.toFixed(1), y: +t.y.toFixed(1),
      w: +t.width.toFixed(1), fill: t.style && t.style.fill,
    })),
  };
}"""


def run(pw, w, h):
    b = pw.chromium.launch()
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    goto_menu(pg, URL)
    time.sleep(1.0)
    if not pg.evaluate(START):
        print("FAIL  no campaign stage fields a squad of three")
        b.close()
        return
    for _ in range(120):
        if pg.evaluate("() => !!(window.__sfh3.screen"
                       " && window.__sfh3.screen.combat)"):
            break
        time.sleep(0.5)
    for _ in range(60):
        if pg.evaluate("() => window.__sfh3.screen.hud.txtFeed.visible"):
            break
        time.sleep(0.5)
    time.sleep(1.0)
    print(f"--- {w}x{h} ---  feeds pushed: {pg.evaluate(FEED)}")
    time.sleep(0.5)
    d = pg.evaluate(DUMP)
    print(f"  txtFeed at {d['pos']} visible={d['vis']} "
          f"children={d['n']} mode={d['mode']!r} stageW={d['stageW']}")
    print(f"  bounds x[{d['bounds'][0]}, "
          f"{round(d['bounds'][0] + d['bounds'][2], 1)}] "
          f"y[{d['bounds'][1]}, {round(d['bounds'][1] + d['bounds'][3], 1)}]")
    for ln in d["lines"]:
        print(f"    {ln['x']:8.1f} {ln['y']:7.1f} w{ln['w']:7.1f}  {ln['s']!r}")
    path = os.path.join(SHOTS, f"feed_{w}x{h}.png")
    pg.screenshot(path=path)
    print("  wrote", path)
    for e in errs[:3]:
        print("  !! pageerror:", e[:140])
    b.close()


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as pw:
        run(pw, 800, 600)
        run(pw, 1366, 768)


if __name__ == "__main__":
    main()
