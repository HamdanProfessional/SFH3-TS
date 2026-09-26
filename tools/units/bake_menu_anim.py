#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
sys.path.insert(0, os.path.dirname(SC))
import swflabels as L

UNIT_CID = 2090
AS = os.path.normpath(os.path.join(
    REPO, "..", "sfh3_decompiled", "scripts", "MBFZ3_Mar23MERGED__fla",
    "UNIT_new_305.as"))
OUT = os.path.join(REPO, "src", "assets", "menuAnim.json")

FRAME_FN = re.compile(r"internal function frame(\d+)\s*\(\)\s*:\s*\*")
GOTO = re.compile(r'gotoAndPlay\("([^"]+)"\)')


def main():
    src = open(AS, encoding="utf-8").read()
    scripts: dict[str, str] = {}
    for m in FRAME_FN.finditer(src):
        n = int(m.group(1))
        body = src[m.end():m.end() + 400]
        g = GOTO.search(body)
        if g:
            scripts[str(n)] = g.group(1)

    labels = {name: frame for frame, name in L.parse(L.SWF, UNIT_CID)}
    total = 525
    out = {
        "note": ("The menu unit's scripted playhead. `scripts[frame]` is the "
                 "label that frame's `gotoAndPlay` jumps to, so each animation "
                 "segment loops instead of the timeline running through all of "
                 "them. `labels` are the SWF's own frame labels."),
        "total": total,
        "labels": labels,
        "scripts": scripts,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"wrote {OUT}: {len(scripts)} scripts, {len(labels)} labels, "
          f"total {total}")
    for k in sorted(scripts, key=int):
        print(f"  frame {k:>3} -> {scripts[k]}")


if __name__ == "__main__":
    main()
