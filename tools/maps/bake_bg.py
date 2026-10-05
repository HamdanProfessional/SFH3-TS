#!/usr/bin/env python3
from __future__ import annotations

import base64
import glob
import json
import os
import re
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SPR = os.path.normpath(os.path.join(REPO, "..", "sfh3_decompiled", "sprites"))
OUT_BG = os.path.join(REPO, "public", "assets", "bg")
OUT_SKY = os.path.join(REPO, "public", "assets", "sky")
RIG = os.path.join(REPO, "src", "assets", "bgRig.json")

BG_CID, SKY_CID = 3514, 3466

BG_FRAME = {
    "street1": 2, "street2": 3, "factory1": 4, "factory2": 5,
    "caves1": 6, "caves2": 7, "canyon1": 8, "canyon2": 9,
    "forest1": 10, "forest2": 11, "cavern1": 12, "cavern2": 13,
    "cqc1": 14, "frigate": 15, "construction1": 16, "construction2": 17,
    "junkyard1": 18, "junkyard2": 19, "temple1": 20, "temple2": 21,
    "volcano1": 22, "volcano2": 23,
}
SKY_FRAME = {
    "street": 2, "factory": 3, "caves": 4, "canyon": 5, "forest": 6,
    "cavern": 7, "frigate": 8, "construction": 9, "junkyard": 10,
    "temple": 11, "volcano": 12,
}

MAPS = {
    "factory": {"bg1": "factory1", "bg2": "factory2", "sky": "factory"},
    "street": {"bg1": "street1", "bg2": "street2", "sky": "street"},
    "canyon": {"bg1": "canyon1", "bg2": "canyon2", "sky": "canyon"},
    "caves": {"bg1": "caves1", "bg2": "caves2", "sky": "caves"},
    "forest": {"bg1": "forest1", "bg2": "forest2", "sky": "forest"},
    "cavesb": {"bg1": "cavern1", "bg2": "cavern2", "sky": "cavern"},
    "cqc": {"bg1": "cqc1", "bg2": "", "sky": ""},
    "frigate": {"bg1": "", "bg2": "", "sky": "frigate"},
    "construction": {"bg1": "construction1", "bg2": "construction2", "sky": "construction"},
    "junkyard": {"bg1": "junkyard1", "bg2": "junkyard2", "sky": "junkyard"},
    "temple": {"bg1": "temple1", "bg2": "temple2", "sky": "temple"},
    "volcano": {"bg1": "volcano1", "bg2": "volcano2", "sky": "volcano"},
    "gorge": {"bg1": "canyon1", "bg2": "canyon2", "sky": "canyon"},
}


def frame_svg(cid: int, frame: int) -> str:
    d = glob.glob(os.path.join(SPR, f"DefineSprite_{cid}*"))
    if not d:
        raise SystemExit(f"no export for cid {cid}")
    return os.path.join(d[0], f"{frame}.svg")


def root_header(svg: str):
    w = float(re.search(r'width="([-0-9.]+)px"', svg).group(1)) * 2
    h = float(re.search(r'height="([-0-9.]+)px"', svg).group(1)) * 2
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', svg)
    n = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))]
    return w, h, n[4] * 2, n[5] * 2


def usebox_size(svg: str):
    m = re.search(r'<use[^>]*id="usebox"[^>]*/>', svg)
    if not m:
        return None
    el = m.group(0)
    w = float(re.search(r'width="([-0-9.]+)"', el).group(1))
    h = float(re.search(r'height="([-0-9.]+)"', el).group(1))
    t = [float(x) for x in re.findall(
        r"[-0-9.eE]+", re.search(r'transform="matrix\(([^)]*)\)"', el).group(1))]
    return round(t[0] * w, 1), round(t[3] * h, 1)


def render(pg, svg: str, out_path: str):
    w, h, _ox, _oy = root_header(svg)
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    pg.set_viewport_size({"width": max(8, round(w / 2)), "height": max(8, round(h / 2))})
    pg.set_content(
        '<body style="margin:0;background:transparent">'
        f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
        f'width="{w / 2}" height="{h / 2}"></body>')
    pg.wait_for_selector("#i")
    raw = out_path + ".raw.png"
    pg.screenshot(path=raw, omit_background=True)
    return raw


def bake(pg, cid: int, frame: int, out_path: str, want_usebox: bool):
    svg = open(frame_svg(cid, frame), encoding="utf-8").read()
    sw, sh, ox, oy = root_header(svg)
    label = os.path.splitext(os.path.basename(out_path))[0]
    os.makedirs(os.path.join(os.path.dirname(out_path), "svg"), exist_ok=True)
    with open(os.path.join(os.path.dirname(out_path), "svg", f"{label}.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg)
    ub = usebox_size(svg) if want_usebox else None
    raw = render(pg, svg, out_path)
    im = Image.open(raw).convert("RGBA")
    os.remove(raw)
    bbox = im.getbbox()
    off = [0, 0]
    if bbox:
        off = [bbox[0], bbox[1]]
        im = im.crop(bbox)
    im.save(out_path)
    rec = {"file": os.path.basename(out_path), "w": im.width, "h": im.height,
           "lx": round(off[0] - ox, 1), "ly": round(off[1] - oy, 1),
           "svg": f"svg/{label}.svg", "sx": off[0], "sy": off[1],
           "sw": round(sw, 2), "sh": round(sh, 2)}
    if ub:
        rec["useW"], rec["useH"] = ub
    else:
        rec["useW"], rec["useH"] = im.width, im.height
    return rec


def main():
    os.makedirs(OUT_BG, exist_ok=True)
    os.makedirs(OUT_SKY, exist_ok=True)
    need_bg = sorted({v for m in MAPS.values() for v in (m["bg1"], m["bg2"]) if v})
    need_sky = sorted({m["sky"] for m in MAPS.values() if m["sky"]})

    rig = {"maps": MAPS, "bg": {}, "sky": {}}
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(device_scale_factor=2)
        for label in need_bg:
            rec = bake(pg, BG_CID, BG_FRAME[label],
                       os.path.join(OUT_BG, f"{label}.png"), True)
            rig["bg"][label] = rec
            print(f"  bg  {label:14} {rec['w']}x{rec['h']} @({rec['lx']},{rec['ly']}) "
                  f"usebox {rec['useW']}x{rec['useH']}")
        for label in need_sky:
            rec = bake(pg, SKY_CID, SKY_FRAME[label],
                       os.path.join(OUT_SKY, f"{label}.png"), False)
            rig["sky"][label] = rec
            print(f"  sky {label:14} {rec['w']}x{rec['h']} @({rec['lx']},{rec['ly']})")
        b.close()

    with open(RIG, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, indent=1)
    print(f"\nwrote {len(need_bg)} bg + {len(need_sky)} sky -> {os.path.normpath(RIG)}")


if __name__ == "__main__":
    main()
