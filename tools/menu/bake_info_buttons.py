#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import swfio as S
import uibake as U

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_JSON = os.path.join(REPO, "src", "assets", "menuInfoButtons.json")

INFO_CID = 2777
BTN_CID = 2338

NUM = r"[-0-9.eE]+"
MAT = re.compile(r"matrix\(([^)]*)\)")
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


def named_uses(frame: int):
    path = os.path.join(S.sprite_dir(INFO_CID), f"{frame}.svg")
    tree = ET.parse(path)
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


def main():
    out = {"cid": BTN_CID, "states": {}, "place": {}, "offX": 0, "offY": 0,
           "w": 0, "h": 0}

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = _open(pw)
        done = {}
        entry = U.bake_button(pg, BTN_CID, done)
        b.close()
    out.update(entry)

    info_png = os.path.join(REPO, "public", "assets", "menu-parts", "info")
    os.makedirs(info_png, exist_ok=True)
    for state, file in list(out["states"].items()):
        import shutil
        shutil.copyfile(os.path.join(REPO, "public", "ui", file),
                        os.path.join(info_png, file))
        out["states"][state] = f"info/{file}"

    for frame in (1, 2, 3, 4):
        uses = named_uses(frame)
        place = {}
        for name in ("bt_change", "bt_remove"):
            if name in uses:
                cid, m = uses[name]
                place[name] = {"cid": cid, "m": [round(v, 4) for v in m]}
        out["place"][str(frame)] = place
        print(f"  info {frame}: {sorted(place)}")

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT_JSON)


def _open(pw):
    import svgraster as R
    return R.open_page(pw, supersample=U.SUPERSAMPLE)


if __name__ == "__main__":
    main()
