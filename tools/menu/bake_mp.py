#!/usr/bin/env python3
import os
from PIL import Image, ImageDraw, ImageFont

WORD = "MULTIPLAYER"
FONT = "public/fonts/Xoireqe.ttf"
OUT = "public/ui"

CAP_PX = 30
BOX_H = 44
PAD_L = 9
PAD_R = 28
INK_TOP = 5

STATES = {"up": (204, 204, 204), "over": (255, 255, 255), "down": (102, 102, 102)}

OVERSAMPLE = 6

PLATE_SRC = "plate_credits.png"
PLATE_TOP = 112
PLATE_BOT = 1143
SCRIM = (0, 0, 0, 120)


def ink_mask() -> Image.Image:
    size = CAP_PX * OVERSAMPLE * 2
    font = ImageFont.truetype(FONT, size)
    run = round(font.getlength(WORD))
    big = Image.new("L", (run + size * 2, size * 3), 0)
    ImageDraw.Draw(big).text((size, size), WORD, font=font, fill=255)
    box = big.getbbox()
    if box is None:
        raise SystemExit("nothing rendered -- is the font readable?")
    if box[2] >= big.width - 2:
        raise SystemExit("ink reached the canvas edge -- the word was clipped")
    ink = big.crop(box)
    w = round(ink.width * CAP_PX / ink.height)
    return ink.resize((w, CAP_PX), Image.LANCZOS)


def bake_tab() -> None:
    mask = ink_mask()
    w = PAD_L + mask.width + PAD_R
    for state, rgb in STATES.items():
        im = Image.new("RGBA", (w, BOX_H), (0, 0, 0, 0))
        im.paste(Image.new("RGBA", mask.size, (*rgb, 255)), (PAD_L, INK_TOP), mask)
        im.save(f"{OUT}/btn_mp_{state}.png")
    print(f"btn_mp_<up|over|down>.png  {w}x{BOX_H} tex"
          f"  ink {mask.width / 2:.1f}x{mask.height / 2:.1f} design px")
    print(f"  PORT_BUTTONS: offX -1.2, offY -0.7, w {w / 2}, h {BOX_H / 2}")


def bake_plate() -> None:
    src = Image.open(f"{OUT}/{PLATE_SRC}").convert("RGBA")
    im = src.copy()
    ImageDraw.Draw(im).rectangle(
        [0, PLATE_TOP, im.width - 1, PLATE_BOT - 1], fill=SCRIM)
    im.save(f"{OUT}/plate_multiplayer.png")
    print(f"plate_multiplayer.png  {im.width}x{im.height} tex"
          f"  scrim rows {PLATE_TOP}..{PLATE_BOT - 1}")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    bake_tab()
    bake_plate()


if __name__ == "__main__":
    main()
