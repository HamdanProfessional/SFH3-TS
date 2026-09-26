#!/usr/bin/env python3
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "shots")
sys.path.insert(0, os.path.join(REPO, "tools"))
import svgraster as R
import swfio as S

MENU_FRAMES = os.path.join(S.SPRITES, "DefineSprite_2913_Menu")
SCALE = 1.2
OFF_X = 160.2


def ours(name, w=1600, h=1200):
    from PIL import Image
    im = Image.open(os.path.join(OUT, name)).convert("RGBA")
    box = im.crop((int(OFF_X), 0, int(OFF_X + 800 * SCALE), int(600 * SCALE)))
    return box.resize((w, h), Image.LANCZOS)


def stack(a, b, path):
    from PIL import Image
    sheet = Image.new("RGBA", (a.width + b.width, max(a.height, b.height)),
                      (24, 24, 24, 255))
    sheet.alpha_composite(a, (0, 0))
    sheet.alpha_composite(b, (a.width, 0))
    sheet.convert("RGB").save(path)
    print("wrote", path)


def main():
    from playwright.sync_api import sync_playwright
    from PIL import Image
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=2)

        def render_frame(n, out):
            with open(os.path.join(MENU_FRAMES, f"{n}.svg"), encoding="utf-8") as fh:
                svg = fh.read()
            R.render(pg, svg, os.path.join(OUT, out))
            return svg

        render_frame(1, "_ws5b_ref_heroes.png")
        render_frame(36, "_ws5b_ref_deploy.png")

        with open(os.path.join(S.SPRITES, "DefineSprite_2473", "2.svg"),
                  encoding="utf-8") as fh:
            tray_svg = fh.read()
        R.render(pg, tray_svg, os.path.join(OUT, "_ws5b_tray2.png"))
        tray = Image.open(os.path.join(OUT, "_ws5b_tray2.png")).convert("RGBA")
        b.close()

    tx, ty = R.stage_origin(tray_svg)
    deploy_ref = Image.open(os.path.join(OUT, "_ws5b_ref_deploy.png")).convert("RGBA")
    deploy_ref.alpha_composite(tray, (int(9.75 * 2 - tx * 2), int(515 * 2 - ty * 2)))
    hero_ref = Image.open(os.path.join(OUT, "_ws5b_ref_heroes.png")).convert("RGBA")

    stack(ours("_ws5b_heroes.png"), hero_ref,
          os.path.join(OUT, "_ws5b_cmp_heroes.png"))
    stack(ours("_ws5b_deploy_picker.png"), deploy_ref,
          os.path.join(OUT, "_ws5b_cmp_deploy.png"))

    a = ours("_ws5b_deploy_picker.png").crop((0, 940, 700, 1200))
    c = deploy_ref.crop((0, 940, 700, 1200))
    stack(a, c, os.path.join(OUT, "_ws5b_cmp_picker.png"))


if __name__ == "__main__":
    main()
