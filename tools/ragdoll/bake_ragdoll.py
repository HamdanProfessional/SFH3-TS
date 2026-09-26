#!/usr/bin/env python3
from __future__ import annotations

import glob
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R

from PIL import Image

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SPRITES = os.path.normpath(os.path.join(REPO, "..", "sfh3_decompiled", "sprites"))
OUT_PNG = os.path.join(REPO, "public", "assets", "ragdoll")
OUT_JSON = os.path.join(REPO, "src", "assets", "ragdollRig.json")

PARTS = {
    "upperLeg": 2041, "lowerLeg": 2042, "head": 2043, "hand": 2044,
    "foot": 2045, "body": 2046, "upperArm": 2047, "lowerArm": 2048,
}

FRAME_MIN, FRAME_MAX = 1, 256

LAYER_NAMES = ("skin", "face", "hair", "robot", "gun")
SKIP_LAYERS = ("gun",)

MARGIN = 2
MAX_SHEET = 2048
XLINK = "{http://www.w3.org/1999/xlink}href"
NUM = r"[-0-9.eE]+"
MAT = re.compile(r"matrix\(([^)]*)\)")
WH = re.compile(r'height="([\d.]+)px"[^>]*?width="([\d.]+)px"')
ROOT_G = re.compile(
    r'<g transform="matrix\(0\.5, 0\.0, 0\.0, 0\.5, ' r'(-?[\d.]+), (-?[\d.]+)\)"\s*/?>')


def sprite_dir(cid: int) -> str:
    hits = glob.glob(os.path.join(SPRITES, f"DefineSprite_{cid}*"))
    if not hits:
        raise FileNotFoundError(f"sprite {cid}")
    return hits[0]


def frame_path(cid: int, frame: int) -> str:
    return os.path.join(sprite_dir(cid), f"{frame}.svg")


def frame_count(cid: int) -> int:
    return len([f for f in os.listdir(sprite_dir(cid)) if f.endswith(".svg")])


def cid_of(el) -> int | None:
    for k, v in el.attrib.items():
        if k.lower().endswith("characterid"):
            return int(v)
    return None


def matrix_of(tag: str | None):
    m = MAT.search(tag or "")
    if not m:
        return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return [float(x) for x in re.findall(NUM, m.group(1))]


def round_m(m):
    return [round(x, 4) for x in m]


def parse_frame(path: str):
    root = ET.parse(path).getroot()
    g = next(c for c in root if c.tag.endswith("}g"))
    layers, order = [], []
    for el in g:
        name = el.get("id") if el.tag.endswith("}use") else None
        if name in LAYER_NAMES:
            layers.append({
                "name": name,
                "cid": cid_of(el),
                "m": round_m(matrix_of(el.get("transform"))),
            })
            order.append(len(layers) - 1)
        elif not order or order[-1] != "base":
            order.append("base")
    return layers, order


def empty_frame(svg: str) -> bool:
    return "<use" not in svg and "<path" not in svg


def render_frame(pg, cid: int, frame: int, out: str, hide_cids):
    path = frame_path(cid, frame)
    svg = open(path, encoding="utf-8").read()
    m = WH.search(svg)
    w, h = float(m.group(2)), float(m.group(1))
    if empty_frame(svg):
        Image.new("RGBA", (2, 2), (0, 0, 0, 0)).save(out)
        return w, h
    R.render(pg, svg, out, rect=(0, 0, w, h), hide_cids=[str(c) for c in hide_cids])
    return w, h


def bake_clip(pg, key: str, cid: int, frames: list[int], tmp: str, manifest: dict):
    origin_svg = open(frame_path(cid, frames[0]), encoding="utf-8").read()
    m = ROOT_G.search(origin_svg)
    if not m:
        raise ValueError(f"no ffdec root group in {frame_path(cid, frames[0])}")
    reg = (float(m.group(1)) * 2, float(m.group(2)) * 2)

    layer_records: dict[str, list] = {}
    orders: dict[str, list] = {}
    renders: dict[int, str] = {}
    gun_runs: list[dict] = []
    prev_gun = None
    for f in frames:
        layers, order = parse_frame(frame_path(cid, f))
        gun = next((lay for lay in layers if lay["name"] == "gun"), None)
        gkey = (gun["cid"], tuple(gun["m"])) if gun else None
        if gkey != prev_gun:
            if gun:
                gun_runs.append({"from": f, "cid": gun["cid"], "m": gun["m"]})
            prev_gun = gkey
        keep = [lay for lay in layers if lay["name"] not in SKIP_LAYERS]
        if keep:
            layer_records[str(f)] = keep
            remap = {}
            for i, lay in enumerate(layers):
                if lay["name"] not in SKIP_LAYERS:
                    remap[i] = len(remap)
            orders[str(f)] = [
                "base" if item == "base" else remap[item]
                for item in order
                if item == "base" or item in remap
            ]
        p = os.path.join(tmp, f"{key}_{f}.png")
        render_frame(pg, cid, f, p,
                     hide_cids=[lay["cid"] for lay in layers if lay["cid"]])
        renders[f] = p

    minx = miny = math.inf
    maxx = maxy = -math.inf
    for p in renders.values():
        bb = Image.open(p).convert("RGBA").getbbox()
        if bb:
            minx, miny = min(minx, bb[0]), min(miny, bb[1])
            maxx, maxy = max(maxx, bb[2]), max(maxy, bb[3])
    if not math.isfinite(minx):
        minx = miny = 0
        maxx = maxy = 1

    cw = int(maxx - minx + 2 * MARGIN)
    ch = int(maxy - miny + 2 * MARGIN)
    ox = round(reg[0] - minx + MARGIN, 2)
    oy = round(reg[1] - miny + MARGIN, 2)

    unique: list[tuple] = []
    digest_to_idx: dict[str, int] = {}
    frames_map: dict[str, int] = {}
    for f in frames:
        cell = Image.open(renders[f]).convert("RGBA").crop(
            (max(0, int(minx)), max(0, int(miny)),
             int(maxx), int(maxy)))
        dh = hashlib.sha1(cell.tobytes()).hexdigest()
        idx = digest_to_idx.get(dh)
        if idx is None:
            idx = len(unique)
            digest_to_idx[dh] = idx
            unique.append(cell)
        frames_map[str(f)] = idx

    cols = max(1, MAX_SHEET // cw)
    rows = max(1, MAX_SHEET // ch)
    per_page = cols * rows
    pages = math.ceil(max(1, len(unique)) / per_page)
    sheets = []
    for page in range(pages):
        n = min(per_page, len(unique) - page * per_page)
        rr = max(1, math.ceil(n / cols))
        im = Image.new("RGBA", (cols * cw, rr * ch), (0, 0, 0, 0))
        for j in range(max(0, n)):
            idx = page * per_page + j
            im.paste(unique[idx], ((j % cols) * cw + MARGIN, (j // cols) * ch + MARGIN))
        name = f"{key.replace(':', '_')}_{page}.png"
        im.save(os.path.join(OUT_PNG, name), optimize=True)
        sheets.append({"file": name, "w": im.width, "h": im.height})

    manifest[key] = {
        "cid": cid,
        "cell": [cw, ch],
        "origin": [ox, oy],
        "cols": cols,
        "perPage": per_page,
        "sheets": sheets,
        "frames": frames_map,
    }
    if layer_records:
        manifest[key]["layers"] = layer_records
        manifest[key]["order"] = orders
    if gun_runs:
        manifest[key]["gunRuns"] = gun_runs
    print(f"  {key:<10} cid={cid} cell={cw}x{ch} origin=({ox},{oy}) "
          f"cells={len(unique)}/{len(frames)} pages={pages}")


def main():
    if os.path.isdir(OUT_PNG):
        shutil.rmtree(OUT_PNG)
    os.makedirs(OUT_PNG, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="rdframes_")

    manifest: dict = {
        "note": (
            "Ragdoll art for the eight `Phys*` clips (2041-2048). One atlas per "
            "clip; `origin` is the SWF registration point inside a cell, in "
            "clip units (1 px at bake scale). `frames` maps a costume index to "
            "a cell; `layers`/`order` describe the named nested costume "
            "children (`skin`/`face`/`hair`/`robot`) that must be drawn at the "
            "recorded placement matrices, in order. Baked by "
            "tools/ragdoll/bake_ragdoll.py."),
        "frameMin": FRAME_MIN,
        "frameMax": FRAME_MAX,
        "clips": {},
        "layerClips": {},
    }

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        for key, cid in PARTS.items():
            frames = [f for f in range(FRAME_MIN, FRAME_MAX + 1)
                      if os.path.isfile(frame_path(cid, f))]
            bake_clip(pg, key, cid, frames, tmp, manifest["clips"])

        seen: set[tuple[str, int]] = set()

        def collect(records):
            for rec in records.values():
                for lays in rec.get("layers", {}).values():
                    for lay in lays:
                        if lay["name"] not in SKIP_LAYERS:
                            seen.add((lay["name"], lay["cid"]))

        collect(manifest["clips"])
        while True:
            pending = [p for p in sorted(seen) if f"{p[0]}:{p[1]}" not in manifest["layerClips"]]
            if not pending:
                break
            for (name, cid) in pending:
                key = f"{name}:{cid}"
                frames = list(range(1, frame_count(cid) + 1))
                bake_clip(pg, key, cid, frames, tmp, manifest["layerClips"])
            collect(manifest["layerClips"])
        b.close()

    shutil.rmtree(tmp, ignore_errors=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, separators=(",", ":"))
    print(f"\nwrote {OUT_JSON}")
    size = sum(os.path.getsize(os.path.join(OUT_PNG, f))
               for f in os.listdir(OUT_PNG))
    print(f"{len(os.listdir(OUT_PNG))} sheets, {size // 1024} KB")


if __name__ == "__main__":
    main()
