#!/usr/bin/env python3
from __future__ import annotations

import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swftext as T
import uibake as U
import uidump as UD

REPO = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "ui", "cutscene")
OUT_JSON = os.path.join(REPO, "src", "assets", "cutsceneUi.json")

SCALE = U.SUPERSAMPLE
BG_CID = 3899
TOP_CID = 3807
SKIP_CID = 2923
CREDITS_CID = 3806

MARGIN = 40
ROLL_RATE = 0.9605
ROLL_REF = 300
ROLL_FIRST = 79
ROLL_LAST = 1800
END_FRAME = 1805
ROLL_Y0 = -120
ROLL_Y1 = 1720
TOP_CAPTION_CID = 3780

MAT = re.compile(r"matrix\(([^)]*)\)")
NUM = r"[-0-9.eE]+"
MARKERS = ("short1", "long1", "short0", "long0", "long2")
TEXT_ENTITY = {"&apos;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">"}


def sprite_dir(cid: int) -> str:
    hits = glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}_*")) \
        + glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}"))
    if not hits:
        raise FileNotFoundError(f"no sprite dir for {cid}")
    return hits[0]


def placements(svg: str):
    root = UD._root_group(ET.fromstring(svg))
    named, cids = {}, {}
    for child in root:
        use = UD._use_of(child)
        if use is None:
            continue
        m = MAT.search(use.get("transform") or "")
        nums = [float(x) for x in re.findall(NUM, m.group(1))] if m else [1, 0, 0, 1, 0, 0]
        rec = (round(nums[0], 4), round(nums[3], 4), round(nums[4], 2), round(nums[5], 2))
        name = use.get("id")
        if name:
            named[name] = rec
            cids[name] = use.get("{https://www.free-decompiler.com/flash}characterId")
    return named, cids


def camera_rect(cut) -> tuple:
    sx, sy, x, y = cut
    spx, spy = 800 - x, 500 - y
    return ((0 - spx) / sx + 400, (0 - spy) / sy + 250,
            (800 - spx) / sx + 400, (600 - spy) / sy + 250)


def text_of(cid) -> str:
    if not cid:
        return ""
    path = os.path.join(S.DECOMP, "texts", f"{cid}.txt")
    if not os.path.isfile(path):
        return ""
    raw = open(path, encoding="utf-8").read().replace("\r\n", "\n")
    for k, v in TEXT_ENTITY.items():
        raw = raw.replace(k, v)
    records = [r.strip("\n") for r in raw.split("--- RECORDSEPARATOR ---")]
    return "\n".join(r for r in records if r != "")


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    edits = T.parse()
    out = {"scale": SCALE, "frames": {}, "top": {}, "skip": {}, "credits": {}}

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SCALE)

        for f in range(1, 21):
            path = os.path.join(sprite_dir(BG_CID), f"{f}.svg")
            svg = U.fix_glyph_text(open(path, encoding="utf-8").read())
            ox, oy = R.stage_origin(svg)
            named, cids = placements(svg)
            cut1 = named.get("cut1", (1, 1, 400, 250))
            cut2 = named.get("cut2", cut1)
            rects = [camera_rect(cut1), camera_rect(cut2)]
            ax0 = min(r[0] for r in rects) - MARGIN
            ay0 = min(r[1] for r in rects) - MARGIN
            ax1 = max(r[2] for r in rects) + MARGIN
            ay1 = max(r[3] for r in rects) + MARGIN
            w, h = ax1 - ax0, ay1 - ay0
            rel = f"bg_{f}.png"

            root = UD._root_group(ET.fromstring(svg))
            hide = []
            for i, child in enumerate(root):
                use = UD._use_of(child)
                if use is not None and (use.get("id") in MARKERS
                                        or use.get("id") in ("cut1", "cut2",
                                                             "txt_word")):
                    hide.append(f"#host > svg > g > *:nth-child({i + 1})")
            R.render(pg, svg, os.path.join(OUT_IMG, rel),
                     rect=(ox + ax0 / 2, oy + ay0 / 2, w / 2, h / 2),
                     hide=hide, hide_cids=list(edits))
            out["frames"][str(f)] = {
                "art": {"file": rel, "x": round(ax0, 2), "y": round(ay0, 2),
                        "w": round(w, 2), "h": round(h, 2)},
                "cut1": list(cut1),
                "cut2": list(cut2),
                "markers": [k for k in MARKERS if k in named],
                "caption": text_of(cids.get("txt_word")),
            }
            print(f"  bg {f:2}: {w:.0f}x{h:.0f} markers "
                  f"{[k for k in MARKERS if k in named]}")

        path = os.path.join(sprite_dir(TOP_CID), "1.svg")
        svg = U.fix_glyph_text(open(path, encoding="utf-8").read())
        ox, oy = R.stage_origin(svg)
        named, _cids = placements(svg)
        root = UD._root_group(ET.fromstring(svg))
        hide = []
        for i, child in enumerate(root):
            use = UD._use_of(child)
            if use is not None and use.get("id") in ("txt_word", "black", "skip"):
                hide.append(f"#host > svg > g > *:nth-child({i + 1})")
        R.render(pg, svg, os.path.join(OUT_IMG, "top.png"),
                 rect=(ox, oy, R.VIEW_W, R.VIEW_H), hide=hide)
        out["top"] = {
            "file": "top.png", "w": R.DESIGN_W, "h": R.DESIGN_H,
            "black": list(named.get("black", (1, 1, -18, 12))),
            "fields": {str(TOP_CAPTION_CID): edits.get(TOP_CAPTION_CID)},
        }
        out["skip"] = U.bake_button(pg, SKIP_CID, {})
        m = named.get("skip", (1, 1, 726.85, 577.15))
        out["skip"].update({"x": m[2], "y": m[3], "sx": m[0], "sy": m[1]})

        frame = os.path.join(sprite_dir(CREDITS_CID), f"{ROLL_REF}.svg")
        svg = open(frame, encoding="utf-8").read()
        cx, cy = R.stage_origin(svg)
        roll_h = ROLL_Y1 - ROLL_Y0
        R.render(pg, svg, os.path.join(OUT_IMG, "credits_roll.png"),
                 rect=(cx + (-390.4) / 2, cy + (ROLL_Y0 - 299.65) / 2,
                       400, roll_h / 2))
        end = open(os.path.join(sprite_dir(CREDITS_CID), f"{END_FRAME}.svg"),
                   encoding="utf-8").read()
        ex, ey = R.stage_origin(end)
        R.render(pg, end, os.path.join(OUT_IMG, "credits_end.png"),
                 rect=(ex + (-390.4) / 2, ey + (-299.65) / 2, 400, 300))
        out["credits"] = {
            "roll": {"file": "credits_roll.png", "y": ROLL_Y0, "h": roll_h},
            "end": {"file": "credits_end.png"},
            "rate": ROLL_RATE, "ref": ROLL_REF,
            "first": ROLL_FIRST, "last": ROLL_LAST,
            "offset": [390.4, 299.65],
        }
        b.close()

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT_JSON)
    print("images in", OUT_IMG)


if __name__ == "__main__":
    main()
