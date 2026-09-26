#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageChops

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
sys.path.insert(0, os.path.dirname(SC))
SPR = os.path.normpath(os.path.join(REPO, "..", "sfh3_decompiled", "sprites"))
OUT = os.path.join(REPO, "public", "assets", "units")
DBG = os.path.join(OUT, "_check")
RIG = json.load(open(os.path.join(REPO, "src", "assets", "unitAnim.json"), encoding="utf-8"))
import glob


def sprite_dir(cid):
    return glob.glob(os.path.join(SPR, f"DefineSprite_{cid}*"))[0]


def frame_rec(group: str, frame) -> dict | None:
    return RIG["groups"][group]["frames"].get(str(frame))


def cell_image(group: str, frame) -> Image.Image | None:
    rec = frame_rec(group, frame)
    if not rec:
        return None
    g = RIG["groups"][group]
    cw, ch = g["cell"]
    page = rec["i"] // g["perPage"]
    sheet = g["sheets"][page]
    local = rec["i"] % g["perPage"]
    col, row = local % g["cols"], local // g["cols"]
    im = Image.open(os.path.join(OUT, sheet["file"])).convert("RGBA")
    return im.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))


def mul(inner, outer):
    a, b, c, d, e, f = inner
    A, B, C, D, E, F = outer
    return [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d,
            A * e + C * f + E, B * e + D * f + F]


def draw(canvas: Image.Image, group: str, frame, m, ox, oy):
    cell = cell_image(group, frame)
    if cell is None:
        return
    rec = frame_rec(group, frame)
    size = canvas.size
    a, b, c, d, e, f = m
    det = a * d - b * c
    if abs(det) < 1e-9:
        return
    ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
    ie = (c * f - d * e) / det
    if_ = (b * e - a * f) / det
    data = (ia, ic, ie + rec["ox"] - ia * ox - ic * oy,
            ib, id_, if_ + rec["oy"] - ib * ox - id_ * oy)
    layer = cell.transform(size, Image.AFFINE, data, resample=Image.BICUBIC)
    canvas.alpha_composite(layer)


def draw_part(canvas, group, frame, m, ox, oy, skin=1):
    draw(canvas, group, frame, m, ox, oy)
    rec = frame_rec(group, frame)
    if rec and rec.get("skin"):
        draw(canvas, f"skin_{rec['skin']['cid']}", skin, rec["skin"]["m"], ox, oy)


def compose_body(frame: int, costume: int, ox: float, oy: float, size):
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    for name, *m in RIG["timeline"][frame - 1]:
        part = {"legup1": "leg", "legup2": "leg", "leglow1": "shin",
                "leglow2": "shin", "foot1": "foot", "foot2": "foot"}.get(name, name)
        if part not in ("body", "waist", "leg", "shin", "foot"):
            continue
        draw_part(canvas, part, costume, m, ox, oy)
    return canvas


def compose_head(costume: int, ox: float, oy: float, size):
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    draw(canvas, "head", costume, [1, 0, 0, 1, 0, 0], ox, oy)
    rec = frame_rec("head", costume)
    if rec.get("face"):
        draw(canvas, f"face_{rec['face']['cid']}", 1, rec["face"]["m"], ox, oy)
        face = frame_rec(f"face_{rec['face']['cid']}", 1)
        if face.get("skin"):
            draw(canvas, f"skin_{face['skin']['cid']}", 1,
                 mul(face["skin"]["m"], rec["face"]["m"]), ox, oy)
    if rec.get("hair"):
        draw(canvas, f"hair_{rec['hair']['cid']}", 1, rec["hair"]["m"], ox, oy)
    return canvas


def compose_arm1(costume: int, layout: str, ox: float, oy: float, size):
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    for name, *m in RIG["arm1"][layout]:
        part = {"armup1": "arm", "armlow1": "forearm", "hand1": "hand"}.get(name)
        if part:
            draw_part(canvas, part, costume, m, ox, oy)
    return canvas


def rot_t(tx: float, ty: float, deg: float):
    import math
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return [c, s, -s, c, tx, ty]


def compose_figure(frame: int, hero: dict, arm_label: str, gun_frame: int, arm_deg: float,
                   head_deg: float, ox: float, oy: float, size,
                   stow: dict | None = None, holders: bool = False,
                   flip: bool = False) -> Image.Image:
    def fm(m):
        return mul([-1, 0, 0, 1, 0, 0], m) if flip else m
    row = RIG["timeline"][frame - 1]
    ax = ay = hx = hy = 0.0
    for e in row:
        if e[0] == "arm1hold":
            ax, ay = e[5], e[6]
        if e[0] == "headhold":
            hx, hy = e[5], e[6]
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    costume = hero["body"] + hero["color"] - 1

    def head(key: str, m):
        f = hero["head"] + hero["color"] - 1
        rec = frame_rec("head", f)
        if rec.get("face"):
            draw(canvas, f"face_{rec['face']['cid']}", hero["face"],
                 mul(rec["face"]["m"], m), ox, oy)
            face = frame_rec(f"face_{rec['face']['cid']}", hero["face"])
            if face and face.get("skin"):
                draw(canvas, f"skin_{face['skin']['cid']}", hero["skin"],
                     mul(face["skin"]["m"], mul(rec["face"]["m"], m)), ox, oy)
        if rec.get("hair"):
            draw(canvas, f"hair_{rec['hair']['cid']}", hero["hair"],
                 mul(rec["hair"]["m"], m), ox, oy)
        draw(canvas, "head", f, m, ox, oy)

    def arm(layout, A, gun):
        for e in layout:
            name = e[0]
            L = e[1:]
            seg = {"armup1": "arm", "armlow1": "forearm", "hand1": "hand",
                   "armup2": "arm", "armlow2": "forearm", "hand2": "hand"}.get(name)
            if seg:
                draw_part(canvas, seg, costume, mul(L, A), ox, oy)
            elif name in ("gun", "gun2") and gun > 0:
                draw(canvas, "gun", gun, mul(L, A), ox, oy)

    for e in row:
        name, m = e[0], fm(e[1:])
        if name == "arm2" and not holders:
            arm(RIG["arm2"][arm_label], rot_t(ax, ay, arm_deg), gun_frame)
        elif name == "body":
            draw_part(canvas, "body", costume, m, ox, oy)
            if stow and stow["target"] == "body" and stow["frame"] > 0:
                rec = frame_rec("body", costume)
                draw(canvas, "stow", stow["frame"], mul(rec["gun"]["m"], m), ox, oy)
        elif name == "waist":
            draw_part(canvas, "waist", costume, m, ox, oy)
        elif name in ("legup1", "legup2"):
            draw_part(canvas, "leg", costume, m, ox, oy)
            if stow and stow["target"] == name and stow["frame"] > 0:
                rec = frame_rec("leg", costume)
                draw(canvas, "gun", stow["frame"], mul(rec["gun"]["m"], m), ox, oy)
        elif name in ("leglow1", "leglow2"):
            draw_part(canvas, "shin", costume, m, ox, oy)
        elif name in ("foot1", "foot2"):
            draw_part(canvas, "foot", costume, m, ox, oy)
        elif name == "head" and not holders:
            head("head", rot_t(hx, hy, head_deg))
        elif name == "arm1" and not holders:
            arm(RIG["arm1"][arm_label], rot_t(ax, ay, arm_deg), gun_frame)
        elif name == "headhold" and holders:
            head("headhold", m)
        elif name == "arm1hold" and holders:
            arm(RIG["arm1hold"], m, 0)
    return canvas


def diff(label: str, got: Image.Image, ref: Image.Image) -> int:
    if got.size != ref.size:
        print(f"  FAIL {label}: size {got.size} != {ref.size}")
        return 1
    ga = got.getchannel("A").load()
    ra = ref.getchannel("A").load()
    w, h = got.size
    bad = 0
    for y in range(h):
        for x in range(w):
            if (ga[x, y] > 32) == (ra[x, y] > 32):
                continue
            hit = False
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and ga[nx, ny] > 32 and ra[nx, ny] > 32:
                        hit = True
            if not hit:
                bad += 1
    frac = bad / (w * h)
    status = "ok" if frac < 0.01 else "FAIL"
    print(f"  {status} {label}: {bad} edge px differ ({frac * 100:.2f}%)")
    return 0 if status == "ok" else 1


def render_ref(pg, path: str, out: str, hide=()):
    import svgraster as R
    svg = open(path, encoding="utf-8").read()
    tx, ty = R.stage_origin(svg)
    m = __import__("re").search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
    rect = (0, 0, float(m.group(2)), float(m.group(1)))
    R.render(pg, svg, out, rect=rect, hide_cids=[str(c) for c in hide])
    im = Image.open(out).convert("RGBA")
    return im, tx * 2, ty * 2


def main():
    write = "--write" in sys.argv
    from playwright.sync_api import sync_playwright
    import svgraster as R

    os.makedirs(DBG, exist_ok=True)
    failures = 0
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        flat, ox, oy = render_ref(pg, os.path.join(sprite_dir(1970), "1.svg"),
                                  os.path.join(DBG, "_ref_body.png"),
                                  hide=(1923, 1965, 928, 1924, 844, 1362, 1967, 1969))
        got = compose_body(1, 1, ox, oy, flat.size)
        failures += diff("body pose f1 costume 1", got, flat)
        if write:
            got.save(os.path.join(DBG, "_got_body.png"))

        flat, ox, oy = render_ref(pg, os.path.join(sprite_dir(1923), "1.svg"),
                                  os.path.join(DBG, "_ref_head.png"))
        got = compose_head(1, ox, oy, flat.size)
        failures += diff("head f1", got, flat)
        if write:
            got.save(os.path.join(DBG, "_got_head.png"))

        flat, ox, oy = render_ref(pg, os.path.join(sprite_dir(1965), "1.svg"),
                                  os.path.join(DBG, "_ref_arm.png"), hide=(844, 659))
        got = compose_arm1(1, "pistol", ox, oy, flat.size)
        failures += diff("arm1 pistol costume 1", got, flat)
        if write:
            got.save(os.path.join(DBG, "_got_arm.png"))
        b.close()
    print("\nOK" if not failures else f"\n{failures} check(s) FAILED")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
