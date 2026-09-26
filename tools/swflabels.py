#!/usr/bin/env python3
import os
import struct
import sys
import zlib

SWF = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "sfh3_decompiled", "strike-force-heroes-3.swf"))

TAG_END, TAG_SHOWFRAME, TAG_DEFINESPRITE, TAG_FRAMELABEL = 0, 1, 39, 43


def read_swf(path):
    with open(path, "rb") as fh:
        sig = fh.read(3)
        ver = fh.read(1)[0]
        _len = struct.unpack("<I", fh.read(4))[0]
        body = fh.read()
    if sig == b"CWS":
        body = zlib.decompress(body)
    elif sig not in (b"FWS", b"ZWS"):
        raise ValueError(f"not an SWF: {sig!r}")
    return ver, body


def skip_rect(buf, p):
    bits = buf[p] >> 3
    total = 5 + 4 * bits
    return p + (total + 7) // 8


def tags(buf, p, end):
    while p < end:
        code_len = struct.unpack_from("<H", buf, p)[0]
        p += 2
        code, length = code_len >> 6, code_len & 0x3F
        if length == 0x3F:
            length = struct.unpack_from("<I", buf, p)[0]
            p += 4
        data = buf[p:p + length]
        p += length
        yield code, data
        if code == TAG_END:
            break


def parse(path, target):
    _ver, body = read_swf(path)
    p = skip_rect(body, 8)
    p += 4
    for code, data in tags(body, p, len(body)):
        if code != TAG_DEFINESPRITE:
            continue
        sid = struct.unpack_from("<H", data, 0)[0]
        if sid != target:
            continue
        frame = 1
        out = []
        for ncode, ndata in tags(data, 4, len(data)):
            if ncode == TAG_SHOWFRAME:
                frame += 1
            elif ncode == TAG_FRAMELABEL:
                label = ndata.split(b"\0")[0].decode("utf-8", "replace")
                out.append((frame, label))
        return out
    return []


def main():
    target = int(sys.argv[1])
    labels = parse(SWF, target)
    if "--all" not in sys.argv:
        print(f"sprite {target}: {len(labels)} labels, last frame {labels[-1][0] if labels else 0}")
    for frame, label in labels:
        print(f"{frame}\t{label}")


if __name__ == "__main__":
    main()
