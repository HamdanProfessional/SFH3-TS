#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from playwright.sync_api import sync_playwright

import svgraster as R
import swfio as S

OUT = os.environ.get("REF_OUT", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "ref"))


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=2)
        for cid, name in ((2447, "box_right"), (2470, "box_left"),
                          (2380, "itembox")):
            paths = S.frame_svgs(cid)
            for i, p in enumerate(paths, 1):
                svg = open(p, encoding="utf-8").read()
                w, h, ox, oy = S.header(svg)
                out = os.path.join(OUT, f"{name}_{i}.png")
                R.render(pg, svg, out, rect=(0, 0, w, h))
                print(f"{name} frame {i}: {w}x{h} reg {ox},{oy} -> {out}")
            if not paths:
                print("no export for", name)
        b.close()


if __name__ == "__main__":
    main()
