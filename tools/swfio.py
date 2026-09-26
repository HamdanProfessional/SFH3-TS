#!/usr/bin/env python3
import os
import re
import struct
import zlib

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, ".."))
DECOMP = os.path.normpath(os.path.join(REPO, "..", "sfh3_decompiled"))

SWF = os.path.join(DECOMP, "strike-force-heroes-3.swf")
SPRITES = os.path.join(DECOMP, "sprites")
SHAPES = os.path.join(DECOMP, "shapes")
SCRIPTS = os.path.join(DECOMP, "scripts")

ATLAS_MAX_W = 2048
ATLAS_MAX_H = 2048

SHOW_FRAME = 1
DEFINE_SPRITE = 39
FRAME_LABEL = 43
PLACE2, PLACE3 = 26, 70


def body(path=SWF):
    raw = open(path, "rb").read()
    if raw[:3] == b"FWS":
        return raw[8:]
    if raw[:3] == b"CWS":
        return zlib.decompress(raw[8:])
    if raw[:3] == b"ZWS":
        raise SystemExit("LZMA-compressed SWF (ZWS) not handled")
    raise SystemExit(f"unhandled signature {raw[:3]!r}")


def skip_rect(buf, pos):
    return pos + ((5 + (buf[pos] >> 3) * 4 + 7) // 8)


def tags(buf, pos, end):
    while pos < end:
        (cl,) = struct.unpack_from("<H", buf, pos)
        pos += 2
        code, ln = cl >> 6, cl & 0x3F
        if ln == 0x3F:
            (ln,) = struct.unpack_from("<I", buf, pos)
            pos += 4
        yield code, pos, ln
        pos += ln


def header_info(buf):
    p = skip_rect(buf, 0)
    return struct.unpack_from("<H", buf, p)[0] / 256.0, struct.unpack_from("<H", buf, p + 2)[0]


def sprites(buf):
    out = {}
    pos = skip_rect(buf, 0) + 4
    for code, p, ln in tags(buf, pos, len(buf)):
        if code == DEFINE_SPRITE:
            cid = struct.unpack_from("<H", buf, p)[0]
            out[cid] = (p + 4, p + ln)
    return out


class Bits:

    def __init__(self, buf, pos):
        self.b, self.p, self.n = buf, pos, 0

    def read(self, count, signed=False):
        v = 0
        for _ in range(count):
            v = (v << 1) | ((self.b[self.p] >> (7 - self.n)) & 1)
            self.n += 1
            if self.n == 8:
                self.n, self.p = 0, self.p + 1
        if signed and count and v >= 1 << (count - 1):
            v -= 1 << count
        return v

    def align(self):
        if self.n:
            self.n, self.p = 0, self.p + 1
        return self.p


def matrix6(buf, pos):
    r = Bits(buf, pos)
    a = d = 1.0
    b = c = 0.0
    if r.read(1):
        nb = r.read(5)
        a = r.read(nb, True) / 65536.0
        d = r.read(nb, True) / 65536.0
    if r.read(1):
        nb = r.read(5)
        b = r.read(nb, True) / 65536.0
        c = r.read(nb, True) / 65536.0
    nb = r.read(5)
    tx = r.read(nb, True) / 20.0
    ty = r.read(nb, True) / 20.0
    return (tx, ty, a, d, b, c), r.align()


def cxform_read(buf, pos):
    r = Bits(buf, pos)
    has_add, has_mult = r.read(1), r.read(1)
    nb = r.read(4)
    mult = [r.read(nb, True) / 256.0 for _ in range(4)] if has_mult else [1.0] * 4
    add = [r.read(nb, True) for _ in range(4)] if has_add else [0] * 4
    return mult, add, r.align()


def cstr(buf, pos):
    e = buf.index(b"\0", pos)
    return buf[pos:e].decode("utf-8", "replace"), e + 1


def sprite_dir(cid, root=SPRITES):
    if not os.path.isdir(root):
        return None
    for d in os.listdir(root):
        if d == f"DefineSprite_{cid}" or d.startswith(f"DefineSprite_{cid}_"):
            return os.path.join(root, d)
    return None


def frame_svgs(cid):
    d = sprite_dir(cid)
    if d:
        n = len([f for f in os.listdir(d) if f.endswith(".svg")])
        return [os.path.join(d, f"{i}.svg") for i in range(1, n + 1)]
    shape = os.path.join(SHAPES, f"{cid}.svg")
    return [shape] if os.path.exists(shape) else []


def header(svg):
    w = float(re.search(r'width="([-0-9.]+)px"', svg).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', svg).group(1))
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', svg)
    nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))] if m else [1, 0, 0, 1, 0, 0]
    return w, h, nums[4], nums[5]


def shelf_pack(sizes, max_w=ATLAS_MAX_W, max_h=ATLAS_MAX_H):
    pos, pages = [], []
    page, x, y, row_h, used_w = 0, 0, 0, 0, 0

    def close_page():
        pages.append((used_w, y + row_h))

    for w, h in sizes:
        if x and x + w > max_w:
            x, y, row_h = 0, y + row_h, 0
        if y and y + h > max_h:
            close_page()
            page, x, y, row_h, used_w = page + 1, 0, 0, 0, 0
        pos.append((page, x, y))
        x += w
        row_h = max(row_h, h)
        used_w = max(used_w, x)
    close_page()
    return pos, pages
