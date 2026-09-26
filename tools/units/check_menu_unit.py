#!/usr/bin/env python3
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bake_menu_unit as B
import svgraster as R

REPO = B.REPO
TEX = B.OUT_PNG

WESLEY = {"head": 81, "body": 81, "color": 3, "face": 3, "skin": 2, "hair": 13,
          "gun": 2}
PLACEHOLDER = {"head": 1, "body": 1, "color": 1, "face": 1, "skin": 1, "hair": 1,
               "gun": 2}


def mat_mul(inner, outer):
    a, b, c, d, e, f = inner
    A, Bc, C, D, E, F = outer
    return [
        A * a + C * b, Bc * a + D * b,
        A * c + C * d, Bc * c + D * d,
        A * e + C * f + E, Bc * e + D * f + F,
    ]


def mat_inv(m):
    a, b, c, d, e, f = m
    det = a * d - b * c or 1e-12
    return [
        d / det, -b / det,
        -c / det, a / det,
        (c * f - d * e) / det, (b * e - a * f) / det,
    ]


def load(rec):
    if not rec:
        return None
    return Image.open(os.path.join(TEX, rec["file"])).convert("RGBA"), rec["ox"], rec["oy"]


class Figure:

    def __init__(self, hero=None):
        self.hero = dict(hero or WESLEY)

    def draws(self, rig, frame):
        h = self.hero
        body_f = str(h["body"] + h["color"] - 1)
        out = []
        for place in rig["timeline"]["frames"][frame - 1]:
            name, m = place[0], place[1:]
            if name == "shadow":
                out.append((m, *load(rig["shadow"])))
            elif name == "head":
                out.extend(self.head_layers(rig, m))
            elif name == "gun":
                out.append((m, *load(rig["guns"].get(str(h["gun"])))))
            else:
                base = {"frontArm": "arm", "backArm": "arm",
                        "frontForearm": "forearm", "backForearm": "forearm",
                        "frontHand": "hand", "backHand": "hand",
                        "frontLeg": "leg", "backLeg": "leg",
                        "frontShin": "shin", "backShin": "shin",
                        "frontFoot": "foot", "backFoot": "foot"}.get(name, name)
                part = rig["parts"][base][body_f]
                out.append((m, *load(part)))
                if base == "body" and part.get("stow"):
                    out.append((mat_mul(part["stow"]["m"], m),
                                *load(rig["stows"].get(str(h["gun"])))))
        return out

    def head_layers(self, rig, m_head):
        h = self.hero
        head = rig["heads"][str(h["head"] + h["color"] - 1)]
        out = []
        face = rig["faces"][str(head["face"]["cid"])][str(h["face"])]
        m_face = mat_mul(head["face"]["m"], m_head)
        out.append((m_face, *load(face)))
        if face.get("skin"):
            out.append((mat_mul(face["skin"]["m"], m_face),
                        *load(rig["skins"][str(face["skin"]["cid"])][str(h["skin"])])))
        if head.get("hair"):
            hair = rig["hairs"][str(head["hair"]["cid"])].get(str(h["hair"]))
            if hair:
                out.append((mat_mul(head["hair"]["m"], m_head), *load(hair)))
        out.append((m_head, *load(head["tex"])))
        return out


def render(rig, fig, frame, x0, y0, sx, sy, scale=2):
    w, h = int(sx * scale), int(sy * scale)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for m, im, ox, oy in fig.draws(rig, frame):
        if im is None:
            continue
        ia, ib, ic, id_, ie, if_ = mat_inv(m)
        c = ia * x0 + ic * y0 + ie + ox
        f = ib * x0 + id_ * y0 + if_ + oy
        part = im.transform((w, h), Image.AFFINE,
                            (ia / scale, ic / scale, c,
                             ib / scale, id_ / scale, f),
                            resample=Image.BICUBIC)
        canvas.alpha_composite(part)
    return canvas


def main():
    frame = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    out = sys.argv[2] if len(sys.argv) > 2 else "shots/_rig_hero.png"
    rig_path = os.path.join(REPO, "src", "assets", "menuRig.json")
    if not os.path.isfile(rig_path):
        print("menuRig.json not baked yet")
        return
    rig = json.load(open(rig_path))
    x0, y0, sx, sy = -60, -80, 120, 100
    fig = Figure()
    canvas = render(rig, fig, frame, x0, y0, sx, sy)
    canvas.save(out)

    from playwright.sync_api import sync_playwright
    svg = open(os.path.join(B.sprite_dir(B.UNIT_CID), f"{frame}.svg"),
               encoding="utf-8").read()
    tx, ty = R.stage_origin(svg)
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=1)
        R.render(pg, svg, "shots/_rig_swf.png",
                 rect=(tx + x0 / 2, ty + y0 / 2, sx / 2, sy / 2))
        b.close()
    swf = Image.open("shots/_rig_swf.png").convert("RGBA")
    sheet = Image.new("RGBA", (canvas.width + swf.width + 8,
                               max(canvas.height, swf.height)), (35, 35, 40, 255))
    sheet.alpha_composite(canvas, (0, 0))
    sheet.alpha_composite(swf, (canvas.width + 8, 0))
    side = out.replace(".png", "-vs.png")
    sheet.save(side)
    print("wrote", out, "and", side)


if __name__ == "__main__":
    main()
