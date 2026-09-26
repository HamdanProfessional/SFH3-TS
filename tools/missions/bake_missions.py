#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))

import swfio as S
import svgraster as R
import swftext as T
import uibake as U
import swflabels as L

REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "assets", "missions")
OUT_JSON = os.path.join(REPO, "src", "assets", "missionsUi.json")

FRAME = 21

CONT = 2596
BOX = 2675
BEAT = 2152
DOT = 2167
CHAL = 2163
SCROLL = 2598
BOXMAP = 2634
BOXMODE = 2034
BTN_ARROW = 2652
BTN_WIDE = 2087
BTN_DOT = 2144

BOX_FIELDS = [2635, 2636, 2637, 2640, 2641, 2643, 2644, 2647,
              2654, 2656, 2658, 2659, 2660, 2661, 2662, 2664, 2665, 2666,
              2667, 2668, 2673, 2674]

BOX_DYNAMIC = [BOXMAP, BOXMODE, BEAT, BTN_ARROW, BTN_WIDE, 2345]

CONT_PLACE = [10.45, 102.0]
CONT_CLIP = [12.15, 104.0, 775.3, 370.95]
BOX_PLACE = [521.5, 101.25]
DAILY_PLACE = [166.4, 117.35]
DAILY_SCALE = 0.369
SCROLL_PLACE = [11.95, 468.4]
CONTBOX = {"x": 10.85, "y": 104.4, "sx": 5.4348, "sy": 4.6664,
           "w": 142.95, "h": 79.65}

MAT = re.compile(r"matrix\(\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),"
                 r"\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\)")
SIZE = re.compile(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"')
SVG_NS = "{http://www.w3.org/2000/svg}"
FF_NS = "{https://www.free-decompiler.com/flash}"


def labels(cid: int) -> dict[str, int]:
    out: dict[str, int] = {}
    for f, name in L.parse(L.SWF, cid):
        out.setdefault(name, f)
    return out


def sprite_path(cid: int, frame: int) -> str:
    return os.path.join(S.sprite_dir(cid), f"{frame}.svg")


def render(pg, cid: int, frame: int, rel: str, hide_cids=(), hide=()):
    path = sprite_path(cid, frame)
    if not os.path.isfile(path):
        return None
    svg = U.fix_glyph_text(open(path, encoding="utf-8").read())
    if not R.ROOT_G.search(svg):
        return None
    tx, ty = R.stage_origin(svg)
    m = SIZE.search(svg)
    w, h = float(m.group(2)), float(m.group(1))
    out = os.path.join(OUT_IMG, rel)
    R.render(pg, svg, out, rect=(0, 0, w, h),
             hide=list(hide), hide_cids=[str(c) for c in hide_cids])
    return {"file": rel.replace("\\", "/"),
            "w": round(w * 2, 2), "h": round(h * 2, 2),
            "ox": round(tx * 2, 2), "oy": round(ty * 2, 2)}


def root_children(path: str):
    root = ET.parse(path).getroot()
    g = [c for c in root if c.tag == SVG_NS + "g"
         and "0.5" in (c.get("transform") or "")]
    if not g:
        return []
    out = []
    for i, c in enumerate(g[0]):
        cid = c.get(FF_NS + "characterId")
        out.append((i, c.tag.split("}")[-1], c.get("id") or "",
                    int(cid) if cid else None))
    return out


def tree_uses(path: str):
    root = ET.parse(path).getroot()
    out = []

    def walk(el, chain):
        for i, child in enumerate(el):
            sel = f"{chain} > *:nth-child({i + 1})"
            if child.tag == SVG_NS + "use":
                cid = child.get(FF_NS + "characterId")
                out.append({"sel": sel, "name": child.get("id") or "",
                            "cid": int(cid) if cid else None})
            elif child.tag in (SVG_NS + "g", SVG_NS + "switch"):
                walk(child, sel)

    walk(root, "#host > svg")
    return out


def placed_uses(path: str):
    root = ET.parse(path).getroot()
    g = [c for c in root if c.tag == SVG_NS + "g"
         and "0.5" in (c.get("transform") or "")]
    if not g:
        return []
    out = []
    for u in g[0].iter(SVG_NS + "use"):
        cid = u.get(FF_NS + "characterId")
        m = MAT.search(u.get("transform") or "")
        nums = [float(x) for x in m.groups()] if m else [1, 0, 0, 1, 0, 0]
        out.append({"name": u.get("id") or "",
                    "cid": int(cid) if cid else None,
                    "m": [round(v, 4) for v in nums]})
    return out


def bake_cont(pg):
    path = sprite_path(CONT, 1)
    kids = root_children(path)
    fog_i = next(i for i, _tag, name, _cid in kids if name == "fog")
    rec = render(pg, CONT, 1, "cont.png",
                 hide_cids=[DOT, CHAL],
                 hide=[f"#host > svg > g > *:nth-child({fog_i + 1})"])
    return {"tex": rec, "place": CONT_PLACE, "clip": CONT_CLIP}


def bake_fog(pg):
    rec = render(pg, 2595, 1, "fog.png")
    return crop_alpha(rec) if rec else rec


def crop_alpha(rec):
    from PIL import Image
    path = os.path.join(REPO, "public", "assets", "missions", rec["file"])
    im = Image.open(path).convert("RGBA")
    box = im.getbbox()
    if not box or box == (0, 0, im.width, im.height):
        return rec
    x0, y0, x1, y1 = box
    im.crop(box).save(path)
    s = U.SUPERSAMPLE
    rec["w"] = round((x1 - x0) / s, 2)
    rec["h"] = round((y1 - y0) / s, 2)
    rec["ox"] = round(rec["ox"] - x0 / s, 2)
    rec["oy"] = round(rec["oy"] - y0 / s, 2)
    return rec


def bake_scroll(pg):
    return render(pg, SCROLL, 1, "scroll.png")


def bake_dots(pg):
    out = {}
    for name, cid in (("dot", DOT), ("chal", CHAL)):
        recs = []
        for f in (1, 2, 3):
            recs.append(render(pg, cid, f, f"{name}_{f}.png",
                               hide_cids=[BEAT]))
        out[name] = recs
    return out


def bake_beat(pg):
    out = []
    for f in range(1, 8):
        out.append(render(pg, BEAT, f, f"beat_{f}.png"))
    return out


def clips(path: str):
    out = {}
    root = ET.parse(path).getroot()
    for cp in root.iter(SVG_NS + "clipPath"):
        el = cp.find(SVG_NS + "path")
        if el is None:
            continue
        nums = [float(x) for x in re.findall(r"[-0-9.eE]+", el.get("d") or "")]
        if len(nums) != 8:
            continue
        xs, ys = nums[0::2], nums[1::2]
        out[cp.get("id")] = [round(min(xs), 2), round(min(ys), 2),
                             round(max(xs) - min(xs), 2),
                             round(max(ys) - min(ys), 2)]
    return out


def bake_box(pg):
    fields = [c for c in BOX_FIELDS if c in T.parse()]
    hide = fields + BOX_DYNAMIC
    out = {}
    for f in (1, 2, 3):
        path = sprite_path(BOX, f)
        uses = tree_uses(path)
        map_i = next(i for i, u in enumerate(uses) if u["cid"] == BOXMAP)
        under = render(pg, BOX, f, f"box_{f}_under.png", hide_cids=hide,
                       hide=[u["sel"] for u in uses[map_i + 1:]])
        over = render(pg, BOX, f, f"box_{f}.png", hide_cids=hide,
                      hide=[u["sel"] for u in uses[:map_i]])
        out[str(f)] = {"under": under, "over": over,
                       "place": placed_uses(path),
                       "clip": clips(path).get("clipPath0")}
    return out


def bake_boxmap(pg):
    out = {}
    for name, f in labels(BOXMAP).items():
        rec = render(pg, BOXMAP, f, f"boxmap_{name}.png")
        if rec:
            out[name] = rec
    return out


MODES = ["dm", "tdm", "elim", "telim", "ctf", "dom", "one", "zom", "gg", "tgg"]


def bake_boxmode(pg):
    out = {}
    for name, f in labels(BOXMODE).items():
        if name not in MODES:
            continue
        rec = render(pg, BOXMODE, f, f"boxmode_{name}.png")
        if rec:
            out[name] = rec
    return out


def bake_buttons(pg):
    done = {}
    out = {}
    for cid in (BTN_ARROW, BTN_WIDE, BTN_DOT):
        out[str(cid)] = U.bake_button(pg, cid, done)
    return out


def bake_plate(pg, extra):
    with open(os.path.join(REPO, "src", "assets", "menuFrames.json"),
              encoding="utf-8") as fh:
        frames = json.load(fh)
    fr = frames["missions"]
    with open(R.menu_frame_path(FRAME), encoding="utf-8") as fh:
        svg = U.fix_glyph_text(fh.read())
    edits = T.parse()
    hide = U.plate_hidden(fr["items"], edits, extra)
    ox, oy = R.stage_origin(svg)
    path = os.path.join(REPO, "public", "ui", "plate_missions.png")
    R.render(pg, svg, path,
             rect=(ox + U.PLATE_X / 2, oy, U.PLATE_W / 2, R.DESIGN_H / 2),
             hide=[U.child_sel(i) for i in hide],
             hide_cids=sorted(edits) + [DOT, CHAL])
    return {"file": "ui/plate_missions.png",
            "x": U.PLATE_X, "y": 0, "w": U.PLATE_W, "h": R.DESIGN_H}


def main():
    pieces = set(sys.argv[1:]) or None
    os.makedirs(OUT_IMG, exist_ok=True)

    old = {}
    if os.path.isfile(OUT_JSON) and pieces:
        with open(OUT_JSON, encoding="utf-8") as fh:
            old = json.load(fh)

    rig = dict(old)
    rig.setdefault("scale", 1)
    rig.setdefault("plate", {})
    rig.setdefault("text", {})

    edits = T.parse()
    for cid in BOX_FIELDS + [2635]:
        if cid in edits:
            rig["text"][str(cid)] = edits[cid]

    def want(name):
        return pieces is None or name in pieces

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=U.SUPERSAMPLE)
        if want("plate"):
            rig["plate"] = bake_plate(pg, {"cont", "box_mission", "mc_daily"})
            print("plate ok")
        if want("cont"):
            rig["cont"] = bake_cont(pg)
            print("cont ok")
        if want("fog"):
            rig["fog"] = bake_fog(pg)
            print("fog ok")
        if want("scroll"):
            rig["scroll"] = bake_scroll(pg)
            print("scroll ok")
        if want("dots"):
            rig["dots"] = bake_dots(pg)
            print("dots ok")
        if want("beat"):
            rig["beat"] = bake_beat(pg)
            print("beat ok")
        if want("box"):
            rig["box"] = bake_box(pg)
            print("box ok")
        if want("boxmap"):
            rig["boxmap"] = bake_boxmap(pg)
            print("boxmap:", len(rig["boxmap"]))
        if want("boxmode"):
            rig["boxmode"] = bake_boxmode(pg)
            print("boxmode:", len(rig["boxmode"]))
        if want("buttons"):
            rig["buttons"] = bake_buttons(pg)
            print("buttons ok")
        b.close()

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, indent=1)
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
