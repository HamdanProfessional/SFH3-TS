#!/usr/bin/env python3
import os
import re
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import swfio as S

SWF = S.SWF
BH_AS = os.path.join(S.SCRIPTS, "BH.as")
SYMBOLS = os.path.join(S.DECOMP, "symbolClass", "symbols.csv")


def bh_cid():
    for line in open(SYMBOLS, encoding="utf-8", errors="replace"):
        m = re.match(r'\s*(\d+)\s*;\s*"([^"]+)"', line)
        if m and m.group(2) == "BH":
            return int(m.group(1))
    raise SystemExit(f"no symbolClass row binding class BH in {SYMBOLS}")


FILTER_LEN = {0: 23, 1: 9, 2: 15, 3: 27, 6: 80}


def filters(buf, p):
    n = buf[p]
    p += 1
    out = []
    for _ in range(n):
        fid = buf[p]
        p += 1
        if fid in FILTER_LEN:
            ln = FILTER_LEN[fid]
        elif fid in (4, 7):
            nc = buf[p]
            ln = 1 + nc * 5 + 19
        elif fid == 5:
            ln = 2 + 8 + buf[p] * buf[p + 1] * 4 + 5
        else:
            raise ValueError(f"unknown filter id {fid}")
        out.append((fid, buf[p : p + ln]))
        p += ln
    return out, p


def color_matrix(payload):
    return list(struct.unpack_from("<20f", payload, 0))


REMOVE, REMOVE2 = 5, 28


def place_tag(buf, p, code):
    flags = buf[p]
    p += 1
    flags2 = 0
    if code == S.PLACE3:
        flags2 = buf[p]
        p += 1
    p += 2
    depth = struct.unpack_from("<H", buf, p - 2)[0]
    if code == S.PLACE3 and flags2 & 0x08:
        _cn, p = S.cstr(buf, p)
    out = {"depth": depth}
    if flags & 0x02:
        out["cid"] = struct.unpack_from("<H", buf, p)[0]
        p += 2
    if flags & 0x04:
        out["m"], p = S.matrix6(buf, p)
    if flags & 0x08:
        mult, add, p = S.cxform_read(buf, p)
        out["cx"] = (mult, add)
    if flags & 0x10:
        p += 2
    if flags & 0x20:
        out["name"], p = S.cstr(buf, p)
    if flags & 0x40:
        p += 2
    if flags2 & 0x01:
        out["fl"], p = filters(buf, p)
    return out


def timeline(buf, span):
    start, end = span
    state = {}
    mc_depth = None
    frame, label, out = 1, None, []
    for code, p, ln in S.tags(buf, start, end):
        if code == S.FRAME_LABEL:
            label = S.cstr(buf, p)[0]
        elif code in (S.PLACE2, S.PLACE3):
            t = place_tag(buf, p, code)
            d = t["depth"]
            if t.get("name") == "MC":
                mc_depth = d
            if "cid" in t:
                state[d] = {
                    "cid": t["cid"],
                    "m": t.get("m"),
                    "cx": t.get("cx"),
                    "fl": t.get("fl") or [],
                }
            elif d in state:
                for k in ("m", "cx", "fl"):
                    if k in t:
                        state[d][k] = t[k]
        elif code in (REMOVE, REMOVE2):
            d = struct.unpack_from("<H", buf, p + (2 if code == REMOVE else 0))[0]
            state.pop(d, None)
        elif code == S.SHOW_FRAME:
            s = state.get(mc_depth) if mc_depth is not None else None
            out.append(
                (frame, label, (s["cid"], s["m"], s["cx"], s["fl"]) if s else None)
            )
            frame, label = frame + 1, None
    return out


def subanims(buf, span):
    start, end = span
    subs, cur, frames = [], None, 0
    for code, p, ln in S.tags(buf, start, end):
        if code == S.FRAME_LABEL:
            lbl = S.cstr(buf, p)[0]
            if lbl != cur:
                if cur is not None or frames:
                    subs.append((cur, frames))
                cur, frames = lbl, 0
        elif code == S.SHOW_FRAME:
            frames += 1
    if cur is not None or frames:
        subs.append((cur, frames))
    return subs


def rotate_table(path=BH_AS):
    src = open(path, encoding="utf-8", errors="replace").read()
    return {
        int(m.group(1)): int(m.group(2))
        for m in re.finditer(
            r"function frame(\d+)\(\)\s*:\s*\*\s*\{\s*(?:this\.)?rotate\s*=\s*(-?\d+)", src
        )
    }


def rot_amt(rotate):
    return max(1, rotate - 1 if rotate > 0 else rotate)


def main():
    cid_only = "--cid" in sys.argv
    buf = S.body(SWF)
    cid = bh_cid()
    if cid_only:
        print(cid)
        return
    sp = S.sprites(buf)
    if cid not in sp:
        raise SystemExit(f"DefineSprite_{cid} (class BH) not found in {SWF}")
    rot = rotate_table()
    print(f"BH = DefineSprite_{cid}   frame scripts with `rotate`: {len(rot)}")
    print(f"{'fr':>3}  {'label':<18} {'cid':>5} {'rot':>4} {'bake':>4}  subs")
    total = dead = 0
    for frame, label, place in timeline(buf, sp[cid]):
        ccid, m, cx, fl = place if place else (None, None, None, [])
        r = rot.get(frame, 0)
        n = rot_amt(r)
        subs = subanims(buf, sp[ccid]) if ccid in sp else []
        nframes = sum(f for _, f in subs) or 1
        total += n * nframes
        dead += nframes if r > 0 else 0
        desc = ", ".join(f"{s or '-'}x{f}" for s, f in subs) or "(leaf shape)"
        xf = ""
        if m and (abs(m[2] - 1) > 1e-3 or abs(m[3] - 1) > 1e-3):
            xf += f" scale={m[2]:.2f},{m[3]:.2f}"
        if cx:
            mult, add = cx
            xf += f" cx=m{[round(v, 2) for v in mult]}+a{add}"
        for fid, payload in fl:
            xf += f" cmat={[round(v, 2) for v in color_matrix(payload)]}" if fid == 6 else f" filter{fid}"
        print(f"{frame:3d}  {label or '?':<18} {str(ccid):>5} {r:>4} {n:>4}  {desc}{xf}")
    print(f"\n{total} reachable bitmaps; the original also bakes {dead} "
          f"unreachable 360-degree duplicates ({total + dead} in BitAr)")


if __name__ == "__main__":
    main()
