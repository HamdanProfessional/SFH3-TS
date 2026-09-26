#!/usr/bin/env python3
from __future__ import annotations

import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swftext as T
import swflabels as SL
import uibake as U

REPO = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "ui", "postgame")
OUT_JSON = os.path.join(REPO, "src", "assets", "postgameUi.json")

SCALE = U.SUPERSAMPLE
PLATE_W = U.PLATE_W
PLATE_X = U.PLATE_X

POST_CID = 2106
TILE_CID = 2083
TILE_BAR_CID = 2080
RING_CID = 2076
BADGE_CID = 2034
SELECTED_CID = 2069
NEWSKILL_CID = 2071
LEVELUP_CID = 2102
BACK_CID = 2087

FIELDS = {
    "txt_title": 2054, "txt_back": 2088, "txt_day": 2093, "txt_funds": 2094,
    "txt_name": 2077, "txt_level": 2078, "txt_status": 2079,
}

ICON_HEAD = {"x": -6.2, "y": 11.25, "sx": 1.4734, "sy": 1.4734}
ICON_CLASS = {"x": -11.2, "y": 11.35, "sx": 1.2568, "sy": 1.2568}

MAT = re.compile(r"matrix\(([^)]*)\)")
NUM = r"[-0-9.eE]+"


def svg_size(svg: str):
    m = re.search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
    return float(m.group(2)), float(m.group(1))


def sprite_dir(cid: int) -> str:
    hits = glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}_*")) \
        + glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}"))
    if not hits:
        raise FileNotFoundError(f"no sprite dir for {cid}")
    return hits[0]


def bake_frame(pg, cid: int, frame: int, rel: str, hide_cids=()):
    path = os.path.join(sprite_dir(cid), f"{frame}.svg")
    svg = U.fix_glyph_text(open(path, encoding="utf-8").read())
    w, h = svg_size(svg)
    ox, oy = R.stage_origin(svg)
    R.render(pg, svg, os.path.join(OUT_IMG, rel), rect=(0, 0, w, h),
             hide_cids=list(hide_cids))
    return {"file": rel, "w": round(w * SCALE, 2), "h": round(h * SCALE, 2),
            "ox": round(ox * SCALE, 2), "oy": round(oy * SCALE, 2)}


def named_positions(path: str):
    import xml.etree.ElementTree as ET

    def parse_matrix(tag):
        m = MAT.search(tag or "")
        if not m:
            return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        return [float(x) for x in re.findall(NUM, m.group(1))]

    def mul(inner, outer):
        a, b, c, d, e, f = inner
        A, B, C, D, E, F = outer
        return [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d,
                A * e + C * f + E, B * e + D * f + F]

    tree = ET.parse(path)
    root = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    found = {}

    def walk(el, m):
        for c in el:
            cm = mul(parse_matrix(c.get("transform")), m)
            name = c.get("id")
            if name and name not in found:
                found[name] = cm
            walk(c, cm)

    walk(root, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    return found


def tag_placements(cid: int):
    import struct

    import uidump as UD
    buf = S.body()
    sprites = S.sprites(buf)
    a, b = sprites[cid]
    out, frame = {}, 1
    for code, p, _ln in S.tags(buf, a + 4, b):
        if code == S.SHOW_FRAME:
            frame += 1
            if frame > 1:
                break
        elif code in (S.PLACE2, S.PLACE3):
            o = UD.place(buf, p, code)
            if not o.get("name"):
                continue
            alpha = 1.0
            flags = buf[p]
            q = p + 1 + (1 if code == S.PLACE3 else 0) + 2
            if flags & 0x02:
                q += 2
            if flags & 0x04:
                _, q = S.matrix6(buf, q)
            if flags & 0x08:
                mult, _add, _ = S.cxform_read(buf, q)
                alpha = mult[3]
            out[o["name"]] = {"depth": o["depth"], "m": o.get("m"), "alpha": alpha}
    return out


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    edits = T.parse()
    out = {"scale": SCALE, "plate": {}, "tile": {}, "ring": {}, "badge": {},
           "selected": {}, "newskill": {}, "levelup": {}, "back": {},
           "fields": {k: edits[v] for k, v in FIELDS.items() if v in edits},
           "place": {}, "alpha": {}}

    post = tag_placements(POST_CID)
    tile = tag_placements(TILE_CID)
    for name in ("txt_title", "txt_day", "txt_funds", "txt_back", "bt_back",
                 "char", "levelup", "bar0", "bar1", "bar2", "bar3", "bar4",
                 "bar5", "squad0", "squad1", "squad2", "squad3", "squad4"):
        if name in post:
            m = post[name]["m"]
            out["place"][name] = [round(m[2], 4), round(m[3], 4), m[0], m[1]]
            out["alpha"][name] = round(post[name]["alpha"], 4)
    for name in ("txt_name", "txt_level", "txt_status", "bar", "icon"):
        if name in tile:
            m = tile[name]["m"]
            out["place"][f"tile_{name}"] = [round(m[2], 4), round(m[3], 4), m[0], m[1]]

    out["place"]["icon_head"] = ICON_HEAD
    out["place"]["icon_class"] = ICON_CLASS

    import uidump as UD

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SCALE)

        path = os.path.join(sprite_dir(POST_CID), "1.svg")
        svg = U.fix_glyph_text(open(path, encoding="utf-8").read())
        ox, oy = R.stage_origin(svg)
        hide_named = {"levelup", "squad0", "squad1", "squad2", "squad3",
                      "squad4", "char", "bar0", "bar1", "bar2", "bar3",
                      "bar4", "bar5", "bt_back"}
        import xml.etree.ElementTree as ET
        root = UD._root_group(ET.fromstring(svg))
        hide = []
        for i, child in enumerate(root):
            use = UD._use_of(child)
            if use is not None and use.get("id") in hide_named:
                hide.append(f"#host > svg > g > *:nth-child({i + 1})")
        R.render(pg, svg, os.path.join(OUT_IMG, "plate_postgame.png"),
                 rect=(ox + PLATE_X / 2, oy, PLATE_W / 2, R.DESIGN_H / 2),
                 hide=hide,
                 hide_cids=[FIELDS["txt_title"], FIELDS["txt_back"],
                            FIELDS["txt_day"], FIELDS["txt_funds"]])
        out["plate"] = {"file": "plate_postgame.png", "plateX": PLATE_X,
                        "plateY": 0, "plateW": PLATE_W, "plateH": R.DESIGN_H}

        tile_hide = [FIELDS["txt_name"], FIELDS["txt_level"], FIELDS["txt_status"],
                     RING_CID, TILE_BAR_CID]
        out["tile"] = {
            "filled": bake_frame(pg, TILE_CID, 1, "tile_filled.png", tile_hide),
            "empty": bake_frame(pg, TILE_CID, 2, "tile_empty.png", tile_hide),
        }
        out["tilebar"] = bake_frame(pg, TILE_BAR_CID, 1, "tile_bar.png")
        out["beam"] = bake_frame(pg, 2057, 1, "beam.png")

        ring_hide = [1923, BADGE_CID, 2062, 2064, SELECTED_CID, NEWSKILL_CID]
        for f in (1, 2, 3, 4):
            out["ring"][str(f)] = bake_frame(pg, RING_CID, f, f"ring_{f}.png", ring_hide)
        labels = SL.parse(SL.SWF, BADGE_CID)
        for frame, label in labels:
            if label in ("sni", "med", "eng", "mer", "jug", "gun", "eli",
                         "nin", "spe", "akq"):
                out["badge"][label] = bake_frame(
                    pg, BADGE_CID, frame, f"badge_{label}.png")
        out["selected"] = bake_frame(pg, SELECTED_CID, 1, "selected.png")
        out["newskill"] = bake_frame(pg, NEWSKILL_CID, 1, "newskill.png")

        frames = sorted(int(re.sub(r"\D", "", f))
                        for f in os.listdir(sprite_dir(LEVELUP_CID)))
        for f in frames:
            out["levelup"][str(f)] = bake_frame(
                pg, LEVELUP_CID, f, f"levelup_{f}.png")

        out["back"] = U.bake_button(pg, BACK_CID, {})
        m = post["bt_back"]["m"]
        out["back"].update({"x": m[0], "y": m[1],
                            "sx": round(m[2], 4), "sy": round(m[3], 4)})
        b.close()

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT_JSON)
    print("images in", OUT_IMG)


if __name__ == "__main__":
    main()
