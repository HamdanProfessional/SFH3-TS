#!/usr/bin/env python3
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swfio as S

DESIGN_W, DESIGN_H = 800, 600
VIEW_W, VIEW_H = DESIGN_W / 2, DESIGN_H / 2
BASE_DSF = 2
GUIDE_CIDS = (218,)
ROOT_G = re.compile(
    r'<g transform="matrix\(0\.5, 0\.0, 0\.0, 0\.5, '
    r'(-?[\d.]+), (-?[\d.]+)\)">'
)


def stage_origin(svg_text):
    m = ROOT_G.search(svg_text)
    if not m:
        raise ValueError("no ffdec root group -- export format changed?")
    return float(m.group(1)), float(m.group(2))


def menu_frame_path(frame):
    return os.path.join(
        S.SPRITES, "DefineSprite_2913_Menu", f"{frame}.svg")


def font_css():
    import base64
    import glob
    import os
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "fonts"))
    out = []
    for path in sorted(glob.glob(os.path.join(root, "*.ttf"))):
        family = os.path.splitext(os.path.basename(path))[0]
        with open(path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        out.append(f'@font-face{{font-family:"{family}";'
                   f'src:url(data:font/ttf;base64,{b64}) format("truetype");}}')
    return "\n".join(out)


PAGE = """<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #host{position:absolute;left:0;top:0}
  __FONT_CSS__
</style>
<div id="host"></div>
""".replace("__FONT_CSS__", font_css())

SET_VIEW = """(args) => {
  const [svg, x, y, w, h] = args;
  document.getElementById('host').innerHTML = svg;
  const el = document.querySelector('#host > svg');
  el.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('width', w);
  el.setAttribute('height', h);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.display = 'block';
}"""

HIDE = """(sel) => {
  for (const s of sel) {
    document.querySelectorAll(s).forEach(e => { e.style.display = 'none'; });
  }
}"""

HIDE_CIDS = """(ids) => {
  const want = new Set(ids.map(String));
  let n = 0;
  for (const u of document.querySelectorAll('#host use')) {
    let cid = null;
    for (const a of u.attributes) {
      if (a.name.toLowerCase().endsWith('characterid')) { cid = a.value; break; }
    }
    if (cid !== null && want.has(cid)) { u.style.display = 'none'; n++; }
  }
  return n;
}"""

SHIFT = """(moves) => {
  let n = 0;
  for (const [sel, dx, dy] of moves) {
    document.querySelectorAll(sel).forEach(e => {
      const old = e.getAttribute('transform') || '';
      e.setAttribute('transform', `translate(${dx}, ${dy}) ` + old);
      n++;
    });
  }
  return n;
}"""


def open_page(pw, supersample=1):
    b = pw.chromium.launch(args=["--force-color-profile=srgb"])
    pg = b.new_page(viewport={"width": 1280, "height": 900},
                    device_scale_factor=BASE_DSF * supersample)
    pg.set_content(PAGE)
    return b, pg


def load(pg, svg_text):
    pg.evaluate("(s) => { document.getElementById('host').innerHTML = s; }",
                svg_text)


def render(pg, svg_text, out_path, rect=None, hide=(), hide_cids=(), shift=()):
    tx, ty = stage_origin(svg_text)
    x, y, w, h = rect or (tx, ty, VIEW_W, VIEW_H)
    pg.evaluate(SET_VIEW, [svg_text, x, y, w, h])
    if shift:
        pg.evaluate(SHIFT, [list(s) for s in shift])
    if hide:
        pg.evaluate(HIDE, list(hide))
    guides = [str(c) for c in list(hide_cids) + list(GUIDE_CIDS)]
    if guides:
        pg.evaluate(HIDE_CIDS, guides)
    pg.set_viewport_size({"width": int(w) + 16, "height": int(h) + 16})
    el = pg.query_selector("#host > svg")
    el.screenshot(path=out_path, omit_background=True)
    return w, h


if __name__ == "__main__":
    from playwright.sync_api import sync_playwright

    frame = int(sys.argv[1]) if len(sys.argv) > 1 else 22
    out = sys.argv[2] if len(sys.argv) > 2 else f"frame{frame}.png"
    with open(menu_frame_path(frame), encoding="utf-8") as fh:
        svg = fh.read()
    print("stage origin:", stage_origin(svg), "svg bytes:", len(svg))
    with sync_playwright() as pw:
        b, pg = open_page(pw, supersample=2)
        print("wrote", out, render(pg, svg, out))
        b.close()
