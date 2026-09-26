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
  const m = window.__sfh3.screen.getItem;
  return {
    frame: m.revealFrame,
    ok: !!m.ok,
    kids: m.content.children.map(c => ({
      x: Math.round(c.x), y: Math.round(c.y),
      sx: +c.scale.x.toFixed(4),
      w: Math.round(c.width), h: Math.round(c.height),
    })),
  };
}"""


def card(sample, x, y):
    for k in sample["kids"]:
        if abs(k["x"] - x) <= 1 and abs(k["y"] - y) <= 1:
            return k
    return None


RECORD = """([x, y]) => {
  window.__rec = [];
  const step = () => {
    const m = window.__sfh3.screen.getItem;
    if (m && m.isOpen && m.content) {
      for (const c of m.content.children) {
        if (Math.abs(c.x - x) > 1 || Math.abs(c.y - y) > 1) continue;
        window.__rec.push([m.revealFrame, +c.scale.x.toFixed(4),
                           Math.round(c.height), !!m.ok]);
        break;
      }
    }
    window.__recId = requestAnimationFrame(step);
  };
  step();
}"""


def watch(pg, n, at, x, y, shots):
    out = []
    for i in range(n):
        s = pg.evaluate(SAMPLE)
        s["card"] = card(s, x, y)
        out.append(s)
        if i in at:
            pg.screenshot(path=os.path.join(SHOTS, f"{shots}_{i}.png"))
        time.sleep(0.033)
    return out


def recorded(pg):
    rows = pg.evaluate("() => { cancelAnimationFrame(window.__recId);"
                       " return window.__rec; }")
    out = []
    for f, sx, h, ok in rows:
        if not out or out[-1][0] != f:
            out.append((f, sx, h, ok))
    return out


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
        time.sleep(2.5)

        pg.evaluate(RECORD, [388, 240])
        pg.evaluate("""() => {
          const D = window.sfh3Dev;
          window.__sfh3.screen.getItem.openReveal(D.newHero('mer'), () => {});
        }""")
        hero = watch(pg, 20, (0, 2, 13), 388, 240, "reveal_hero")
        rec = recorded(pg)
        for f, sx, h, ok in rec[:16]:
            print(f"  hero frame={f:<3} scale={sx:<8} h={h:<5} ok={ok}")

        want = [0.4314, 0.9097, 1.2818, 1.5475, 1.707, 1.7601]
        if not rec:
            fails.append("no card at the `item2` placement (388.1, 239.7)")
        else:
            print("  playhead:", [f for f, _s, _h, _o in rec])
            if rec[-1][0] != 13:
                fails.append(f"the playhead stopped at {rec[-1][0]}, want 13")
            if len(rec) < 13:
                fails.append(f"only {len(rec)} distinct frames -- the modal is "
                             "not being ticked every frame")
            held = [sx for f, sx, _h, _ok in rec if f >= len(want)]
            if any(abs(v - want[-1]) > 5e-3 for v in held):
                fails.append(f"the card moved after it settled: {held}")
            if any(ok for f, _sx, _h, ok in rec if f < 13):
                fails.append("OK was clickable before the reveal finished")
            if not rec[-1][3]:
                fails.append("OK never appeared -- the reveal cannot be dismissed")

        table = pg.evaluate("""([x, y, n]) => {
          const m = window.__sfh3.screen.getItem, out = [];
          for (let f = 0; f <= n; f++) {
            m.revealFrame = f;
            m.build();
            let sx = null;
            for (const c of m.content.children) {
              if (Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1) {
                sx = +c.scale.x.toFixed(4); break;
              }
            }
            out.push([f, sx, !!m.ok]);
          }
          return out;
        }""", [388, 240, 13])
        print("  table:", [(f, sx) for f, sx, _ok in table])
        for i, w in enumerate(want):
            got = table[i][1]
            if got is None:
                fails.append(f"frame {i} drew no card")
            elif abs(got - w) > 5e-3:
                fails.append(f"frame {i} scaled {got}, want {w}")
        for f, sx, _ok in table[len(want):]:
            if sx is None or abs(sx - want[-1]) > 5e-3:
                fails.append(f"frame {f} scaled {sx}, want the settled "
                             f"{want[-1]}")
        if table[12][2] or not table[13][2]:
            fails.append("OK does not appear on frame 13 and only frame 13: "
                         f"f12={table[12][2]} f13={table[13][2]}")

        pg.evaluate("() => window.__sfh3.screen.getItem.finish('')")
        time.sleep(0.4)

        pg.evaluate(RECORD, [396, 339])
        opened = pg.evaluate("""() => {
          const D = window.sfh3Dev;
          const g = D.makeGun(0, 5);
          if (!g) return false;
          window.__sfh3.screen.getItem.open(g, 'mapItem', () => {});
          return true;
        }""")
        if not opened:
            fails.append("no buildable gun to drop -- cannot test the get card")
        else:
            watch(pg, 12, (0, 1, 3, 6), 396, 339, "reveal_gun")
            rec = recorded(pg)
            for f, _sx, h, _ok in rec[:8]:
                print(f"  gun  frame={f:<3} h={h}")
            hs = [h for f, _sx, h, _ok in rec]
            print("  playhead:", [f for f, _s, _h, _o in rec], "heights:", hs)
            if not hs:
                fails.append("no card at the `item` placement (395.5, 338.6)")
            elif rec[-1][0] != 4:
                fails.append(f"the playhead stopped at {rec[-1][0]}, want 4")
            elif len(set(hs[-1:])) and hs != sorted(hs):
                fails.append(f"the swing is not monotonic: {hs}")

            table = pg.evaluate("""([x, y, n]) => {
              const m = window.__sfh3.screen.getItem, out = [];
              for (let f = 0; f <= n; f++) {
                m.revealFrame = f;
                m.build();
                let h = null;
                for (const c of m.content.children) {
                  if (Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1) {
                    h = Math.round(c.height); break;
                  }
                }
                out.push([f, h]);
              }
              return out;
            }""", [396, 339, 5])
            print("  table:", table)
            grow = [h for _f, h in table]
            if any(h is None for h in grow):
                fails.append(f"a swing frame drew no card: {table}")
            elif any(grow[i] >= grow[i + 1] for i in range(4)):
                fails.append(f"the swing is not monotonic: {grow[:5]}")
            elif grow[5] != grow[4]:
                fails.append("past the tween the card is not the settled one: "
                             f"{grow}")

        hard = [e for e in errs if "Failed to load" not in e]
        if hard:
            fails.append(f"console errors: {hard[:3]}")
        b.close()

    if fails:
        for f in fails:
            print("FAIL ", f)
        return 1
    print("\nOK - the hero pops in and the weapon card swings open")
    return 0


if __name__ == "__main__":
    sys.exit(main())
