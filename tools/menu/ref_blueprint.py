#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from playwright.sync_api import sync_playwright

import svgraster as R
import swfio as S
import swflabels as L

ITEMCONTAINER = 2345
GETITEM = 2408
OUT = os.environ.get("REF_OUT", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "ref"))


def labels(cid):
    frame = {}
    for f, name in L.parse(L.SWF, cid):
        frame.setdefault(name, f)
    return frame


def shoot(pg, cid, frame, out):
    paths = S.frame_svgs(cid)
    if frame > len(paths):
        print(f"  no frame {frame} for {cid}")
        return
    svg = open(paths[frame - 1], encoding="utf-8").read()
    w, h, ox, oy = S.header(svg)
    R.render(pg, svg, out, rect=(0, 0, w, h))
    print(f"  {os.path.basename(out)}: {w}x{h} reg {ox},{oy}")


def main():
    os.makedirs(OUT, exist_ok=True)
    cont = labels(ITEMCONTAINER)
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=2)
        print("ItemContainer blueprint states")
        for name in ("blueprint", "blueprint1", "blueprint2", "blueprint3"):
            f = cont.get(name)
            if not f:
                print("  no label", name)
                continue
            shoot(pg, ITEMCONTAINER, f, os.path.join(OUT, f"bp_{name}.png"))
        print("GetItem build confirm (frame 122)")
        shoot(pg, GETITEM, 122, os.path.join(OUT, "gi_build_ref.png"))
        b.close()


if __name__ == "__main__":
    main()
