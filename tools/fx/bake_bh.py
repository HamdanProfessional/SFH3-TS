#!/usr/bin/env python3
import base64
import hashlib
import json
import math
import os
import struct
import sys

from playwright.sync_api import sync_playwright
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SC, ".."))
sys.path.insert(0, SC)
import swfio as S
import bh_dump as D
from swfio import frame_svgs, header, shelf_pack

OUT = os.path.join(S.REPO, "public", "assets", "fx")
RIG = os.path.join(S.REPO, "src", "assets", "fxRig.json")

SKIP: set[str] = set()

WANT = None

SWF_GLOW, SWF_BLUR, SWF_GRADGLOW, SWF_COLORMATRIX = 2, 1, 4, 6

GRADIENT_STEPS = 32


def fixed(payload, off):
    return struct.unpack_from("<i", payload, off)[0] / 65536.0


def fixed8(payload, off):
    return struct.unpack_from("<h", payload, off)[0] / 256.0


def gradient_glow(payload):
    n = payload[0]
    p = 1
    cols = [tuple(payload[p + i * 4 : p + i * 4 + 4]) for i in range(n)]
    p += n * 4
    ratios = list(payload[p : p + n])
    p += n
    blur = fixed(payload, p)
    strength = fixed8(payload, p + 16)
    flags = payload[p + 18]
    knockout = bool(flags & 0x40)
    on_top = bool(flags & 0x10)

    def sample(t):
        if t <= ratios[0]:
            return cols[0]
        for i in range(1, n):
            if t <= ratios[i]:
                span = max(1, ratios[i] - ratios[i - 1])
                f = (t - ratios[i - 1]) / span
                return tuple(cols[i - 1][c] + (cols[i][c] - cols[i - 1][c]) * f
                             for c in range(4))
        return cols[-1]

    steps = [sample(i * 255 / (GRADIENT_STEPS - 1)) for i in range(GRADIENT_STEPS)]
    chan = lambda c, scale=255.0: " ".join(f"{s[c] / scale:.4f}" for s in steps)
    body = (
        f'<feGaussianBlur in="SourceAlpha" stdDeviation="{blur / 4:.3f}" result="gg"/>'
        f'<feColorMatrix in="gg" type="matrix" result="gd" values="'
        f'0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0"/>'
        f'<feComponentTransfer in="gd" result="gr">'
        f'<feFuncR type="table" tableValues="{chan(0)}"/>'
        f'<feFuncG type="table" tableValues="{chan(1)}"/>'
        f'<feFuncB type="table" tableValues="{chan(2)}"/>'
        f'<feFuncA type="table" tableValues="{chan(3, 255.0 / min(1.0, strength))}"/>'
        f'</feComponentTransfer>'
    )
    if knockout:
        return body
    order = ("SourceGraphic", "gr") if on_top else ("gr", "SourceGraphic")
    return body + (f'<feMerge><feMergeNode in="{order[0]}"/>'
                   f'<feMergeNode in="{order[1]}"/></feMerge>')


def svg_filter(filters, cx):
    parts, tint = [], None
    for fid, payload in filters:
        if fid == SWF_BLUR:
            bx, by = fixed(payload, 0), fixed(payload, 4)
            parts.append(f'<feGaussianBlur stdDeviation="{bx / 4:.3f} {by / 4:.3f}"/>')
        elif fid == SWF_GLOW:
            r, g, b, a = payload[0], payload[1], payload[2], payload[3]
            bx = fixed(payload, 4)
            strength = fixed8(payload, 12)
            parts.append(
                f'<feFlood flood-color="rgb({r},{g},{b})" flood-opacity="{a / 255:.3f}" '
                f'result="gc"/>'
                f'<feComposite in="gc" in2="SourceAlpha" operator="in" result="gm"/>'
                f'<feGaussianBlur in="gm" stdDeviation="{bx / 4:.3f}" result="gb"/>'
                f'<feComponentTransfer in="gb" result="gs">'
                f'<feFuncA type="linear" slope="{min(3.0, strength):.3f}"/>'
                f'</feComponentTransfer>'
                f'<feMerge><feMergeNode in="gs"/><feMergeNode in="SourceGraphic"/></feMerge>'
            )
        elif fid == SWF_COLORMATRIX:
            m = D.color_matrix(payload)
            vals = []
            for row in range(4):
                vals += [f"{v:.5f}" for v in m[row * 5 : row * 5 + 4]]
                vals.append(f"{m[row * 5 + 4] / 255.0:.5f}")
            parts.append(f'<feColorMatrix type="matrix" values="{" ".join(vals)}"/>')
        elif fid == SWF_GRADGLOW:
            parts.append(gradient_glow(payload))
        else:
            print(f"  !! filter id {fid} not reproduced")
    if cx:
        mult, add = cx
        if max(mult[:3]) < 0.01 and any(add[:3]):
            tint = (int(add[0]) << 16) | (int(add[1]) << 8) | int(add[2])
        elif any(add[:3]) or min(mult[:3]) < 0.99:
            vals = []
            for row in range(3):
                vals += ["0"] * row + [f"{mult[row]:.4f}"] + ["0"] * (3 - row)
                vals.append(f"{add[row] / 255.0:.4f}")
            vals += ["0", "0", "0", f"{mult[3]:.4f}", f"{add[3] / 255.0:.4f}"]
            parts.append(f'<feColorMatrix type="matrix" values="{" ".join(vals)}"/>')
    return "".join(parts), tint


def decompose(m):
    tx, ty, a, d, b, c = m
    if abs(b) < 1e-9 and abs(c) < 1e-9:
        return a, d, 0.0
    sx = math.hypot(a, b)
    sy = math.hypot(c, d)
    if a * d - b * c < 0:
        sy = -sy
    return sx, sy, math.degrees(math.atan2(b, a))


def transformed_box(w, h, ox, oy, sx, sy, deg):
    t = math.radians(deg)
    co, si = math.cos(t), math.sin(t)
    xs, ys = [], []
    for px, py in ((-ox, -oy), (w - ox, -oy), (-ox, h - oy), (w - ox, h - oy)):
        qx, qy = px * sx, py * sy
        xs.append(qx * co - qy * si)
        ys.append(qx * si + qy * co)
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def render(pg, path, sx, sy, deg, fbody, bake):
    svg = open(path, encoding="utf-8").read()
    w, h, ox, oy = header(svg)
    bx, by, bw, bh = transformed_box(w, h, ox, oy, sx, sy, deg)
    vw, vh = max(8, math.ceil(bw * bake) + 8), max(8, math.ceil(bh * bake) + 8)
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    fdef = (
        f'<svg width="0" height="0" style="position:absolute"><filter id="fx" '
        f'x="-75%" y="-75%" width="250%" height="250%" '
        f'color-interpolation-filters="sRGB">{fbody}</filter></svg>'
        if fbody else ""
    )
    px, py = 4 - bx * bake - ox, 4 - by * bake - oy
    pg.set_viewport_size({"width": vw, "height": vh})
    pg.set_content(
        f'<body style="margin:0;background:transparent">{fdef}'
        f'<img id="i" src="data:image/svg+xml;base64,{b64}" width="{w}" height="{h}" '
        f'style="position:absolute;left:{px}px;top:{py}px;'
        f'transform-origin:{ox}px {oy}px;'
        f'transform:scale({bake}) rotate({deg}deg) scale({sx},{sy});'
        f'{f"filter:url(#fx);" if fbody else ""}"></body>'
    )
    pg.wait_for_selector("#i", state="attached")
    tmp = os.path.join(OUT, "_raw.png")
    pg.screenshot(path=tmp, omit_background=True)
    im = Image.open(tmp).convert("RGBA")
    os.remove(tmp)
    box = im.getbbox()
    if not box:
        return None, 0, 0
    return (im.crop(box),
            round((box[0] - 4) / bake + bx, 1),
            round((box[1] - 4) / bake + by, 1))


def whiten(im):
    out = Image.new("RGBA", im.size, (255, 255, 255, 0))
    out.putalpha(im.getchannel("A"))
    return out


def bake_effect(pg, name, cid, rot_amt, sx, sy, fbody, tint, subs, bake, base_deg=0.0):
    svgs = frame_svgs(cid)
    if not svgs:
        print(f"  !! no export for cid {cid}")
        return None
    nframes = len(svgs)
    step = 360.0 / rot_amt
    imgs, meta, seen = [], [], {}
    for r in range(rot_amt):
        for svg in svgs:
            im, lx, ly = render(pg, svg, sx, sy, base_deg + r * step, fbody, bake)
            if im is None:
                imgs.append(None)
                meta.append({"x": 0, "y": 0, "w": 0, "h": 0, "lx": 0, "ly": 0})
                continue
            if tint is not None:
                im = whiten(im)
            key = (im.tobytes(), lx, ly)
            meta.append({"w": im.width, "h": im.height, "lx": lx, "ly": ly})
            if key in seen:
                imgs.append(None)
                meta[-1]["same"] = seen[key]
            else:
                seen[key] = len(meta) - 1
                imgs.append(im)

    solid = [(i, im) for i, im in enumerate(imgs) if im is not None]
    pos, pages = shelf_pack([(im.width, im.height) for _, im in solid])
    sheets = [Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0)) for w, h in pages]
    for (i, im), (page, x, y) in zip(solid, pos):
        sheets[page].paste(im, (x, y))
        meta[i]["p"], meta[i]["x"], meta[i]["y"] = page, x, y
    for m in meta:
        if "same" in m:
            src = meta[m.pop("same")]
            m["p"], m["x"], m["y"] = src["p"], src["x"], src["y"]

    files, kb = [], 0.0
    for page, sheet in enumerate(sheets):
        fn = f"{name}.png" if len(sheets) == 1 else f"{name}_{page}.png"
        sheet.save(os.path.join(OUT, fn))
        kb += os.path.getsize(os.path.join(OUT, fn)) / 1024
        files.append(fn)
    print(f"  {name:14} {nframes:2}f x{rot_amt}rot ({nframes * rot_amt - len(solid):2} dup)"
          f"  {len(sheets)} page(s)  {kb:6.0f} KB")

    rig = {"cid": cid, "files": files, "bakeScale": round(bake, 4),
           "rotAmt": rot_amt, "frames": nframes, "cells": meta}
    if tint is not None:
        rig["whitened"] = True
    if subs and not (len(subs) == 1 and subs[0][0] in (None, "idle")):
        rig["subs"] = {s or "idle": n for s, n in subs}
    return rig


def main():
    argv = sys.argv[1:]
    names = [argv[i + 1] for i, a in enumerate(argv) if a == "--name"]
    bake = float(argv[argv.index("--bake") + 1]) if "--bake" in argv else 1.0
    os.makedirs(OUT, exist_ok=True)

    buf = S.body()
    sp = S.sprites(buf)
    rot = D.rotate_table()

    entries = {}
    for frame, label, place in D.timeline(buf, sp[D.bh_cid()]):
        if not label or not place:
            continue
        entries[label] = (frame, place)

    want = names or (list(entries) if WANT is None else WANT)
    missing = [n for n in want if n not in entries]
    if missing:
        raise SystemExit(f"not in the BH atlas: {', '.join(missing)}")
    skipped = [n for n in want if n in SKIP]
    if skipped:
        print(f"skipping {', '.join(skipped)} (see SKIP)")
        want = [n for n in want if n not in SKIP]

    rig = {"fx": {}, "note": (
        "BH atlas effects. `cells` is rotAmt*frames entries, rotation-major: cell "
        "r*frames+f is animation frame f at rotation r, and Effect.as picks r at "
        "random per spawn. Each cell is trimmed to its own content box — x/y "
        "locate it in the sheet, lx/ly place it against the effect's origin, "
        "which is the point createEffect() is called at. The placement's scale, "
        "rotation, colour transform and filters are already baked in; a "
        "`whitened` effect is a flat mask to be drawn with `tint`.")}

    if os.path.exists(RIG) and "--all" not in argv:
        rig["fx"] = json.load(open(RIG, encoding="utf-8")).get("fx", {})
        for n in want:
            rig["fx"].pop(n, None)

    baked = {}
    print(f"baking {len(want)} effect(s)")
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page()
        for name in want:
            frame, (cid, m, cx, fl) = entries[name]
            sx, sy, place_deg = decompose(m) if m else (1.0, 1.0, 0.0)
            fbody, tint = svg_filter(fl, cx)
            rotate = rot.get(frame, 0)
            n_rot = D.rot_amt(rotate)
            base_deg = place_deg if rotate <= 0 else 0.0
            key = (cid, round(sx, 4), round(sy, 4), round(base_deg, 3), n_rot,
                   hashlib.md5(fbody.encode()).hexdigest(), tint is not None)
            if key not in baked:
                got = bake_effect(
                    pg, name, cid, n_rot, sx, sy, fbody, tint,
                    D.subanims(buf, sp[cid]) if cid in sp else [], bake=bake,
                    base_deg=base_deg)
                if not got:
                    continue
                baked[key] = name
                rig["fx"][name] = got
            entry = rig["fx"].setdefault(name, {"alias": baked[key]})
            if baked[key] != name:
                entry["alias"] = baked[key]
                print(f"  {name:14} -> shares {baked[key]}'s atlas")
            if tint is not None:
                entry["tint"] = tint
            if cx and abs(cx[0][3] + cx[1][3] / 255.0 - 1.0) > 0.01:
                entry["alpha"] = round(max(0.0, min(1.0, cx[0][3] + cx[1][3] / 255.0)), 3)
        b.close()

    json.dump(rig, open(RIG, "w", encoding="utf-8"), indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, f))
                for e in rig["fx"].values() for f in e.get("files", []))
    print(f"\nwrote {len(rig['fx'])} effect(s) ({total / 1e6:.2f} MB) -> {OUT}")
    print(f"wrote {RIG}")


if __name__ == "__main__":
    main()
