#!/usr/bin/env python3
import json
import os
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from devurl import goto_menu, wait_for_art

URL = os.environ.get("SFH3_URL", "http://localhost:5175/")
SIZE = (800, 600)
SECONDS = float(os.environ.get("SFH3_JITTER_SECONDS", "4"))
OLD_WAY = os.environ.get("SFH3_JITTER_BEFORE") == "1"

BEFORE = """
() => {
  const nm = window.__sfh3?.screen?.net;
  if (!nm || !nm.clock) return false;
  nm.clock.bracket = (snaps) => {
    const a = snaps[snaps.length - 1];
    return { a, b: a, f: 0 };
  };
  return true;
}
"""

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

START = """(seconds) => {
  const s = window.__sfh3?.screen;
  if (!s || !s.unitViews) return false;
  const rows = [];
  window.__jit = { rows, done: false };
  const until = performance.now() + seconds * 1000;
  const loop = () => {
    const xs = [];
    const ys = [];
    const lx = [];
    let live = 0;
    let i = 0;
    for (const [u, sp] of s.unitViews) {
      xs.push(sp.x);
      ys.push(sp.y);
      lx.push(u.x);
      if (u.visible && !u.dead) live |= (1 << i);
      i++;
    }
    rows.push([performance.now(), live, xs, ys, lx]);
    if (performance.now() < until) requestAnimationFrame(loop);
    else window.__jit.done = true;
  };
  requestAnimationFrame(loop);
  return true;
}
"""


def runs(rows, n):
    out = [[] for _ in range(n)]
    cur = [[] for _ in range(n)]
    for _t, live, xs, ys, lx in rows:
        for i in range(n):
            if live & (1 << i):
                cur[i].append((xs[i], ys[i], lx[i]))
            else:
                if len(cur[i]) > len(out[i]):
                    out[i] = cur[i]
                cur[i] = []
    for i in range(n):
        if len(cur[i]) > len(out[i]):
            out[i] = cur[i]
    return out


def update_hz(logic, fps):
    lengths = []
    n = 1
    for i in range(1, len(logic)):
        if logic[i] == logic[i - 1]:
            n += 1
        else:
            lengths.append(n)
            n = 1
    lengths.append(n)
    lengths = lengths[1:-1]
    if not lengths:
        return None
    return fps / (sum(lengths) / len(lengths))


def analyse(rows):
    if len(rows) < 30:
        return None
    n = len(rows[0][2])
    fps = (len(rows) - 1) * 1000.0 / max(1e-6, rows[-1][0] - rows[0][0])

    hz_all = []
    frozen_all = []
    ratio_all = []
    moving = 0
    for samples in runs(rows, n):
        if len(samples) < 90:
            continue
        d = [abs(samples[i][0] - samples[i - 1][0])
             + abs(samples[i][1] - samples[i - 1][1])
             for i in range(1, len(samples))]
        if sum(d) < 400:
            continue
        moving += 1

        hz = update_hz([s[2] for s in samples], fps)
        if hz:
            hz_all.append(hz)

        w = 6
        gated = [v for i, v in enumerate(d)
                 if sum(d[max(0, i - w):i + w + 1]) / (2 * w + 1) > 0.35]
        if len(gated) > 30:
            frozen_all.append(sum(1 for v in gated if v < 0.01) / len(gated))
            live = sorted(v for v in gated if v >= 0.01)
            if live:
                p50 = statistics.median(live)
                p90 = live[int(len(live) * 0.9) - 1]
                ratio_all.append(p90 / p50 if p50 > 0 else 0)

    if not moving or not hz_all:
        return None
    return {
        "frames": len(rows),
        "fps": fps,
        "units_moving": moving,
        "hz": sum(hz_all) / len(hz_all),
        "frozen": sum(frozen_all) / len(frozen_all) if frozen_all else 0,
        "frozen_worst": max(frozen_all) if frozen_all else 0,
        "p90_over_p50": sum(ratio_all) / len(ratio_all) if ratio_all else 0,
    }


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
            pg.screenshot(path=os.path.join(
                os.path.dirname(HERE), "..", "shots", "jitter_stuck.png"))
            return 1

        pg.wait_for_function("() => window.__sfh3?.screen?.gameStarted === true",
                             timeout=60000)
        time.sleep(1.0)

        if OLD_WAY and not pg.evaluate(BEFORE):
            print("!! could not install the before-the-fix clock")
            return 1

        if not pg.evaluate(START, SECONDS):
            print("!! could not install the sampler")
            return 1
        pg.wait_for_function("() => window.__jit && window.__jit.done",
                             timeout=int(SECONDS * 3000) + 20000)
        rows = pg.evaluate("() => window.__jit.rows")
        b.close()

    r = analyse(rows)
    if not r:
        print("!! not enough moving bodies to measure "
              f"({len(rows)} frames sampled)")
        return 1

    print()
    if OLD_WAY:
        print("** the playback clock was disabled for this run **")
    print(f"frames sampled    {r['frames']}  ({r['fps']:.0f} fps)")
    print(f"bodies measured   {r['units_moving']}")
    print(f"POSITION UPDATES  {r['hz']:.1f} Hz")
    print(f"frozen frames     {r['frozen'] * 100:.1f}%   "
          f"(worst body {r['frozen_worst'] * 100:.1f}%)")
    print(f"step p90/p50      {r['p90_over_p50']:.2f}")
    print()
    print("  ~15 Hz = snapshots arriving raw; every second logic tick repeats")
    print("  ~30 Hz = the playback clock filling in the gap, one per tick")
    print("  p90/p50 near 1 means the steps are even rather than lurching")

    if errs:
        print(f"\n!! {len(errs)} console error(s)")
        for e in errs[:5]:
            print(f"   {e}")
        return 1
    if OLD_WAY:
        print(f"\nbaseline recorded at {r['hz']:.1f} Hz")
        return 0
    ok = r["hz"] > 22
    print(f"\n{'OK -- every logic tick moves' if ok else '!! STILL ON THE SNAPSHOT RATE'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
