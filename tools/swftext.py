#!/usr/bin/env python3
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swfio as S

DEFINE_EDIT_TEXT = 37
FONTS = os.path.join(S.DECOMP, "fonts")
TEXTS = os.path.join(S.DECOMP, "texts")

ALIGN = ("left", "right", "center", "justify")


def font_names():
    out = {}
    if not os.path.isdir(FONTS):
        return out
    for fn in os.listdir(FONTS):
        m = re.match(r"(\d+)_(.+)\.ttf$", fn)
        if m:
            out[int(m.group(1))] = m.group(2)
    return out


def _rect(buf, pos):
    nbits = buf[pos] >> 3
    total = 5 + nbits * 4
    nbytes = (total + 7) // 8
    raw = int.from_bytes(buf[pos:pos + nbytes], "big")
    shift = nbytes * 8 - total
    raw >>= shift
    vals = []
    for i in range(4):
        v = (raw >> (nbits * (3 - i))) & ((1 << nbits) - 1)
        if nbits and v & (1 << (nbits - 1)):
            v -= 1 << nbits
        vals.append(v)
    return vals, pos + nbytes


def parse(buf=None):
    buf = buf if buf is not None else S.body()
    fonts = font_names()
    out = {}

    p0 = S.skip_rect(buf, 8) + 4
    for code, p, ln in S.tags(buf, p0, len(buf)):
        if code != DEFINE_EDIT_TEXT:
            continue
        cid = struct.unpack_from("<H", buf, p)[0]
        q = p + 2
        (xmin, xmax, ymin, ymax), q = _rect(buf, q)

        f1, f2 = buf[q], buf[q + 1]
        q += 2
        has_text = bool(f1 & 0x80)
        word_wrap = bool(f1 & 0x40)
        multiline = bool(f1 & 0x20)
        has_color = bool(f1 & 0x04)
        has_maxlen = bool(f1 & 0x02)
        has_font = bool(f1 & 0x01)
        has_fontclass = bool(f2 & 0x80)
        autosize = bool(f2 & 0x40)
        has_layout = bool(f2 & 0x20)
        html = bool(f2 & 0x02)

        rec = {
            "cid": cid,
            "x": xmin / 20, "y": ymin / 20,
            "w": (xmax - xmin) / 20, "h": (ymax - ymin) / 20,
            "wordWrap": word_wrap, "multiline": multiline,
            "autoSize": autosize, "html": html,
        }

        font_id = None
        if has_font:
            font_id = struct.unpack_from("<H", buf, q)[0]; q += 2
        if has_fontclass:
            _, q = S.cstr(buf, q)
        if has_font:
            rec["size"] = struct.unpack_from("<H", buf, q)[0] / 20; q += 2
            rec["fontId"] = font_id
            rec["font"] = fonts.get(font_id)
        if has_color:
            r, g, b, a = buf[q], buf[q + 1], buf[q + 2], buf[q + 3]
            q += 4
            rec["color"] = (r << 16) | (g << 8) | b
            rec["alpha"] = round(a / 255, 3)
        if has_maxlen:
            q += 2
        if has_layout:
            rec["align"] = ALIGN[buf[q]] if buf[q] < 4 else "left"
            rec["leftMargin"] = struct.unpack_from("<H", buf, q + 1)[0] / 20
            rec["rightMargin"] = struct.unpack_from("<H", buf, q + 3)[0] / 20
            rec["indent"] = struct.unpack_from("<H", buf, q + 5)[0] / 20
            rec["leading"] = struct.unpack_from("<h", buf, q + 7)[0] / 20
            q += 9
        var, q = S.cstr(buf, q)
        if var:
            rec["variable"] = var
        if has_text:
            txt, q = S.cstr(buf, q)
            rec["text"] = txt
        out[cid] = rec
    return out


def text_cids(buf=None):
    return set(parse(buf))


if __name__ == "__main__":
    recs = parse()
    print(f"{len(recs)} DefineEditText characters")
    fonts = {}
    for r in recs.values():
        fonts.setdefault(r.get("font"), 0)
        fonts[r.get("font")] += 1
    print("fonts in use:")
    for f, n in sorted(fonts.items(), key=lambda kv: -kv[1]):
        print(f"  {str(f):40} {n}")
    for cid in (int(a) for a in sys.argv[1:]):
        print(json.dumps(recs.get(cid), indent=1))
