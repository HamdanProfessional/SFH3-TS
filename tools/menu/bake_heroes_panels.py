#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swftext as T
import uibake as U

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_PNG = os.path.join(REPO, "public", "assets", "menu-parts", "panels")
OUT_JSON = os.path.join(REPO, "src", "assets", "menuPanels.json")
FRAMES_JSON = os.path.join(REPO, "src", "assets", "menuFrames.json")
PICKER_PNG = os.path.join(REPO, "public", "assets", "menu-parts", "picker")

LEFT_CID = 2470
RIGHT_CID = 2447
STATUS_CID = 2435
COL_CID = 2469
SEL_CID = 2379
DISMISS_CID = 2446

SUPERSAMPLE = 2

LEFT_HIDE = [2080, 2380, 2170, 2071, 2034, 2469]
RIGHT_HIDE = [2380, 2170, DISMISS_CID]

FIELDS_LEFT = ["txt_health", "txt_crit", "txt_aim", "txt_mobile", "txt_aggro",
               "txt_newskill", "txt_class", "txt_level", "txt_name"]
BARS_LEFT = ["bar", "bar1_health", "bar2_health", "bar1_crit", "bar2_crit",
             "bar1_aim", "bar2_aim", "bar1_mobile", "bar2_mobile",
             "bar1_aggro", "bar2_aggro"]
ITEMS_LEFT = ["trait", "flaw", "streak",
              "perk00", "perk01", "perk10", "perk11", "perk20", "perk21"]
ITEMS_RIGHT = ["primary", "secondary", "gun", "armor"]

NUM = r"[-0-9.eE]+"
MAT = re.compile(r"matrix\(([^)]*)\)")
SIZE_RE = re.compile(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"')
FF = "{https://www.free-decompiler.com/flash}"


def parse_matrix(tag: str | None):
    m = MAT.search(tag or "")
    if not m:
        return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return [float(x) for x in re.findall(NUM, m.group(1))]


def mat_mul(inner, outer):
    a, b, c, d, e, f = inner
    A, Bc, C, D, E, F = outer
    return [
        A * a + C * b, Bc * a + D * b,
        A * c + C * d, Bc * c + D * d,
        A * e + C * f + E, Bc * e + D * f + F,
    ]


def svg_size(svg: str):
    h, w = (float(x) for x in SIZE_RE.search(svg).groups())
    return w * 2, h * 2


def named_uses(svg_path: str):
    tree = ET.parse(svg_path)
    root = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    found = {}

    def walk(el, m):
        for c in el:
            cm = mat_mul(parse_matrix(c.get("transform")), m)
            name = c.get("id") or ""
            if name and name not in found:
                cid = c.get(FF + "characterId")
                found[name] = (int(cid) if cid else None, cm)
            walk(c, cm)

    walk(root, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    return found


def frame_uses(svg_path: str):
    tree = ET.parse(svg_path)
    root = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    return [u for u in root.iter() if u.tag.endswith("}use")]


def sprite_svg(cid):
    return os.path.join(S.sprite_dir(cid), "1.svg")


def main():
    os.makedirs(OUT_PNG, exist_ok=True)
    edits = T.parse()
    hide_edits = sorted(edits)

    with open(FRAMES_JSON, encoding="utf-8") as fh:
        frames = json.load(fh)
    names = {it["name"]: it for it in frames["heroes"]["items"]}

    out = {
        "scale": SUPERSAMPLE,
        "box": {},
        "fields": {},
        "items": {},
        "cols": {},
        "sel": None,
        "button": None,
        "statusField": None,
    }

    left_svg = sprite_svg(LEFT_CID)
    right_svg = sprite_svg(RIGHT_CID)
    status_svg = sprite_svg(STATUS_CID)

    left = named_uses(left_svg)
    right = named_uses(right_svg)
    status = named_uses(status_svg)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SUPERSAMPLE)

        for key, svg_path, hide, frame_name in (
            ("left", left_svg, sorted(set(hide_edits) | set(LEFT_HIDE)), "box_left"),
            ("right", right_svg, sorted(set(hide_edits) | set(RIGHT_HIDE)), "box_right"),
            ("status", status_svg, hide_edits, "status"),
        ):
            with open(svg_path, encoding="utf-8") as fh:
                svg = U.fix_glyph_text(fh.read())
            tx, ty = R.stage_origin(svg)
            w, h = svg_size(svg)
            file = f"panels/{frame_name}.png"
            R.render(pg, svg, os.path.join(OUT_PNG, f"{frame_name}.png"),
                     rect=(0, 0, w / 2, h / 2),
                     hide_cids=[str(c) for c in hide])
            fr = names["box_left" if key == "left" else
                       "box_right" if key == "right" else "mc_status"]
            out["box"][key] = {
                "file": file, "w": round(w, 2), "h": round(h, 2),
                "ox": round(tx * 2, 2), "oy": round(ty * 2, 2),
                "place": {"x": fr["x"], "y": fr["y"]},
            }
            print(f"  {frame_name}: {file} {round(w, 1)}x{round(h, 1)}")

        col_dir = S.sprite_dir(COL_CID)
        for i in range(1, 7):
            path = os.path.join(col_dir, f"{i}.svg")
            with open(path, encoding="utf-8") as fh:
                svg = fh.read()
            tx, ty = R.stage_origin(svg)
            w, h = svg_size(svg)
            file = f"panels/col_{i}.png"
            R.render(pg, svg, os.path.join(OUT_PNG, f"col_{i}.png"),
                     rect=(0, 0, w / 2, h / 2), hide_cids=["2087"])
            out["cols"][str(i)] = {
                "file": file, "w": round(w, 2), "h": round(h, 2),
                "ox": round(tx * 2, 2), "oy": round(ty * 2, 2),
                "m": [round(v, 4) for v in left[f"col{i}"][1]],
            }

        sel_svg = sprite_svg(SEL_CID)
        with open(sel_svg, encoding="utf-8") as fh:
            svg = fh.read()
        tx, ty = R.stage_origin(svg)
        w, h = svg_size(svg)
        R.render(pg, svg, os.path.join(PICKER_PNG, "sel.png"),
                 rect=(0, 0, w / 2, h / 2))
        out["sel"] = {"file": "picker/sel.png", "w": round(w, 2),
                      "h": round(h, 2), "ox": round(tx * 2, 2),
                      "oy": round(ty * 2, 2)}

        done = {}
        out["button"] = {"cid": DISMISS_CID, **U.bake_button(pg, DISMISS_CID, done)}
        out["button"]["m"] = [round(v, 4) for v in right["bt_dismiss"][1]]
        for state, file in list(out["button"]["states"].items()):
            import shutil
            src = os.path.join(REPO, "public", "ui", file)
            dst = f"btn_{DISMISS_CID}_{state}.png"
            shutil.copyfile(src, os.path.join(OUT_PNG, dst))
            out["button"]["states"][state] = f"panels/{dst}"

        b.close()

    left_cids = {}
    for u in frame_uses(left_svg):
        name = u.get("id") or ""
        cid = u.get(FF + "characterId")
        if name and cid and name not in left_cids:
            left_cids[name] = int(cid)

    for name in FIELDS_LEFT:
        cid = left_cids.get(name)
        if cid and cid in edits:
            out["fields"][name] = {
                "m": [round(v, 4) for v in left[name][1]], "cid": cid,
                "spec": edits[cid],
            }
    for name in BARS_LEFT + ["mc_class", "newskill"]:
        out["items"][name] = [round(v, 4) for v in left[name][1]]
    for name in ITEMS_LEFT:
        out["items"][name] = [round(v, 4) for v in left[name][1]]
    for name in ITEMS_RIGHT:
        out["items"][name] = [round(v, 4) for v in right[name][1]]

    st = status["txt_status"]
    out["statusField"] = {"m": [round(v, 4) for v in st[1]], "cid": st[0],
                          "spec": edits.get(st[0]) if st[0] else None}

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT_JSON)
    print("images in", OUT_PNG)


if __name__ == "__main__":
    main()
