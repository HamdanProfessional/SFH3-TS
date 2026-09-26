#!/usr/bin/env python3
import os
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from devurl import goto_menu, wait_for_art

URL = os.environ.get("SFH3_URL", "http://localhost:5175/")
SIZE = (800, 600)
TRIES = int(os.environ.get("SFH3_PREDICT_TRIES", "5"))
OFF = os.environ.get("SFH3_PREDICT_OFF") == "1"

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

PREDICT_OFF = """
() => {
  const nm = window.__sfh3?.screen?.net;
  if (!nm) return false;
  nm.predictLocal = () => {};
  return true;
}
"""

ARM = """
() => {
  const s = window.__sfh3?.screen;
  if (!s || !s.unitViews || !s.player) return false;
  const st = { rows: [], down: -1, done: false };
  window.__lat = st;
  const onKey = (e) => {
    if (e.code === 'KeyD' && st.down < 0) st.down = performance.now();
  };
  window.addEventListener('keydown', onKey, true);
  const player = s.player;
  const until = performance.now() + 2500;
  const loop = () => {
    const sp = s.unitViews.get(player);
    if (sp) st.rows.push([performance.now(), sp.x]);
    if (performance.now() < until) requestAnimationFrame(loop);
    else {
      window.removeEventListener('keydown', onKey, true);
      st.done = true;
    }
  };
  requestAnimationFrame(loop);
  return true;
}
"""

READY = """
() => {
  const s = window.__sfh3?.screen;
  const u = s?.player;
  if (!u || u.dead || !u.visible) return false;
  if (u.status?.sSpawn) return false;
  return s.gameStarted === true;
}
"""

DRIVING = "() => (window.__sfh3?.screen?.net?.slot ?? -1) >= 0"


STILL_PX = 1.0
STILL_MS = 300.0


def latency(rows, down):
    if down < 0 or len(rows) < 10:
        return None, None
    before = [(t, x) for t, x in rows if t <= down]
    if len(before) < 5:
        return None, None
    x0 = before[-1][1]
    settled = [x for t, x in before if t >= down - STILL_MS]
    drift = max(abs(x - x0) for x in settled) if settled else 0.0
    if drift > STILL_PX:
        return None, drift
    for t, x in rows:
        if t > down and abs(x - x0) > STILL_PX:
            return t - down, drift
    return None, drift


def main():
    from playwright.sync_api import sync_playwright

    errs = []

    def on_console(m):
        if m.type != "error":
            return
        where = (m.location or {}).get("url", "")
        if "servers.json" in where or "favicon.ico" in where:
            return
        errs.append(f"{m.text}  <{where}>" if where else m.text)

    samples = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False)
        pg = b.new_page(viewport={"width": SIZE[0], "height": SIZE[1]},
                        device_scale_factor=1)
        pg.on("console", on_console)
        pg.on("pageerror", lambda e: errs.append(str(e)))

        goto_menu(pg, URL)
        if not pg.evaluate(UNLOCK):
            print("!! no dev hook -- is this a DEV build?")
            return 1
        wait_for_art(pg)

        joined = False
        for attempt in range(4):
            time.sleep(4.0 if attempt == 0 else 3.0)
            pg.mouse.click(400, 64 + 50 + 23)
            try:
                pg.wait_for_function(
                    "() => window.__sfh3?.screen?.constructor?.name === 'GameScreen'",
                    timeout=25000)
                joined = True
                break
            except Exception:
                pass
        if not joined:
            print("!! never reached GameScreen -- is the server running?")
            return 1

        pg.wait_for_function("() => window.__sfh3?.screen?.gameStarted === true",
                             timeout=60000)
        if not pg.evaluate(DRIVING):
            print("!! joined mid-round as a spectator -- nothing here would be "
                  "this client's own latency. Restart the room and retry.")
            return 1
        if OFF and not pg.evaluate(PREDICT_OFF):
            print("!! could not turn prediction off")
            return 1

        for i in range(TRIES):
            try:
                pg.wait_for_function(READY, timeout=30000)
            except Exception:
                print(f"   try {i + 1}: never got a live body, skipping")
                continue
            time.sleep(0.9)
            if not pg.evaluate(ARM):
                continue
            time.sleep(0.5)
            pg.keyboard.down("d")
            time.sleep(0.8)
            pg.keyboard.up("d")
            pg.wait_for_function("() => window.__lat && window.__lat.done",
                                 timeout=8000)
            st = pg.evaluate("() => window.__lat")
            ms, drift = latency(st["rows"], st["down"])
            if ms is None:
                why = ("was already moving "
                       f"({drift:.1f}px before the press)" if drift
                       and drift > STILL_PX else "no movement seen")
                print(f"   try {i + 1}: {why}, skipping")
            else:
                samples.append(ms)
                print(f"   try {i + 1}: {ms:6.1f} ms   "
                      f"(still to {drift:.2f}px beforehand)")
            pg.keyboard.down("a")
            time.sleep(0.8)
            pg.keyboard.up("a")

        b.close()

    print()
    if OFF:
        print("** prediction was disabled for this run **")
    if not samples:
        print("!! no usable presses")
        return 1
    med = statistics.median(samples)
    print(f"presses measured  {len(samples)} of {TRIES}")
    print(f"INPUT TO MOTION   {med:.1f} ms median "
          f"({min(samples):.1f}-{max(samples):.1f})")
    print()
    print("  ~150ms+ = drawn off the snapshot; every press waits for the server")
    print("  ~1 frame = predicted locally and corrected behind your back")

    if errs:
        print(f"\n!! {len(errs)} console error(s)")
        for e in errs[:5]:
            print(f"   {e}")
        return 1
    if OFF:
        print(f"\nbaseline recorded at {med:.1f} ms")
        return 0
    ok = med < 80
    print(f"\n{'OK -- the press lands locally' if ok else '!! STILL WAITING ON THE SERVER'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
