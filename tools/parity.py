#!/usr/bin/env python3
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import svgraster as R
import swftext as T
import uibake as U
from devurl import goto_menu, nointro, wait_for_art

OUT = os.path.join(REPO, "shots", "parity")
URL = os.environ.get("SFH3_URL", "http://localhost:5173/")
W, H = 800, 600

HIDE_NAMES = U.OVERLAYS | U.DEBUG_BUTTONS | U.SPONSOR


def truth_hidden(items, edit_cids):
    return [it["child"] for it in items
            if (it["name"] or "") in HIDE_NAMES or it["cid"] in edit_cids]


def ink_stats(a, b):
    import numpy as np
    CELL = 16
    def grid(img):
        g = np.asarray(img.convert("L"), dtype=float)
        h, w = g.shape
        g = g[:h // CELL * CELL, :w // CELL * CELL]
        blocks = g.reshape(h // CELL, CELL, w // CELL, CELL)
        return (blocks.max(axis=(1, 3)) - blocks.min(axis=(1, 3))) > 24
    ta, tb = grid(a), grid(b)
    n = ta.size
    return (ta.sum() / n, tb.sum() / n, (ta & ~tb).sum() / n)


def main():
    from PIL import Image
    from playwright.sync_api import sync_playwright

    os.makedirs(OUT, exist_ok=True)
    frames = json.load(open(os.path.join(REPO, "src", "assets", "menuFrames.json"),
                            encoding="utf-8"))
    edits = T.parse()
    args = [a for a in sys.argv[1:] if a != "--seed"]
    seed = "--seed" in sys.argv[1:]
    wanted = args or list(frames)

    truth_dir = os.path.join(OUT, "_truth")
    port_dir = os.path.join(OUT, "_port")
    os.makedirs(truth_dir, exist_ok=True)
    os.makedirs(port_dir, exist_ok=True)

    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=2)
        for label in wanted:
            fr = frames.get(label)
            if not fr:
                print(f"!! unknown frame {label!r}")
                continue
            svg = U.fix_glyph_text(
                open(R.menu_frame_path(fr["frame"]), encoding="utf-8").read())
            ox, oy = R.stage_origin(svg)
            hide = truth_hidden(fr["items"], edits)
            shift = ([(U.child_sel(fr["bgChild"]), fr["bgDx"], 0)]
                     if fr.get("bgDx") else ())
            R.render(pg, svg, os.path.join(truth_dir, f"{label}.png"),
                     rect=(ox, oy, R.DESIGN_W / 2, R.DESIGN_H / 2),
                     hide=[U.child_sel(i) for i in hide],
                     hide_cids=sorted(edits), shift=shift)
        b.close()

        b = pw.chromium.launch()
        page = b.new_page(viewport={"width": W, "height": H},
                          device_scale_factor=1)
        errs = []
        page.on("console", lambda m: errs.append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(page, URL)
        time.sleep(2)
        if seed:
            page.evaluate("""() => {
              const SD = window.sfh3Dev.SD;
              SD.stages = [0,1,2,3,4,5,6,7,8,9,10,11];
              SD.curStage = SD.stages.length - 1;
              SD.bpClasses = [0,1,2,3,4,5,6,7,8];
              SD.funds = 9999999;
              while (SD.heroes.length < 5) { if (!SD.hireHero()) break; }
              SD.squad = [0,1,2,3,4].slice(0, SD.heroes.length);
              SD.selHero = 0;
              SD.funds = 999999;
              SD.gotAkq = true;
              for (let cat = 0; cat < 11; cat++) {
                for (let n = 0; n < 24; n++) {
                  const g = window.sfh3Dev.makeGun(cat);
                  if (!g) break;
                  SD.items[cat].push(g);
                }
              }
            }""")
            time.sleep(0.5)
        shot = []
        for label in wanted:
            ok = page.evaluate(
                "(f) => { const s = window.__sfh3?.screen;"
                " if (!s || !s.goto) return false; s.goto(f); return true; }",
                label)
            if not ok:
                print("!! no debug hook")
                break
            wait_for_art(page)
            page.screenshot(path=os.path.join(port_dir, f"{label}.png"))
            shot.append(label)
        b.close()

    missed = [l for l in wanted if l not in shot]
    if missed:
        print(f"\n!! {len(missed)} frame(s) not captured, skipping: "
              f"{', '.join(missed)}")

    for label in shot:
        tp = os.path.join(truth_dir, f"{label}.png")
        pp = os.path.join(port_dir, f"{label}.png")
        if not (os.path.isfile(tp) and os.path.isfile(pp)):
            continue
        t = Image.open(tp).convert("RGB").resize((W, H), Image.LANCZOS)
        p = Image.open(pp).convert("RGB")
        ti, pi, only = ink_stats(t, p)
        sheet = Image.new("RGB", (W * 2 + 8, H), (24, 24, 24))
        sheet.paste(t, (0, 0))
        sheet.paste(p, (W + 8, 0))
        sheet.save(os.path.join(OUT, f"{label}.png"))
        flag = "  <-- CHECK" if only > 0.06 else ""
        print(f"{label:12} truth-ink {ti:5.1%}  port-ink {pi:5.1%}  "
              f"truth-only {only:5.1%}{flag}")

    if errs:
        print(f"\n!! {len(errs)} console error(s):")
        for e in dict.fromkeys(errs):
            print("  ", e[:200])


if __name__ == "__main__":
    main()
