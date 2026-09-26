#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import svgraster as R
import swfio as S

from PIL import Image
from playwright.sync_api import sync_playwright

REPO = S.REPO
OUT = os.path.join(REPO, "public", "assets", "nodes")
RIG = os.path.join(REPO, "src", "assets", "nodeRig.json")

NODE_SPRITES = {
    "pickup": 3066,
    "holdpoint": 3041,
    "ctf": 3057,
}

PARTS = {
    "pickupBase": (3066, [1, 2, 3, 4, 5, 6], [3034],
                   {2: "red", 3: "green", 4: "yellow", 5: "white", 6: "none"}),
    "holdpointBase": (3041, [1, 2, 3, 4], [3032, 3034], {}),
    "ctfBase": (3057, [1, 2], [3034, 3055], {}),
    "holdpointFlag": (3032, [1, 2, 3], [], {}),
    "ctfFlag": (3055, [7, 8], [], {7: "flag1", 8: "flag2"}),
    "rim": (3034, list(range(1, 97)), [], {}),
    "downarrow": (3570, list(range(1, 17)), [], {}),
}

CHILDREN = {
    "holdpoint": {"flag": "holdpointFlag", "rim": "rim"},
    "ctf": {"flag": "ctfFlag", "rim": "rim"},
    "pickup": {"rim": "rim"},
}

USE = re.compile(
    r'<use[^>]*ffdec:characterId="(\d+)"[^>]*id="([^"]+)"[^>]*'
    r'transform="matrix\(([^)]*)\)"')
TOP_USE = re.compile(r'^    <use')


def parse_use(svg: str, ident: str):
    for line in svg.split("\n"):
        if not TOP_USE.match(line) or f'id="{ident}"' not in line:
            continue
        m = re.search(r'transform="matrix\(([^)]*)\)"', line)
        if not m:
            continue
        a, _b, _c, d, tx, ty = [float(v) for v in re.findall(r"[-0-9.eE]+", m.group(1))]
        return {"tx": tx, "ty": ty, "sx": a, "sy": d}
    return None


def only_use(svg: str, keep: str) -> str:
    out = []
    for line in svg.split("\n"):
        if TOP_USE.match(line) and f'id="{keep}"' not in line:
            continue
        out.append(line)
    return "\n".join(out)


def trim(path: str, ox: float, oy: float):
    im = Image.open(path).convert("RGBA")
    box = im.getbbox()
    if not box:
        return None, 0, 0
    lx = round(box[0] - ox * 2, 1)
    ly = round(box[1] - oy * 2, 1)
    return im.crop(box), lx, ly


def check_placement(base_svg: str, part: str, place: dict, cell, pg) -> None:
    w, h, ox, oy = S.header(base_svg)
    tmp = os.path.join(OUT, "_check.png")
    R.render(pg, only_use(base_svg, part), tmp, rect=(0, 0, w, h))
    im = Image.open(tmp).convert("RGBA")
    os.remove(tmp)
    box = im.getbbox()
    if not box:
        print(f"    !! {part}: parent-only render is empty; placement unverified")
        return
    ex0 = round(box[0] - ox * 2, 1)
    ey0 = round(box[1] - oy * 2, 1)
    ex1 = round(box[2] - ox * 2, 1)
    ey1 = round(box[3] - oy * 2, 1)
    wx0 = place["tx"] + cell["lx"] * place["sx"]
    wy0 = place["ty"] + cell["ly"] * place["sy"]
    wx1 = wx0 + cell["w"] * place["sx"]
    wy1 = wy0 + cell["h"] * place["sy"]
    if max(abs(ex0 - wx0), abs(ey0 - wy0), abs(ex1 - wx1), abs(ey1 - wy1)) > 1.5:
        print(f"    !! {part}: placement mismatch parent {ex0, ey0, ex1, ey1} "
              f"vs recomposed {wx0, wy0, wx1, wy1}")


def bake(pg, part: str, cid: int, frames: list[int], hide: list[int]):
    svgs = S.frame_svgs(cid)
    imgs, meta = [], []
    for f in frames:
        svg = open(svgs[f - 1], encoding="utf-8").read()
        w, h, ox, oy = S.header(svg)
        tmp = os.path.join(OUT, "_raw.png")
        R.render(pg, svg, tmp, rect=(0, 0, w, h), hide_cids=hide)
        im, lx, ly = trim(tmp, ox, oy)
        os.remove(tmp)
        if im is None:
            imgs.append(None)
            meta.append({"x": 0, "y": 0, "w": 0, "h": 0, "lx": 0, "ly": 0})
        else:
            imgs.append(im)
            meta.append({"w": im.width, "h": im.height, "lx": lx, "ly": ly})

    solid = [(i, im) for i, im in enumerate(imgs) if im is not None]
    pos, pages = S.shelf_pack([(im.width, im.height) for _, im in solid])
    sheets = [Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))
              for w, h in pages]
    for (i, im), (page, x, y) in zip(solid, pos):
        sheets[page].paste(im, (x, y))
        meta[i]["p"], meta[i]["x"], meta[i]["y"] = page, x, y

    files = []
    for page, sheet in enumerate(sheets):
        fn = f"{part}.png" if len(sheets) == 1 else f"{part}_{page}.png"
        sheet.save(os.path.join(OUT, fn))
        files.append(fn)
    drawn = sum(1 for m in meta if m["w"])
    print(f"  {part:14} {drawn:3}/{len(frames)} frames  {len(sheets)} page(s)"
          f"  {sum(m['w'] * m['h'] for m in meta) / 1000:6.1f} kpx")
    return {"cid": cid, "files": files, "cells": meta}


def main():
    os.makedirs(OUT, exist_ok=True)
    rig = {"note": (
        "Arena node prop art. `cells[f]` is frame f (0-based in the manifest, "
        "1-based in the SWF) trimmed to its content: x/y locate it in the "
        "sheet, lx/ly are STAGE px from the part's registration point. The "
        "placements are raw SWF child transforms; draw a child at "
        "node + (tx + lx*sx, ty + ly*sy) scaled (sx, sy)."), "parts": {},
        "placements": {}}

    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        for part, (cid, frames, hide, labels) in PARTS.items():
            rig["parts"][part] = bake(pg, part, cid, frames, hide)
            if labels:
                rig["parts"][part]["labels"] = {
                    name: frames.index(num) for num, name in labels.items()}

        for node, sprite in NODE_SPRITES.items():
            svgs = S.frame_svgs(sprite)
            rig["placements"][node] = {}
            for ident, part in CHILDREN[node].items():
                svg = None
                place = None
                for path in svgs:
                    svg = open(path, encoding="utf-8").read()
                    place = parse_use(svg, ident)
                    if place:
                        break
                if not place:
                    raise SystemExit(f"{node}: no top-level use id={ident!r}")
                rig["placements"][node][ident] = {"part": part, **place}
                cell = rig["parts"][part]["cells"][0]
                check_placement(svg, ident, place, cell, pg)
                print(f"  {node:10} {ident:5} tx={place['tx']:7.2f} "
                      f"ty={place['ty']:7.2f} s=({place['sx']:.4f},{place['sy']:.4f})")
        b.close()

    with open(RIG, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, indent=1)
    print(f"\nwrote {os.path.normpath(RIG)}")


if __name__ == "__main__":
    main()
