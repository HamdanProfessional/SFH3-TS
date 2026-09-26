#!/usr/bin/env python3
from __future__ import annotations

import base64
import glob
import io
import json
import math
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R

from PIL import Image, ImageChops

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SPRITES = os.path.normpath(os.path.join(REPO, "..", "sfh3_decompiled", "sprites"))
SHOTS = os.path.join(REPO, "shots")
PNG_DIR = os.path.join(REPO, "public", "assets", "ragdoll")
RIG = json.load(open(os.path.join(REPO, "src", "assets", "ragdollRig.json"), encoding="utf-8"))

PARTS = [
    ("body", 0, 0, 0.1),
    ("head", 5, -16, 0.05),
    ("upperLeg", -14, 22, 0),
    ("lowerLeg", -14, 39, 0),
    ("foot", -10, 47, 0),
    ("upperLeg", -5, 22, 0),
    ("lowerLeg", -5, 39, 0),
    ("foot", -1, 47, 0),
    ("upperArm", -1, -3, -0.2),
    ("lowerArm", 9, 4, -0.5),
    ("hand", 20, 4, 0),
    ("upperArm", -1, -3, -0.2),
    ("lowerArm", 9, 4, -0.5),
    ("hand", 20, 4, 0),
]
PUSH = [11, 12, 13, 6, 5, 7, 0, 1, 3, 2, 4, 8, 9, 10]


def clip(key: str) -> dict | None:
    return RIG["clips"].get(key) or RIG["layerClips"].get(key)


def clamp(rec: dict, frame: int) -> int:
    if str(frame) in rec["frames"]:
        return frame
    keys = sorted(int(k) for k in rec["frames"])
    return min(keys, key=lambda k: abs(k - frame))


def layer_frame(name: str, costume: dict) -> int:
    return {
        "skin": costume["skin"], "face": costume["face"],
        "hair": costume["hair"], "robot": 1,
    }.get(name, 1)


def data_uri(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def atlas_cell(key: str, frame: int):
    rec = clip(key)
    if not rec:
        return None
    f = clamp(rec, frame)
    cell = rec["frames"].get(str(f))
    if cell is None:
        return None
    page = cell // rec["perPage"]
    local = cell % rec["perPage"]
    col, row = local % rec["cols"], local // rec["cols"]
    cw, ch = rec["cell"]
    sheet = Image.open(os.path.join(PNG_DIR, rec["sheets"][page]["file"])).convert("RGBA")
    return sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)), rec["origin"]


def svg_cell(pg, key: str, frame: int, tmp: str):
    rec = clip(key)
    f = clamp(rec, frame)
    cid = rec["cid"]
    d = glob.glob(os.path.join(SPRITES, f"DefineSprite_{cid}*"))[0]
    path = os.path.join(d, f"{f}.svg")
    svg = open(path, encoding="utf-8").read()
    m = re.search(r'height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
    w, h = float(m.group(2)), float(m.group(1))
    out = os.path.join(tmp, f"svg_{key.replace(':', '_')}_{f}.png")
    if not os.path.isfile(out):
        hide = [str(l["cid"]) for l in rec.get("layers", {}).get(str(f), [])]
        hide += ["1362", "844"]
        R.render(pg, svg, out, rect=(0, 0, w, h), hide_cids=hide)
    tx, ty = R.stage_origin(svg)
    return Image.open(out).convert("RGBA"), (tx * 2, ty * 2)


def ref_flat(pg, kind: str, frame: int, tmp: str):
    rec = clip(kind)
    d = glob.glob(os.path.join(SPRITES, f"DefineSprite_{rec['cid']}*"))[0]
    path = os.path.join(d, f"{frame}.svg")
    svg = open(path, encoding="utf-8").read()
    m = re.search(r'height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
    w, h = float(m.group(2)), float(m.group(1))
    out = os.path.join(tmp, f"ref_{kind}_{frame}.png")
    if not os.path.isfile(out):
        R.render(pg, svg, out, rect=(0, 0, w, h), hide_cids=["1362", "844"])
    tx, ty = R.stage_origin(svg)
    return Image.open(out).convert("RGBA"), (tx * 2, ty * 2)


def clip_html(key: str, frame: int, costume: dict, cell_fn) -> str:
    rec = clip(key)
    if not rec:
        return ""
    f = clamp(rec, frame)
    order = rec.get("order", {}).get(str(f), ["base"])
    layers = rec.get("layers", {}).get(str(f), [])
    out = []
    for item in order:
        if item == "base":
            got = cell_fn(key, f)
            if got:
                img, (ox, oy) = got
                out.append(
                    f'<img src="{data_uri(img)}" '
                    f'style="position:absolute;left:{-ox}px;top:{-oy}px;'
                    f'image-rendering:pixelated">')
            continue
        lay = layers[item]
        a, b, c, d, tx, ty = lay["m"]
        theta = math.degrees(math.atan2(b, a))
        sx = math.hypot(a, b)
        sy = (a * d - b * c) / sx
        inner = clip_html(
            f'{lay["name"]}:{lay["cid"]}',
            layer_frame(lay["name"], costume), costume, cell_fn)
        out.append(
            f'<div style="position:absolute;left:0;top:0;transform-origin:0 0;'
            f'transform:translate({tx}px,{ty}px) rotate({theta}deg) scale({sx},{sy})">'
            f'{inner}</div>')
    return f'<div style="position:absolute;left:0;top:0;transform-origin:0 0">{"".join(out)}</div>'


def corpse_html(cell_fn, frame: int, costume: dict, flat_fn=None) -> list[str]:
    out = []
    for i in PUSH:
        kind, x, y, rot = PARTS[i]
        if flat_fn is not None:
            img, (ox, oy) = flat_fn(kind, frame)
            inner = (
                f'<img src="{data_uri(img)}" style="position:absolute;'
                f'left:{-ox}px;top:{-oy}px;image-rendering:pixelated">')
        else:
            inner = clip_html(kind, frame, costume, cell_fn)
        out.append(
            f'<div style="position:absolute;left:0;top:0;transform-origin:0 0;'
            f'transform:translate({x}px,{y}px) rotate({rot * 180}deg)">'
            f'{inner}</div>')
    return out


def panel(parts_html: list[str], w: int, h: int, ox: float, oy: float, zoom: int) -> str:
    body = "".join(parts_html)
    return (
        f'<div class="panel" style="position:absolute;left:0;top:0;width:{w}px;height:{h}px;'
        f'background:#20242b;overflow:hidden">'
        f'<div style="position:absolute;left:{ox}px;top:{oy}px;'
        f'transform-origin:0 0;transform:scale({zoom})">'
        f'<div style="position:absolute;left:0;top:0;width:1px;height:1px;'
        f'background:#556;box-shadow:0 0 0 1px #556"></div>'
        f'{body}</div></div>')


def pair_page(pgs, left: list[str], right: list[str], left_label: str, right_label: str):
    pw, ph, ox, oy, zoom = 260, 320, 110, 118, 3
    page = (
        '<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0;padding:0;background:#20242b}'
        '.panel{position:relative}.label{position:absolute;left:8px;top:6px;color:#9ab;'
        'font:12px monospace}</style>'
        f'<body><div class="panel" id="left" '
        f'style="position:absolute;left:0;top:22px;width:{pw}px;height:{ph}px">'
        f'{panel(left, pw, ph, ox, oy, zoom)}'
        f'<div class="label">{left_label}</div></div>'
        f'<div class="panel" id="right" '
        f'style="position:absolute;left:{pw + 30}px;top:22px;width:{pw}px;height:{ph}px">'
        f'{panel(right, pw, ph, ox, oy, zoom)}'
        f'<div class="label">{right_label}</div></div>'
        f'</body>')
    pgs.set_viewport_size({"width": pw * 2 + 60, "height": ph + 40})
    pgs.set_content(page)
    pgs.wait_for_timeout(400)
    shots = {}
    for name in ("left", "right"):
        path = os.path.join(SHOTS, f"_ws2_tmp_{name}.png")
        pgs.query_selector(f"#{name}").screenshot(path=path)
        shots[name] = Image.open(path).convert("RGBA")
        os.remove(path)
    combined = Image.new("RGBA", (pw * 2 + 60, ph + 40), (32, 36, 43, 255))
    combined.paste(shots["left"], (0, 22))
    combined.paste(shots["right"], (pw + 30, 22))
    diff = ImageChops.difference(
        shots["left"].convert("RGB"), shots["right"].convert("RGB"))
    mask = diff.convert("L").point(lambda v: 255 if v > 24 else 0)
    off = mask.histogram()[255]
    total = shots["left"].width * shots["left"].height
    stats = f"{off}/{total} px over tolerance ({100.0 * off / total:.3f}%), bbox {mask.getbbox()}"
    return combined, stats


def main():
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="rdcheck_")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        pgs = b.new_page(device_scale_factor=1)

        baked = corpse_html(atlas_cell, 1, {"head": 1, "body": 1, "skin": 1, "face": 1, "hair": 1})
        flat = corpse_html(None, 1, {}, flat_fn=lambda k, f: ref_flat(pg, k, f, tmp))
        combined, stats = pair_page(
            pgs, baked, flat,
            "baked atlas + manifest layers",
            "sprites/DefineSprite_&lt;cid&gt;")
        combined.save(os.path.join(SHOTS, "_ws2_pose.png"))
        print(f"_ws2_pose.png: {stats}")

        costume3 = {"head": 3, "body": 3, "skin": 3, "face": 3, "hair": 3}
        baked3 = corpse_html(atlas_cell, 3, costume3)
        ref3 = corpse_html(
            lambda k, f: svg_cell(pg, k, f, tmp), 3, costume3)
        combined, stats = pair_page(
            pgs, baked3, ref3,
            "baked atlas + manifest layers (skin/face/hair = 3)",
            "per-clip SVG renders at the chosen frames")
        combined.save(os.path.join(SHOTS, "_ws2_pose_layers.png"))
        print(f"_ws2_pose_layers.png: {stats}")

        settle_path = os.path.join(SHOTS, "_ws2_settle.json")
        if os.path.isfile(settle_path):
            data = json.load(open(settle_path, encoding="utf-8"))
            frames = data["frames"]
            picks = list(range(0, len(frames), max(1, len(frames) // 8)))[:8]
            cells = []
            cw, ch, sc = 150, 420, 2
            ground = 520
            for fi in picks:
                parts = []
                for pi in range(14):
                    kind = data["parts"][pi]
                    px, py, ang = frames[fi][pi]
                    px -= data["origin"][0]
                    py -= data["origin"][1]
                    frame = data["costume"]["head"] if kind == "head" else data["costume"]["body"]
                    parts.append(
                        f'<div style="position:absolute;left:0;top:0;transform-origin:0 0;'
                        f'transform:translate({px}px,{py}px) rotate({math.degrees(ang)}deg)">'
                        f'{clip_html(kind, frame, data["costume"], atlas_cell)}</div>')
                cell = (
                    f'<div style="position:absolute;left:{len(cells) * (cw + 8)}px;top:0;'
                    f'width:{cw}px;height:{ch}px;background:#171a20;overflow:hidden">'
                    f'<div style="position:absolute;left:{cw // 2}px;top:20px;'
                    f'transform-origin:0 0;transform:scale({sc})">'
                    f'{ "".join(parts) }'
                    f'<div style="position:absolute;left:-200px;top:{ground - data["origin"][1]}px;'
                    f'width:500px;height:2px;background:#3a4150"></div>'
                    f'</div>'
                    f'<div style="position:absolute;left:6px;top:4px;color:#9ab;'
                    f'font:11px monospace">t={fi + 1}</div></div>')
                cells.append(cell)
            html = (
                '<!doctype html><meta charset="utf-8">'
                '<style>html,body{margin:0;background:#101318}</style><body>'
                + "".join(cells) + "</body>")
            width = len(cells) * (cw + 8)
            pgs.set_viewport_size({"width": width, "height": ch})
            pgs.set_content(html)
            pgs.wait_for_timeout(300)
            out = os.path.join(SHOTS, "_ws2_settle.png")
            pgs.screenshot(path=out, clip={"x": 0, "y": 0, "width": width, "height": ch})
            print(f"_ws2_settle.png: {len(picks)} frames -> {out}")
        else:
            print("no shots/_ws2_settle.json -- run tools/ragdoll/dump_settle.ts first")
        b.close()

    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
