#!/usr/bin/env python3
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "tools"))
sys.path.insert(0, HERE)
import bake_killstreaks as B
import svgraster as R
import swfio as S

from PIL import Image
from playwright.sync_api import sync_playwright

OUT = os.path.join(REPO, "shots")
RIG = os.path.join(REPO, "src", "assets", "killstreakRig.json")
ZOOM = 3

SHOTS = {
    "turret": [1, 21, 25, 32, 33, 69],
    "sentry": [1, 32, 33, 36, 50, 69],
}


def panel(img, size):
    return img.resize((size[0] * ZOOM, size[1] * ZOOM), Image.NEAREST)


def side_by_side(left, right, w, h):
    out = Image.new("RGBA", ((w * 2 + 8) * ZOOM, h * ZOOM), (238, 238, 238, 255))
    out.alpha_composite(panel(left, (w, h)), (0, 0))
    out.alpha_composite(panel(right, (w, h)), ((w + 8) * ZOOM, 0))
    return out


def crop420(img):
    return img.crop((0, 0, 420, 420))


def main():
    os.makedirs(OUT, exist_ok=True)
    rig = json.load(open(RIG, encoding="utf-8"))
    written = []

    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        for device, frames in SHOTS.items():
            dev = rig["devices"][device]
            for frame in frames:
                if frame > len(S.frame_svgs(dev["rootCid"])):
                    continue
                svg = open(S.frame_svgs(dev["rootCid"])[frame - 1], encoding="utf-8").read()
                w, h, ox, oy = S.header(svg)
                tmp = os.path.join(OUT, "_ws6a_tmp.png")
                R.render(pg, svg, tmp, rect=(0, 0, w, h))
                ref = Image.open(tmp).convert("RGBA")
                os.remove(tmp)
                refc = Image.new("RGBA", (420, 420), (0, 0, 0, 0))
                refc.alpha_composite(ref, (int(round(210 - ox * 2)), int(round(210 - oy * 2))))

                head_frame = ((frame - dev["headFirst"]) % B.HEAD_FRAMES) + 1
                comp = B.compose(rig, device, frame, head_frame)
                name = f"_ws6a_{device}_{frame:03}.png"
                side_by_side(crop420(refc), crop420(comp), 420, 420).save(os.path.join(OUT, name))
                written.append(name)

            frame = min(dev["headFirst"] + 3, len(S.frame_svgs(dev["rootCid"])) - 1)
            comp = B.compose(rig, device, frame, 1)
            name = f"_ws6a_{device}_runtime_headstop.png"
            crop420(comp).resize((420 * ZOOM, 420 * ZOOM), Image.NEAREST) \
                .save(os.path.join(OUT, name))
            written.append(name)
        b.close()

    for n in written:
        print("wrote", n)


if __name__ == "__main__":
    main()
