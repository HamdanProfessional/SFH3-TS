#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swftext as T

from PIL import Image
from playwright.sync_api import sync_playwright

REPO = S.REPO
OUT_IMG = os.path.join(REPO, "public", "assets", "killstreaks")
OUT_JSON = os.path.join(REPO, "src", "assets", "killstreakRig.json")

SPRITES = {
    "turret": {"root": 3532, "head": 3531, "hp": 2038, "name": 3516, "level": 3517},
    "sentry": {"root": 3564, "head": 3563, "hp": 3539, "name": 3551, "level": 3552},
}

TEXT_CIDS = {3516, 3517, 3551, 3552}

HEAD_FRAMES = 7

TOP_USE = re.compile(r'^    <use')
NUM = r"[-0-9.eE]+"


def parse_use(svg: str, ident: str):
    for line in svg.split("\n"):
        if not TOP_USE.match(line) or f'id="{ident}"' not in line:
            continue
        m = re.search(r'transform="matrix\(([^)]*)\)"', line)
        if not m:
            continue
        a, b, c, d, tx, ty = [float(v) for v in re.findall(NUM, m.group(1))]
        return {"a": a, "b": b, "c": c, "d": d, "tx": tx, "ty": ty}
    return None


def head_track(cid: int) -> tuple[int, list[dict]]:
    track: list[dict] = []
    first = 0
    for i, path in enumerate(S.frame_svgs(cid)):
        place = parse_use(open(path, encoding="utf-8").read(), "head")
        if place is None:
            continue
        if not first:
            first = i + 1
        track.append(place)
    return first, track


def find_use(cid: int, ident: str):
    for i, path in enumerate(S.frame_svgs(cid)):
        svg = open(path, encoding="utf-8").read()
        place = parse_use(svg, ident)
        if place:
            return place, i + 1
    return None, 0


def trim(path: str, ox: float, oy: float):
    im = Image.open(path).convert("RGBA")
    box = im.getbbox()
    if not box:
        return None, 0, 0
    lx = round(box[0] - ox * 2, 1)
    ly = round(box[1] - oy * 2, 1)
    return im.crop(box), lx, ly


def bake(pg, part: str, cid: int, frames: list[int], hide_base: list[int],
         head_cid: int | None = None, head_from: int = 1 << 30):
    svgs = S.frame_svgs(cid)
    imgs, meta = [], []
    for f in frames:
        if f - 1 >= len(svgs):
            imgs.append(None)
            meta.append({"x": 0, "y": 0, "w": 0, "h": 0, "lx": 0, "ly": 0})
            continue
        hide = list(hide_base)
        if head_cid is not None and f >= head_from:
            hide.append(head_cid)
        svg = open(svgs[f - 1], encoding="utf-8").read()
        w, h, ox, oy = S.header(svg)
        tmp = os.path.join(OUT_IMG, "_raw.png")
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
        sheet.save(os.path.join(OUT_IMG, fn))
        files.append(fn)
    drawn = sum(1 for m in meta if m["w"])
    print(f"  {part:12} {drawn:3}/{len(frames)} frames  {len(sheets)} page(s)"
          f"  {sum(m['w'] * m['h'] for m in meta) / 1000:6.1f} kpx")
    return {"cid": cid, "files": files, "cells": meta}


def load_cell(rig: dict, part: str, index: int):
    c = rig["parts"][part]["cells"][index]
    if not c["w"]:
        return None, 0, 0
    sheet = Image.open(os.path.join(OUT_IMG, rig["parts"][part]["files"][c.get("p", 0)]))
    im = sheet.crop((c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"]))
    return im, c["lx"], c["ly"]


def compose(rig: dict, device: str, frame: int, head_frame: int, body = True):
    dev = rig["devices"][device]
    canvas = Image.new("RGBA", (420, 420), (0, 0, 0, 0))
    if body:
        cell, blx, bly = load_cell(rig, dev["body"], frame - 1)
        if cell is not None:
            canvas.alpha_composite(cell, (int(round(210 + blx)), int(round(210 + bly))))
    if frame >= dev["headFirst"]:
        m = dev["headTrack"][frame - dev["headFirst"]]
        head, hlx, hly = load_cell(rig, dev["headPart"], head_frame - 1)
        if head is not None:
            det = m["a"] * m["d"] - m["b"] * m["c"]
            if abs(det) > 1e-9:
                i00 = m["d"] / det
                i01 = -m["c"] / det
                i10 = -m["b"] / det
                i11 = m["a"] / det
                ox, oy = 210 + m["tx"], 210 + m["ty"]
                affine = (
                    i00, i01, -i00 * ox - i01 * oy - hlx,
                    i10, i11, -i10 * ox - i11 * oy - hly,
                )
                layer = head.transform(
                    (420, 420), Image.AFFINE, affine, resample=Image.BILINEAR)
                canvas.alpha_composite(layer)
    return canvas


def top_cids(cid: int, frame: int) -> list[int]:
    svg = open(S.frame_svgs(cid)[frame - 1], encoding="utf-8").read()
    out = []
    for line in svg.split("\n"):
        if not TOP_USE.match(line):
            continue
        m = re.search(r'ffdec:characterId="(\d+)"', line)
        if m:
            out.append(int(m.group(1)))
    return out


def bbox(img, off_x: float, off_y: float):
    b = img.getbbox()
    if not b:
        return None
    return (b[0] - off_x, b[1] - off_y, b[2] - off_x, b[3] - off_y)


def check_head(pg, rig: dict, device: str, frame: int):
    dev = rig["devices"][device]
    hides = [c for c in set(top_cids(dev["rootCid"], frame)) if c != dev["headCid"]]
    svg = open(S.frame_svgs(dev["rootCid"])[frame - 1], encoding="utf-8").read()
    w, h, ox, oy = S.header(svg)
    tmp = os.path.join(OUT_IMG, "_ref.png")
    R.render(pg, svg, tmp, rect=(0, 0, w, h), hide_cids=hides)
    ref = Image.open(tmp).convert("RGBA")
    os.remove(tmp)
    canvas = Image.new("RGBA", (420, 420), (0, 0, 0, 0))
    canvas.alpha_composite(ref, (int(round(210 - ox * 2)), int(round(210 - oy * 2))))
    ref_box = bbox(canvas, 210, 210)
    head_frame = ((frame - dev["headFirst"]) % HEAD_FRAMES) + 1
    comp = compose(rig, device, frame, head_frame, body=False)
    comp_box = bbox(comp, 210, 210)
    if ref_box is None or comp_box is None:
        assert ref_box == comp_box, f"{device} f{frame}: head missing on one side"
        return 0.0
    d = max(abs(a - b) for a, b in zip(ref_box, comp_box))
    print(f"  {device:7} frame {frame:3}  head {head_frame}  bbox"
          f" ref {tuple(round(v, 1) for v in ref_box)}"
          f" comp {tuple(round(v, 1) for v in comp_box)}  dmax {d:.1f}")
    assert d <= 1.5, f"{device} f{frame}: head bbox off by {d:.1f}px"
    return d


def check_body(pg, rig: dict, device: str, frame: int, hidden_base: list[int]):
    dev = rig["devices"][device]
    hidden = list(hidden_base) + [dev["headCid"]]
    svg = open(S.frame_svgs(dev["rootCid"])[frame - 1], encoding="utf-8").read()
    w, h, ox, oy = S.header(svg)
    tmp = os.path.join(OUT_IMG, "_ref.png")
    R.render(pg, svg, tmp, rect=(0, 0, w, h), hide_cids=hidden)
    ref = Image.open(tmp).convert("RGBA")
    os.remove(tmp)
    comp = Image.new("RGBA", (420, 420), (0, 0, 0, 0))
    cell, blx, bly = load_cell(rig, dev["body"], frame - 1)
    if cell is not None:
        comp.alpha_composite(cell, (int(round(210 + blx)), int(round(210 + bly))))
    ref_canvas = Image.new("RGBA", (420, 420), (0, 0, 0, 0))
    ref_canvas.alpha_composite(ref, (int(round(210 - ox * 2)), int(round(210 - oy * 2))))
    mean = 0.0
    n = 0
    ra, ca = ref_canvas.load(), comp.load()
    for y in range(420):
        for x in range(420):
            r, c = ra[x, y], ca[x, y]
            if r[3] == 0 and c[3] == 0:
                continue
            n += 1
            mean += abs(r[0] - c[0]) + abs(r[1] - c[1]) + abs(r[2] - c[2]) + abs(r[3] - c[3])
    mean = mean / (4 * n) if n else 0.0
    print(f"  {device:7} frame {frame:3}  body exact  mean |diff| {mean:5.2f}  px {n:5}")
    assert mean == 0, f"{device} f{frame}: body recompose differs by {mean:.2f}"
    return mean


def label_frames(cid: int) -> dict:
    sys.path.insert(0, os.path.join(REPO, "tools"))
    import swflabels as L
    out: dict[str, int] = {}
    for f, name in L.parse(L.SWF, cid):
        out.setdefault(name, f)
    return out


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    edits = T.parse()
    rig = {"note": (
        "Turret/Sentry killstreak art. `cells[f]` is SWF frame f+1, trimmed: "
        "x/y locate it in the sheet, lx/ly are STAGE px from that part's "
        "registration point. `headTrack[i]` is the head's affine on root frame "
        "headFirst+i (a/b/c/d/tx/ty, SVG matrix order); the head sprite is "
        "placed at (lx, ly) inside it. The HP bar and the two labels are drawn "
        "live by `KillstreakArt`."),
        "scale": 1, "parts": {}, "devices": {}}

    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        for device, ids in SPRITES.items():
            body_cid = ids["root"]
            n = len(S.frame_svgs(body_cid))
            head_cid = ids["head"]
            head_first, track = head_track(body_cid)
            hp_place, _ = find_use(body_cid, "mc_hp")
            name_place, _ = find_use(body_cid, "txt_name")
            level_place, _ = find_use(body_cid, "txt_level")
            body_part = f"{device}Body"
            head_part = f"{device}Head"
            rig["parts"][body_part] = bake(
                pg, body_part, body_cid, list(range(1, n + 1)),
                [ids["hp"], ids["name"], ids["level"]], head_cid, head_first)
            rig["parts"][head_part] = bake(
                pg, head_part, head_cid, list(range(1, HEAD_FRAMES + 1)), [])
            rig["devices"][device] = {
                "rootCid": body_cid,
                "headCid": head_cid,
                "body": body_part,
                "headPart": head_part,
                "headFirst": head_first,
                "headFrames": HEAD_FRAMES,
                "headTrack": track,
                "headPlace": track[-1],
                "hpPlace": hp_place,
                "namePlace": name_place,
                "nameCid": ids["name"],
                "levelPlace": level_place,
                "levelCid": ids["level"],
                "labels": label_frames(body_cid),
            }
            assert all(dev_k in rig["devices"][device]
                       for dev_k in ("headPlace", "hpPlace", "namePlace", "levelPlace")), device

        print("recompose checks (vs the SWF frame, dynamic children hidden):")
        for device, ids in SPRITES.items():
            base = [ids["hp"], ids["name"], ids["level"]]
            root_frames = len(S.frame_svgs(ids["root"]))
            for frame in (1, 20, 21, 25, 32, 33, 50, 69):
                if frame > root_frames:
                    continue
                check_body(pg, rig, device, frame, base)
        print("head placement checks:")
        check_head(pg, rig, "turret", 21)
        check_head(pg, rig, "turret", 25)
        check_head(pg, rig, "turret", 33)
        check_head(pg, rig, "sentry", 33)
        b.close()

    for cid in sorted(TEXT_CIDS):
        spec = edits.get(cid)
        if spec:
            spec = dict(spec)
            spec.pop("text", None)
            rig.setdefault("text", {})[str(cid)] = spec

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, indent=1)
    print(f"\nwrote {os.path.normpath(OUT_JSON)}")
    print("images in", os.path.normpath(OUT_IMG))


if __name__ == "__main__":
    main()
