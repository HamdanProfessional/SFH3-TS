#!/usr/bin/env python3
from __future__ import annotations

import os
import re

CHILDREN = {"clip": 620, "part": 659}


def cid_of(tag: str):
    m = re.search(r'characterId="(\d+)"', tag or "")
    return int(m.group(1)) if m else None


def _prefix_ids(text: str, prefix: str) -> str:
    text = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}"', text)
    text = re.sub(r'\b(xlink:href|href)="#([^"]+)"',
                  lambda m: f'{m.group(1)}="#{prefix}{m.group(2)}"', text)
    text = re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{prefix}{m.group(1)})', text)
    return text


def _strip_root_g(text: str) -> str:
    m = re.search(r'<g transform="matrix\(0\.5, 0\.0, 0\.0, 0\.5,', text)
    if not m:
        return text
    depth = 0
    i = text.index(">", m.start()) + 1
    while True:
        nxt_open = text.find("<g", i)
        nxt_close = text.find("</g>", i)
        if nxt_close == -1:
            return text
        if nxt_open != -1 and nxt_open < nxt_close:
            tag_end = text.find(">", nxt_open)
            if tag_end != -1 and text[tag_end - 1] == "/":
                i = tag_end + 1
                continue
            depth += 1
            i = nxt_open + 2
        elif depth == 0:
            return text[:m.start()] + text[i:nxt_close] + text[nxt_close + 4:]
        else:
            depth -= 1
            i = nxt_close + 4


def inline_frame(gun_dir: str, frame: int, children=CHILDREN) -> str:
    svg = open(os.path.join(gun_dir, f"{frame}.svg"), encoding="utf-8").read()
    out = svg
    for m in re.finditer(r"<use\b[^>]*>", svg):
        tag = m.group(0)
        cid = cid_of(tag)
        if cid not in children.values():
            continue
        child_path = os.path.join(os.path.dirname(gun_dir), f"DefineSprite_{cid}",
                                  f"{frame}.svg")
        if not os.path.isfile(child_path):
            continue
        child = open(child_path, encoding="utf-8").read()
        i = child.index(">", child.index("<svg")) + 1
        j = child.rindex("</svg>")
        inner = _prefix_ids(_strip_root_g(child[i:j]), f"c{cid}_")
        mt = re.search(r'transform="([^"]+)"', tag)
        tr = f' transform="{mt.group(1)}"' if mt else ""
        out = out.replace(tag, f"<g{tr}>{inner}</g>")
    return out
