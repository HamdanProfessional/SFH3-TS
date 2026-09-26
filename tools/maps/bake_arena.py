#!/usr/bin/env python3
from __future__ import annotations

import base64
import glob
import json
import os
import re
import sys
from math import atan2, degrees, hypot

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import arena_dump as D
import swfio as S

from PIL import Image
from playwright.sync_api import sync_playwright

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
OUT = os.path.join(REPO, "public", "assets", "maps")
RIG = os.path.join(REPO, "src", "assets", "arenaData.json")
SPR = S.SPRITES

FRAME_MAP = {
    2: "street", 3: "factory", 4: "caves", 5: "canyon", 6: "forest",
    7: "cavesb", 8: "cqc", 9: "frigate", 10: "construction", 11: "junkyard",
    12: "temple", 13: "volcano", 14: "gorge",
}

NODE_KIND = {
    3025: "waypoint", 3028: "spawn", 3020: "aiaction", 3057: "ctfflag",
    3066: "pickup", 3041: "holdpoint", 3015: "physbox", 3235: "physbox",
    3570: "downarrow",
}
BASE_SIZE = {3015: 85.0, 3235: 51.3, 3020: 69.0}
NODE_CIDS = set(NODE_KIND)
STRUCTURAL = {"imageMC", "wallMC", "imgCont", "midCont", "botCont", "box", "light"}


def find_svg(cid: int) -> str:
    d = glob.glob(os.path.join(SPR, f"DefineSprite_{cid}*"))
    if d:
        return os.path.join(d[0], "1.svg")
    raise SystemExit(f"no SVG export for cid {cid}")


def root_header(svg: str):
    w = float(re.search(r'width="([-0-9.]+)px"', svg).group(1)) * 2
    h = float(re.search(r'height="([-0-9.]+)px"', svg).group(1)) * 2
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', svg)
    n = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))]
    return w, h, n[4] * 2, n[5] * 2


def box_of(svg: str):
    m = re.search(r'<use[^>]*id="box"[^>]*/>', svg)
    if not m:
        return None
    el = m.group(0)
    w = float(re.search(r'width="([-0-9.]+)"', el).group(1))
    h = float(re.search(r'height="([-0-9.]+)"', el).group(1))
    t = [float(x) for x in re.findall(
        r"[-0-9.eE]+", re.search(r'transform="matrix\(([^)]*)\)"', el).group(1))]
    return round(t[0] * w), round(t[3] * h)


def render(pg, svg: str, out_path: str):
    w, h, _ox, _oy = root_header(svg)
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    pg.set_viewport_size({"width": max(8, round(w / 2)), "height": max(8, round(h / 2))})
    pg.set_content(
        '<body style="margin:0;background:transparent">'
        f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
        f'width="{w / 2}" height="{h / 2}"></body>')
    pg.wait_for_selector("#i")
    tmp = out_path + ".raw.png"
    pg.screenshot(path=tmp, omit_background=True)
    return tmp


def nodes_for_frame(frame) -> list[dict]:
    out = []
    for _depth in sorted(frame):
        cid, name, m = frame[_depth]
        if name in ("imageMC", "wallMC", "imgCont", "midCont", "botCont"):
            continue
        kind = NODE_KIND.get(cid)
        if name == "light":
            kind = "light"
        if kind is None:
            continue
        x = y = 0.0
        rot = 0.0
        sx = sy = 1.0
        if m is not None:
            tx, ty, a, d, b, c = m
            x, y = round(tx, 2), round(ty, 2)
            sx, sy = hypot(a, b), hypot(c, d)
            rot = round(degrees(atan2(b, a)), 3)
        rec: dict = {"kind": kind, "name": name or "", "x": x, "y": y}
        base = BASE_SIZE.get(cid)
        if base is not None:
            rec["width"] = round(base * sx, 2)
            rec["height"] = round(base * sy, 2)
        if abs(rot) > 0.001:
            rec["rotation"] = rot
        out.append(rec)
    return out


def main():
    only = None
    if "--map" in sys.argv:
        only = sys.argv[sys.argv.index("--map") + 1]

    os.makedirs(OUT, exist_ok=True)
    _labels, frames = D.arena_frames(S.body())
    data = {"maps": {}}

    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(device_scale_factor=2)

        for idx in sorted(frames):
            mid = FRAME_MAP.get(idx)
            if mid is None or (only and mid != only):
                continue
            frame = frames[idx]

            image_cid = wall_cid = None
            image_at = (0.0, 0.0)
            for depth in sorted(frame):
                cid, name, m = frame[depth]
                if name == "imageMC":
                    image_cid = cid
                    if m:
                        image_at = (m[0], m[1])
                elif name == "wallMC":
                    wall_cid = cid
            if image_cid is None or wall_cid is None:
                print(f"  !! {mid}: missing imageMC/wallMC")
                continue

            img_svg = open(find_svg(image_cid), encoding="utf-8").read()
            _iw, _ih, itx, ity = root_header(img_svg)
            raw = render(pg, img_svg, os.path.join(OUT, f"{mid}.png"))
            art = Image.open(raw).convert("RGBA")
            iw, ih = art.size
            art.save(os.path.join(OUT, f"{mid}.png"))
            os.remove(raw)
            img_x = round(image_at[0] - itx, 2)
            img_y = round(image_at[1] - ity, 2)

            wall_svg = open(find_svg(wall_cid), encoding="utf-8").read()
            ww, wh, wtx, wty = root_header(wall_svg)
            box = box_of(wall_svg)
            wraw = render(pg, wall_svg, os.path.join(OUT, f"{mid}_wall.png"))
            im = Image.open(wraw).convert("RGBA")
            if box:
                bw, bh = box
            else:
                bbox = im.getbbox()
                bw, bh = (bbox[2] - bbox[0], bbox[3] - bbox[1]) if bbox else (im.width, im.height)
            crop = im.crop((round(wtx), round(wty), round(wtx) + bw, round(wty) + bh))
            crop.save(os.path.join(OUT, f"{mid}_wall.png"))
            os.remove(wraw)

            rw, rh = int(ww * 0.1), int(wh * 0.1)
            full = Image.new("RGBA", (rw * 10, rh * 10), (0, 0, 0, 0))
            full.paste(im, (-round(wtx), -round(wty)))
            full.resize((rw, rh), Image.LANCZOS).save(
                os.path.join(OUT, f"{mid}_radarwall.png"))

            data["maps"][mid] = {
                "image": {"file": f"{mid}.png", "x": img_x, "y": img_y,
                          "w": iw, "h": ih},
                "wall": {"file": f"{mid}_wall.png", "w": bw, "h": bh},
                "radar": {"file": f"{mid}_radarwall.png", "w": rw, "h": rh},
                "nodes": nodes_for_frame(frame),
            }
            n = len(data["maps"][mid]["nodes"])
            print(f"  {mid:13} art {iw}x{ih}@{img_x},{img_y}  "
                  f"wall {bw}x{bh}  radar {rw}x{rh}  nodes {n}")

        b.close()

    with open(RIG, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)
    print(f"\nwrote {os.path.normpath(RIG)}")


if __name__ == "__main__":
    main()
