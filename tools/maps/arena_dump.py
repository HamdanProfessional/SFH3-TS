#!/usr/bin/env python3
from __future__ import annotations

import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import swfio as S

ARENA_CID = 3454
SHOW_FRAME = 1
PLACE2, PLACE3 = 26, 70
REMOVE1, REMOVE2 = 5, 28
FRAME_LABEL = 43
SYMBOL_CLASS = 76


def symbol_classes(buf):
    out = {}
    for code, p, ln in S.tags(buf, S.skip_rect(buf, 0) + 4, len(buf)):
        if code != SYMBOL_CLASS:
            continue
        (count,) = struct.unpack_from("<H", buf, p)
        q = p + 2
        for _ in range(count):
            (cid,) = struct.unpack_from("<H", buf, q)
            q += 2
            name, q = S.cstr(buf, q)
            out[cid] = name
    return out


def place_one(buf, p, code):
    flags = buf[p]
    p += 1
    flags2 = 0
    if code == PLACE3:
        flags2 = buf[p]
        p += 1
    (depth,) = struct.unpack_from("<H", buf, p)
    p += 2
    if flags2 & 0x08:
        _cn, p = S.cstr(buf, p)
    cid = None
    if flags & 0x02:
        cid = struct.unpack_from("<H", buf, p)[0]
        p += 2
    m = None
    if flags & 0x04:
        m, p = S.matrix6(buf, p)
    if flags & 0x08:
        _mult, _add, p = S.cxform_read(buf, p)
    if flags & 0x10:
        p += 2
    name = None
    if flags & 0x20:
        name, p = S.cstr(buf, p)
    return depth, cid, name, m


def arena_frames(buf):
    labels = {}
    state = {}
    frames = {}
    frame = 1
    for code, p, ln in S.tags(buf, S.skip_rect(buf, 0) + 4, len(buf)):
        if code != S.DEFINE_SPRITE:
            continue
        if struct.unpack_from("<H", buf, p)[0] != ARENA_CID:
            continue
        for c2, p2, l2 in S.tags(buf, p + 4, p + ln):
            if c2 == SHOW_FRAME:
                frames[frame] = dict(state)
                frame += 1
            elif c2 == FRAME_LABEL:
                lbl, _ = S.cstr(buf, p2)
                labels[frame] = lbl
            elif c2 in (PLACE2, PLACE3):
                try:
                    depth, cid, name, m = place_one(buf, p2, c2)
                except Exception:
                    continue
                old = state.get(depth)
                if cid is None and old:
                    cid = old[0]
                    name = name if name is not None else old[1]
                    m = m if m is not None else old[2]
                state[depth] = (cid, name, m)
            elif c2 == REMOVE1:
                state.pop(struct.unpack_from("<HH", buf, p2)[1], None)
            elif c2 == REMOVE2:
                state.pop(struct.unpack_from("<H", buf, p2)[0], None)
        break
    return labels, frames


def main():
    buf = S.body()
    classes = symbol_classes(buf)
    labels, frames = arena_frames(buf)
    want = None
    if "--frame" in sys.argv:
        want = int(sys.argv[sys.argv.index("--frame") + 1])
    for frame in sorted(frames):
        if want and frame != want:
            continue
        print(f"\n=== frame {frame}  label={labels.get(frame, '(none)')!r} ===")
        for depth in sorted(frames[frame]):
            cid, name, m = frames[frame][depth]
            cls = classes.get(cid, "")
            if m is None:
                mm = "no matrix"
            else:
                tx, ty, a, d, b, c = m
                mm = f"t=({tx:8.1f},{ty:8.1f}) s=({a:.3f},{d:.3f}) r=({b:.3f},{c:.3f})"
            print(f"  d{depth:<4} cid={cid:<5} {cls:24} name={name or '':14} {mm}")


if __name__ == "__main__":
    main()
