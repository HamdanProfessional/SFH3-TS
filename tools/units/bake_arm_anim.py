#!/usr/bin/env python3
from __future__ import annotations

import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))

import swfio as S
import swflabels as L

REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "src", "assets", "armAnim.json")

ARMS = {
    "arm1": (1965, "arm1_453.as"),
    "arm2": (928, "arm2_443.as"),
}

SVG = "{http://www.w3.org/2000/svg}"
XLINK = "{http://www.w3.org/1999/xlink}href"
FFDEC = "{https://www.free-decompiler.com/flash}"
NUM = r"[-0-9.eE]+"
MAT = re.compile(r"matrix\(([^)]*)\)")

MUZZLE_CIDS = {
    "848": "pistol", "853": "sniper", "910": "shotgun",
    "916": "rifle", "927": "mg", "1941": "cannon",
}

SCRIPTS = re.compile(r"MovieClip\(parent\)\.(\w+)\(")


def sprite_dir(cid: int) -> str:
    return glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}*"))[0]


def frame_count(cid: int) -> int:
    return len(glob.glob(os.path.join(sprite_dir(cid), "*.svg")))


def matrix_of(tag: str | None):
    m = MAT.search(tag or "")
    if not m:
        return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return [round(float(x), 4) for x in re.findall(NUM, m.group(1))]


def parse_frames(cid: int):
    d = sprite_dir(cid)
    out = []
    for f in range(1, frame_count(cid) + 1):
        path = os.path.join(d, f"{f}.svg")
        if not os.path.isfile(path):
            out.append([])
            continue
        root = ET.parse(path).getroot()
        g = next(c for c in root
                 if c.tag == SVG + "g" and "0.5" in (c.get("transform") or ""))
        row = []
        for el in g:
            if el.tag != SVG + "use":
                continue
            name = el.get("id") or ""
            if not name:
                weapon = MUZZLE_CIDS.get(el.get(FFDEC + "characterId") or "")
                if weapon:
                    name = f"muzzle:{weapon}"
            row.append([name, *matrix_of(el.get("transform"))])
        out.append(row)
    return out


def parse_labels(cid: int):
    starts = L.parse(L.SWF, cid)
    total = frame_count(cid)
    out = {}
    for i, (frame, label) in enumerate(starts):
        end = starts[i + 1][0] - 1 if i + 1 < len(starts) else total
        out[label] = [frame, end]
    return out


def parse_scripts(class_file: str):
    path = os.path.join(S.SPRITES, "..", "scripts",
                        "MBFZ3_Mar23MERGED__fla", class_file)
    src = open(path, encoding="utf-8", errors="replace").read()

    m = re.search(r"addFrameScript\((.*?)\);", src, re.S)
    if not m:
        return {}
    pairs = re.findall(r"(\d+)\s*,\s*this\.frame(\d+)", m.group(1))
    frame_of_fn = {f"frame{fn}": int(idx) + 1 for idx, fn in pairs}

    out = {}
    for fm in re.finditer(
            r"internal function (frame\d+)\(\)[^{]*\{(.*?)\n      \}", src, re.S):
        fn, body = fm.group(1), fm.group(2)
        frame = frame_of_fn.get(fn)
        if frame is None:
            continue
        calls = []
        if re.search(r"\bstop\(\)", body):
            calls.append("stop")
        for call in SCRIPTS.findall(body):
            arg = re.search(rf"{call}\((this\.\w+|true|false)\)", body)
            calls.append(f"{call}:{arg.group(1)}" if arg else call)
        out[str(frame)] = calls
    return out


def main():
    rig = {}
    for name, (cid, cls) in ARMS.items():
        frames = parse_frames(cid)
        labels = parse_labels(cid)
        scripts = parse_scripts(cls)
        rig[name] = {"total": len(frames), "labels": labels,
                     "scripts": scripts, "frames": frames}
        print(f"{name}: {len(frames)} frames, {len(labels)} labels, "
              f"{len(scripts)} scripted frames")
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, separators=(",", ":"))
    print("wrote", OUT, f"({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
