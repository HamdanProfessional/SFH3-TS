#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from devurl import goto_menu, wait_for_art

URL = os.environ.get("SFH3_URL", "http://localhost:5175/")

MUSIC_SECS = 5.0

INSTRUMENT = """(() => {
  const live = new Set();
  const log = [];
  const proto = AudioBufferSourceNode.prototype;
  const start = proto.start, stop = proto.stop;
  let n = 0;
  proto.start = function (...a) {
    this.__id = ++n;
    live.add(this);
    log.push({ev: 'start', id: this.__id, loop: this.loop,
              dur: this.buffer ? +this.buffer.duration.toFixed(2) : 0});
    this.addEventListener('ended', () => live.delete(this));
    return start.apply(this, a);
  };
  proto.stop = function (...a) {
    live.delete(this);
    log.push({ev: 'stop', id: this.__id || 0});
    return stop.apply(this, a);
  };
  window.__audio = {
    live,
    log,
    music: () => [...live].filter(
      (s) => s.loop && s.buffer && s.buffer.duration > %(secs)s)
      .map((s) => ({id: s.__id, dur: +s.buffer.duration.toFixed(1)})),
    voices: () => [...live].length,
  };
})();
""" % {"secs": MUSIC_SECS}

OPEN = """() => {
  const D = window.sfh3Dev, SD = D.SD;
  SD.stages = [0,1,2,3,4,5,6,7,8,9,10,11];
  SD.funds = 9999999;
  SD.bpOwned = [2,3,4,6,7,8,9,11,12,13];
  SD.bpBuilt = [0,1,5];
  window.__sfh3.screen.goto('workshop');
  return {owned: SD.bpOwned.length};
}"""

BTNS = """() => {
  const s = window.__sfh3.screen, page = s.page;
  if (!page) return {err: 'no page'};
  const out = {};
  const scan = (c) => {
    for (const ch of c.children) {
      if (ch.constructor && ch.constructor.name === 'Button'
          && (ch.text === '<' || ch.text === '>')) {
        const p = ch.getGlobalPosition();
        out[ch.text === '<' ? 'prev' : 'next'] =
          [p.x + ch.w / 2, p.y + ch.h / 2];
      }
      if (ch.children && ch.children.length) scan(ch);
    }
  };
  scan(page.view);
  out.scale = window.__sfh3.app.renderer.canvas.width
            / window.__sfh3.app.renderer.width;
  out.musicKey = window.sfh3Dev.SH ? window.sfh3Dev.SH.currentKey : '?';
  return out;
}"""

STATE = """() => ({
  music: window.__audio.music(),
  voices: window.__audio.voices(),
  all: [...window.__audio.live].map((s) => ({
    id: s.__id, loop: s.loop,
    dur: s.buffer ? +s.buffer.duration.toFixed(1) : 0,
  })).sort((a, b) => b.dur - a.dur),
  key: window.sfh3Dev.SH ? window.sfh3Dev.SH.currentKey : '?',
  vol: window.sfh3Dev.SH ? +window.sfh3Dev.SH.musicVolume.toFixed(3) : 0,
})"""


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=False, args=[
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio",
        ])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(INSTRUMENT)
        goto_menu(pg, URL)
        pg.mouse.click(640, 700)
        time.sleep(1.0)

        print("open:", pg.evaluate(OPEN))
        wait_for_art(pg)
        time.sleep(1.5)

        b = pg.evaluate(BTNS)
        if "err" in b or "next" not in b:
            print("!! pager not found:", b)
            br.close()
            return 1
        sc = b["scale"]
        print(f"pager found, scale {sc}, music key {b['musicKey']}")

        base = pg.evaluate(STATE)
        print("before :", base)
        if len(base["music"]) != 1:
            print(f"!! precondition: expected exactly 1 music source, "
                  f"got {len(base['music'])}")

        for i in range(6):
            side = "next" if i % 2 == 0 else "prev"
            x, y = b[side]
            pg.mouse.click(x * sc, y * sc)
            time.sleep(0.6)
            st = pg.evaluate(STATE)
            print(f"click {side:4s} -> music={len(st['music'])} "
                  f"voices={st['voices']} key={st['key']} vol={st['vol']}")
            print(f"            live: {st['all']}")
            b2 = pg.evaluate(BTNS)
            if "next" in b2:
                b = b2

        final = pg.evaluate(STATE)
        bad = len(final["music"]) > 1
        print()
        print("STACKED" if bad else "clean", "--",
              len(final["music"]), "music sources live")
        pg.screenshot(path=os.path.join(REPO, "shots", "ws_music.png"))
        br.close()
        return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
