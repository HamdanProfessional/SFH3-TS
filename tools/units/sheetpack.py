#!/usr/bin/env python3
from __future__ import annotations

import math
import os

from PIL import Image

MAX_SHEET = 4096
PAD = 2


def trimmed(im: Image.Image, ax: float, ay: float):
    im = im.convert("RGBA")
    x0, y0, x1, y1 = im.getchannel("A").getbbox() or (0, 0, 1, 1)
    bb = (max(0, x0 - 1), max(0, y0 - 1), min(im.width, x1 + 1), min(im.height, y1 + 1))
    return im.crop(bb), ax - bb[0], ay - bb[1]


def pack(items: list[dict], out_dir: str, prefix: str, max_side: int = MAX_SHEET):
    if not items:
        return [], {}
    order = sorted(items, key=lambda it: (-it["im"].height, -it["im"].width, it["key"]))
    widest = max(it["im"].width for it in order) + PAD
    area = sum((it["im"].width + PAD) * (it["im"].height + PAD) for it in order)
    width = min(max_side, max(widest, int(math.ceil(math.sqrt(area * 1.1)))))
    pages: list[list[tuple[dict, int, int]]] = [[]]
    heights = [0]
    x = y = shelf = 0
    for it in order:
        w, h = it["im"].width + PAD, it["im"].height + PAD
        if x + w > width:
            x, y, shelf = 0, y + shelf, 0
        if y + h > max_side:
            pages.append([])
            heights.append(0)
            x = y = shelf = 0
        pages[-1].append((it, x + PAD // 2, y + PAD // 2))
        x += w
        shelf = max(shelf, h)
        heights[-1] = max(heights[-1], y + shelf)
    sheets = []
    rects = {}
    for p, placed in enumerate(pages):
        used = max(px + it["im"].width + PAD // 2 for it, px, _py in placed)
        sheet = Image.new("RGBA", (used, heights[p]), (0, 0, 0, 0))
        for it, px, py in placed:
            sheet.paste(it["im"], (px, py))
            rects[it["key"]] = [p, px, py, it["im"].width, it["im"].height,
                                round(it["ax"], 2), round(it["ay"], 2)]
        rel = f"{prefix}_{p}.png"
        sheet.save(os.path.join(out_dir, rel))
        sheets.append({"file": rel, "w": sheet.width, "h": sheet.height})
    return sheets, rects
