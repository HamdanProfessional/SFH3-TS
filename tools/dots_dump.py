#!/usr/bin/env python3
import json
import struct
import sys

sys.path.insert(0, __file__.rsplit("dots_dump.py", 1)[0])
from swfio import (
    Bits, cxform_read, skip_rect,
    DEFINE_SPRITE, PLACE2, PLACE3, body, cstr, matrix6, sprites, tags,
)

MISSION_DOT = 2167
CHALLENGE_DOT = 2163


def placements(buf, start, end):
    out = []
    for code, p, ln in tags(buf, start, end):
        if code not in (PLACE2, PLACE3):
            continue
        flags = buf[p]
        pos = p + 1
        if code == PLACE3:
            flags2 = buf[pos]
            pos += 1
        else:
            flags2 = 0
        depth = struct.unpack_from("<H", buf, pos)[0]
        pos += 2
        has_char, has_matrix = flags & 0x02, flags & 0x04
        has_cxform, has_ratio = flags & 0x08, flags & 0x10
        has_name = flags & 0x20
        if code == PLACE3 and flags2 & 0x01:
            _, pos = cstr(buf, pos)
        cid = None
        if has_char:
            cid = struct.unpack_from("<H", buf, pos)[0]
            pos += 2
        tx = ty = 0.0
        if has_matrix:
            (tx, ty, _a, _d, _b, _c), pos = matrix6(buf, pos)
        if has_cxform:
            from swfio import cxform_read
            _m, _a2, pos = cxform_read(buf, pos)
        if has_ratio:
            pos += 2
        name = None
        if has_name:
            name, pos = cstr(buf, pos)
        if cid in (MISSION_DOT, CHALLENGE_DOT):
            out.append((depth, cid, name, round(tx, 2), round(ty, 2)))
    out.sort()
    return out


def shape_bounds(buf, want):
    pos = skip_rect(buf, 0) + 4
    for code, p, _ln in tags(buf, pos, len(buf)):
        if code in (2, 22, 32, 83) and struct.unpack_from("<H", buf, p)[0] == want:
            r = Bits(buf, p + 2)
            nb = r.read(5)
            r.read(nb, True)
            return r.read(nb, True) / 20.0
    return None


def size_box(buf, cont_body):
    start, end = cont_body
    for code, p, _ln in tags(buf, start, end):
        if code not in (PLACE2, PLACE3):
            continue
        flags = buf[p]
        pos = p + 1
        flags2 = 0
        if code == PLACE3:
            flags2 = buf[pos]
            pos += 1
        pos += 2
        if code == PLACE3 and flags2 & 0x01:
            _, pos = cstr(buf, pos)
        cid = None
        if flags & 0x02:
            cid = struct.unpack_from("<H", buf, pos)[0]
            pos += 2
        mat = (0.0, 0.0, 1.0, 1.0, 0.0, 0.0)
        if flags & 0x04:
            mat, pos = matrix6(buf, pos)
        if flags & 0x08:
            _m, _a, pos = cxform_read(buf, pos)
        if flags & 0x10:
            pos += 2
        if flags & 0x20:
            name, pos = cstr(buf, pos)
            if name == "sizebox":
                inner = sprites(buf).get(cid)
                if inner is None:
                    return 0.0
                for c2, p2, _l2 in tags(buf, *inner):
                    if c2 in (PLACE2, PLACE3):
                        f = buf[p2]
                        q = p2 + 1 + (1 if c2 == PLACE3 else 0) + 2
                        if f & 0x02:
                            shape = struct.unpack_from("<H", buf, q)[0]
                            w = shape_bounds(buf, shape)
                            return (w or 0.0) * mat[2]
    return 0.0


def main():
    buf = body()
    best = None
    for cid, (s, e) in sprites(buf).items():
        found = placements(buf, s, e)
        if not found:
            continue
        n_m = sum(1 for f in found if f[1] == MISSION_DOT)
        n_c = sum(1 for f in found if f[1] == CHALLENGE_DOT)
        if best is None or n_m + n_c > best[1] + best[2]:
            best = (cid, n_m, n_c, found)

    if best is None:
        raise SystemExit("no sprite places MissionDot/ChallengeDot")

    cid, n_m, n_c, found = best
    print(f"cont = DefineSprite {cid}: {n_m} mission dots, {n_c} challenge dots",
          file=sys.stderr)

    missions = [[x, y] for _d, c, _n, x, y in found if c == MISSION_DOT]
    challenges = [{"name": n, "x": x, "y": y}
                  for _d, c, n, x, y in found if c == CHALLENGE_DOT]

    box = size_box(buf, sprites(buf)[cid])

    out = [
        "{",
        f'  "_source": "DefineSprite {cid} (Menu `cont`), '
        'strike-force-heroes-3.swf; regenerate with tools/dots_dump.py",',
        f'  "contentWidth": {round(box, 2)},',
        '  "missionDots": [',
    ]
    out += [f"    [{x}, {y}]{',' if i < len(missions) - 1 else ''}"
            for i, (x, y) in enumerate(missions)]
    out += ["  ],", '  "challengeDots": [']
    out += [f'    {json.dumps(c)}{"," if i < len(challenges) - 1 else ""}'
            for i, c in enumerate(challenges)]
    out += ["  ]", "}"]
    print("\n".join(out))


if __name__ == "__main__":
    main()
