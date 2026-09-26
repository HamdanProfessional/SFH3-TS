#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swflabels as L
import uibake as U

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_PNG = os.path.join(REPO, "public", "assets", "menu-parts", "picker")
OUT_JSON = os.path.join(REPO, "src", "assets", "menuPicker.json")
FRAMES_JSON = os.path.join(REPO, "src", "assets", "menuFrames.json")

CARD_CID = 2076
CONT_CID = 2473
ICON_CID = 2034
SELECTED_CID = 2069
NEWSKILL_CID = 2071
HEAD_CID = 1923
BTN_CID = 2064

SUPERSAMPLE = 2

CARD_HIDE = [1923, 2034, 2064, 2069, 2071, 2062]

CLASS_IDS = ["sni", "med", "eng", "mer", "jug", "gun", "eli", "nin", "spe", "akq"]

NUM = r"[-0-9.eE]+"
MAT = re.compile(r"matrix\(([^)]*)\)")


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


def named_positions(svg_path: str):
    import xml.etree.ElementTree as ET
    tree = ET.parse(svg_path)
    root = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    found = {}

    def walk(el, m):
        for c in el:
            cm = mat_mul(parse_matrix(c.get("transform")), m)
            name = c.get("id") or ""
            if name and name not in found:
                found[name] = cm
            walk(c, cm)

    walk(root, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    return found


def sprite_svg(cid, frame):
    d = S.sprite_dir(cid)
    return os.path.join(d, f"{frame}.svg")


def main():
    os.makedirs(OUT_PNG, exist_ok=True)

    out = {
        "scale": SUPERSAMPLE,
        "card": {},
        "tray": {},
        "class": {},
        "selected": None,
        "newskill": None,
        "button": None,
        "head": None,
        "icon": None,
        "deck": {},
    }

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SUPERSAMPLE)

        card_svg = {}
        for f in (1, 2, 3, 4, 5):
            path = sprite_svg(CARD_CID, f)
            with open(path, encoding="utf-8") as fh:
                svg = fh.read()
            card_svg[f] = svg
            tx, ty = R.stage_origin(svg)
            m = re.search(r'height="([\d.]+)px" width="([\d.]+)px"', svg)
            w, h = float(m.group(2)), float(m.group(1))
            file = f"picker/card_{f}.png"
            R.render(pg, svg, os.path.join(OUT_PNG, os.path.basename(file)),
                     rect=(0, 0, w, h),
                     hide_cids=[str(c) for c in CARD_HIDE])
            out["card"][str(f)] = {
                "file": file, "w": round(w * 2, 2), "h": round(h * 2, 2),
                "ox": round(tx * 2, 2), "oy": round(ty * 2, 2),
            }
            print(f"  card {f}: {file} {round(w * 2, 1)}x{round(h * 2, 1)}")

        pos = named_positions(sprite_svg(CARD_CID, 1))
        out["head"] = [round(v, 4) for v in pos["head"]]
        out["icon"] = [round(v, 4) for v in pos["mc_class"]]

        for name, cid in (("selected", SELECTED_CID), ("newskill", NEWSKILL_CID)):
            path = sprite_svg(cid, 1)
            with open(path, encoding="utf-8") as fh:
                svg = fh.read()
            tx, ty = R.stage_origin(svg)
            m = re.search(r'height="([\d.]+)px" width="([\d.]+)px"', svg)
            w, h = float(m.group(2)), float(m.group(1))
            file = f"picker/{name}.png"
            R.render(pg, svg, os.path.join(OUT_PNG, os.path.basename(file)),
                     rect=(0, 0, w, h))
            out[name] = {
                "file": file, "w": round(w * 2, 2), "h": round(h * 2, 2),
                "ox": round(tx * 2, 2), "oy": round(ty * 2, 2),
                "m": [round(v, 4) for v in pos[name]],
            }

        cont_dir = S.sprite_dir(CONT_CID)
        for f in (1, 2):
            path = os.path.join(cont_dir, f"{f}.svg")
            with open(path, encoding="utf-8") as fh:
                svg = fh.read()
            tx, ty = R.stage_origin(svg)
            m = re.search(r'height="([\d.]+)px" width="([\d.]+)px"', svg)
            w, h = float(m.group(2)), float(m.group(1))
            file = f"picker/tray_{f}.png"
            R.render(pg, svg, os.path.join(OUT_PNG, f"tray_{f}.png"),
                     rect=(0, 0, w, h), hide_cids=["2076"])
            out["tray"][str(f)] = {
                "file": file, "w": round(w * 2, 2), "h": round(h * 2, 2),
                "ox": round(tx * 2, 2), "oy": round(ty * 2, 2),
            }
            print(f"  tray {f}: {file} {round(w * 2, 1)}x{round(h * 2, 1)}")

        labels = {label: frame for frame, label in L.parse(L.SWF, ICON_CID)}
        for cid in CLASS_IDS:
            f = labels.get(cid)
            if not f:
                print(f"  !! class {cid}: no label in sprite {ICON_CID}")
                continue
            path = sprite_svg(ICON_CID, f)
            with open(path, encoding="utf-8") as fh:
                svg = fh.read()
            tx, ty = R.stage_origin(svg)
            m = re.search(r'height="([\d.]+)px" width="([\d.]+)px"', svg)
            w, h = float(m.group(2)), float(m.group(1))
            file = f"picker/class_{cid}.png"
            R.render(pg, svg, os.path.join(OUT_PNG, os.path.basename(file)),
                     rect=(0, 0, w, h))
            out["class"][cid] = {
                "file": file, "w": round(w * 2, 2), "h": round(h * 2, 2),
                "ox": round(tx * 2, 2), "oy": round(ty * 2, 2), "frame": f,
            }

        done = {}
        out["button"] = {"cid": BTN_CID, **U.bake_button(pg, BTN_CID, done)}
        out["button"]["m"] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        for state, file in list(out["button"]["states"].items()):
            import shutil
            src = os.path.join(REPO, "public", "ui", file)
            dst = f"btn_{BTN_CID}_{state}.png"
            shutil.copyfile(src, os.path.join(OUT_PNG, dst))
            out["button"]["states"][state] = f"picker/{dst}"

        b.close()

    tray = named_positions(sprite_svg(CONT_CID, 1))
    xs = [tray[f"hero_{i + 1}"][4] for i in range(15)]
    ys = [tray[f"hero_{i + 1}"][5] for i in range(15)]
    step = round((xs[-1] - xs[0]) / 14, 4)
    with open(FRAMES_JSON, encoding="utf-8") as fh:
        frames = json.load(fh)
    place = {}
    for label in ("heroes", "deploy"):
        it = next(i for i in frames[label]["items"] if i["name"] == "heroCont")
        place[label] = {"x": it["x"], "y": it["y"]}
    out["deck"] = {
        "firstX": round(xs[0], 4), "firstY": round(ys[0], 4),
        "step": step, "count": 15,
        "place": place,
        "openY": 515,
        "homeY": {"heroes": 572, "deploy": 605},
    }

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT_JSON)
    print("images in", OUT_PNG)


if __name__ == "__main__":
    main()
