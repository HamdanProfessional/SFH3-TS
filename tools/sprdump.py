#!/usr/bin/env python3
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.normpath(os.path.join(HERE, "..", "..", "sfh3_decompiled", "sprites"))

SVG = "{http://www.w3.org/2000/svg}"
FF = "{https://www.free-decompiler.com/flash}"
XL = "{http://www.w3.org/1999/xlink}"

MAT = re.compile(r"matrix\(\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),"
                 r"\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\)")

SKIP = (SVG + "defs", SVG + "clipPath", SVG + "mask", SVG + "filter",
        SVG + "metadata", SVG + "style", SVG + "linearGradient")


def defs_map(root):
    out = {}
    for g in root.iter():
        if g.get("id") and g.tag in (SVG + "g", SVG + "symbol"):
            out[g.get("id")] = g
    return out


def print_use(use, clip, prefix, depth):
    name = use.get("id") or ""
    cid = use.get(FF + "characterId")
    m = MAT.search(use.get("transform") or "")
    nums = [float(g) for g in m.groups()] if m else [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    sx, sy, tx, ty = nums[0], nums[3], nums[4], nums[5]
    w = use.get("width") or "?"
    h = use.get("height") or "?"
    print(f"{'  ' * depth}{name!r:22} cid={cid:>6} xy=({tx:g},{ty:g}) "
          f"s=({sx:g},{sy:g}) {w}x{h}{' clip' if clip else ''}")


def walk(el, defs, prefix, depth, seen):
    for child in el:
        if child.tag in SKIP:
            continue
        if child.tag == SVG + "use":
            print_use(child, el.get("clip-path") is not None, prefix, depth)
        elif child.tag == SVG + "g":
            href = None
            walk(child, defs, prefix, depth, seen)
        else:
            walk(child, defs, prefix, depth, seen)


def main():
    which = sys.argv[1]
    frames = sys.argv[2:] or ["1"]
    d = None
    for cand in os.listdir(SPRITES):
        if cand.startswith(which):
            d = os.path.join(SPRITES, cand)
            break
    if not d:
        raise SystemExit(f"no sprite {which}")
    for fr in frames:
        path = os.path.join(d, f"{fr}.svg")
        print(f"===== {os.path.basename(d)} frame {fr}")
        root = ET.parse(path).getroot()
        defs = defs_map(root)
        walk(root, defs, "", 0, set())


if __name__ == "__main__":
    main()
