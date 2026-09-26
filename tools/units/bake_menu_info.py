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

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_PNG = os.path.join(REPO, "public", "assets", "menu-parts", "info")
OUT_JSON = os.path.join(REPO, "src", "assets", "menuInfo.json")
INFO_CID = 2777
BAR_CID = 2080

FIELDS = {
    "txt_name": 2766, "txt_primary": 2767, "txt_secondary": 2768,
    "txt_lvl": 2769, "txt_status": 2770, "txt_bonus": 2771,
}

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


def named_positions(path: str):
    tree = ET.parse(path)
    root = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    found = {}

    def walk(el, m):
        for c in el:
            cm = mat_mul(parse_matrix(c.get("transform")), m)
            name = c.get("id") or ""
            if name in FIELDS and name not in found:
                found[name] = cm
            if name == "bar" and "bar" not in found:
                found["bar"] = cm
            walk(c, cm)

    walk(root, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    return found


def main():
    os.makedirs(OUT_PNG, exist_ok=True)
    sprite = os.path.join(S.SPRITES, f"DefineSprite_{INFO_CID}")
    edit_specs = T.parse()
    hide = sorted(set(edit_specs) | {BAR_CID})

    rig = {}
    for f in (1, 2, 3, 4):
        path = os.path.join(sprite, f"{f}.svg")
        svg = open(path, encoding="utf-8").read()
        tx, ty = R.stage_origin(svg)
        m = re.search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
        w, h = float(m.group(2)), float(m.group(1))
        pos = named_positions(path)
        rec = {
            "file": f"info/{f}.png",
            "w": round(w * 2, 2), "h": round(h * 2, 2),
            "ox": round(tx * 2, 2), "oy": round(ty * 2, 2),
            "fields": {
                k: {"x": round(v[4], 2), "y": round(v[5], 2),
                    "sx": round(v[0], 4), "sy": round(v[3], 4),
                    **({"cid": FIELDS[k], "spec": edit_specs[FIELDS[k]]}
                       if k in FIELDS and FIELDS[k] in edit_specs else {})}
                for k, v in pos.items()
            },
        }
        rig[str(f)] = rec
        print(f"  info {f}: {sorted(pos)}")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        for f in (1, 2, 3, 4):
            path = os.path.join(sprite, f"{f}.svg")
            svg = open(path, encoding="utf-8").read()
            rec = rig[str(f)]
            R.render(pg, svg, os.path.join(OUT_PNG, f"{f}.png"),
                     rect=(0, 0, rec["w"] / 2, rec["h"] / 2),
                     hide_cids=[str(c) for c in hide])
        b.close()

    bar_path = os.path.join(S.SPRITES, f"DefineSprite_{BAR_CID}", "1.svg")
    if os.path.isfile(bar_path):
        svg = open(bar_path, encoding="utf-8").read()
        tx, ty = R.stage_origin(svg)
        m = re.search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
        bw, bh = float(m.group(2)), float(m.group(1))
        with sync_playwright() as pw:
            b, pg = R.open_page(pw, supersample=1)
            R.render(pg, svg, os.path.join(OUT_PNG, "bar/1.png"),
                     rect=(0, 0, bw, bh))
            b.close()
        rig["bar"] = {"file": "info/bar/1.png", "w": round(bw * 2, 2),
                      "h": round(bh * 2, 2), "ox": round(tx * 2, 2),
                      "oy": round(ty * 2, 2)}

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, indent=1)
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
