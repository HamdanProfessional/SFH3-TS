import { Container, Graphics, Text, TextStyle, type TextStyleOptions } from "pixi.js";
import { Input } from "../core/Input";
import { Focus, type FocusOpts, type Rect } from "../core/Focus";
import { SH } from "../audio/SH";

export const COLOR = {
  active: 0xffcc00,
  text: 0xffffff,
  dim: 0x9aa4b0,
  panel: 0x1b2129,
  panelEdge: 0x2f3946,
  bg: 0x11151b,
  good: 0x00ff66,
  tired: 0xffcc33,
  injured: 0xff6600,
  critical: 0xff3300,
  bar: 0x66ccff,
  barBack: 0x0d1116,
} as const;

const FONT = "Verdana, Geneva, sans-serif";
const CAPS_FONT = ["QTypeSquare-BlackMajuscles", "QTypeSquare-Bold", "Verdana", "sans-serif"];

export function textStyle(opts: Partial<TextStyleOptions> = {}): TextStyle {
  return new TextStyle({
    fontFamily: FONT,
    fontSize: 13,
    fill: COLOR.text,
    ...opts,
  });
}

export function label(
  str: string, x: number, y: number, opts: Partial<TextStyleOptions> = {},
): Text {
  const t = new Text({ text: str, style: textStyle(opts) });
  t.position.set(x, y);
  return t;
}

let hitOffX = 0;
let hitOffY = 0;

export function setHitOrigin(x = 0, y = 0): void {
  hitOffX = x;
  hitOffY = y;
}

export function getHitOrigin(): readonly [number, number] {
  return [hitOffX, hitOffY];
}

export function localMouseX(): number {
  return Input.mouseX - hitOffX;
}

export function localMouseY(): number {
  return Input.mouseY - hitOffY;
}

export function hitTest(
  x: number, y: number, w: number, h: number,
): boolean {
  Focus.hit(x + hitOffX, y + hitOffY, w, h);
  const mx = Input.mouseX - hitOffX;
  const my = Input.mouseY - hitOffY;
  return mx >= x && mx <= x + w && my >= y && my <= y + h;
}

export function focusable(
  x: number, y: number, w: number, h: number, o: FocusOpts = {},
): void {
  const clip: Rect | undefined = o.clip
    && [o.clip[0] + hitOffX, o.clip[1] + hitOffY, o.clip[2], o.clip[3]];
  Focus.add(x + hitOffX, y + hitOffY, w, h, clip ? { ...o, clip } : o);
}

export function isBackLabel(text: string): boolean {
  return /^(back|cancel|close)$/i.test(text.trim());
}

export class Button extends Container {
  readonly w: number;
  readonly h: number;
  private bg = new Graphics();
  private txt: Text;
  private hovered = false;
  private pressed = false;
  private active = false;
  private enabled = true;

  constructor(str: string, x: number, y: number, w: number, h: number, fontSize = 13) {
    super();
    this.w = w;
    this.h = h;
    this.position.set(x, y);
    this.addChild(this.bg);
    this.txt = label(str.toUpperCase(), 0, 0, {
      fontSize: Math.max(8, fontSize - 1), fontFamily: CAPS_FONT, letterSpacing: 1,
    });
    this.txt.anchor.set(0.5);
    this.txt.position.set(w / 2, h / 2 + 1);
    this.fitText();
    this.addChild(this.txt);
    this.redraw();
  }

  private fitText(): void {
    this.txt.scale.set(1);
    const room = this.w - 8;
    if (this.txt.width > room) this.txt.scale.set(room / this.txt.width);
  }

  set text(v: string) {
    const up = v.toUpperCase();
    if (this.txt.text === up) return;
    this.txt.text = up;
    this.fitText();
  }

  get text(): string {
    return this.txt.text;
  }

  setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    this.redraw();
  }

  setActive(v: boolean): void {
    if (this.active === v) return;
    this.active = v;
    this.redraw();
  }

  hit(): boolean {
    if (!this.visible || !this.enabled) return false;
    return hitTest(this.x, this.y, this.w, this.h);
  }

  update(): void {
    const h = this.hit();
    const p = h && Input.mouseDown;
    if (h !== this.hovered || p !== this.pressed) {
      this.hovered = h;
      this.pressed = p;
      this.redraw();
    }
    if (this.visible && this.enabled && isBackLabel(this.txt.text)) {
      focusable(this.x, this.y, this.w, this.h, { back: true });
    }
  }

  activate(sound = "S_Click"): boolean {
    const h = this.hit();
    if (h) SH.playSound(sound);
    return h;
  }

  private redraw(): void {
    this.bg.clear();
    if (this.pressed) this.bg.rect(0, 0, this.w, this.h).fill({ color: 0x000000, alpha: 0.8 });
    else if (this.active) this.bg.rect(0, 0, this.w, this.h).fill({ color: COLOR.active, alpha: 0.92 });
    else if (this.hovered) this.bg.rect(0, 0, this.w, this.h).fill({ color: 0x00ffff, alpha: 0.8 });
    else this.bg.rect(0, 0, this.w, this.h).fill({ color: 0x000000, alpha: 0.6 });
    this.txt.style.fill = this.active && !this.pressed ? 0x000000 : COLOR.text;
    this.alpha = this.enabled ? 1 : 0.35;
  }
}

export function panel(
  x: number, y: number, w: number, h: number, title?: string,
): Container {
  const c = new Container();
  c.position.set(x, y);
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 4).fill({ color: COLOR.panel });
  g.roundRect(0, 0, w, h, 4).stroke({ color: COLOR.panelEdge, width: 1 });
  c.addChild(g);
  if (title) {
    const t = label(title, 10, 8, { fontSize: 12, fill: COLOR.dim });
    c.addChild(t);
  }
  return c;
}

export class StatBar extends Container {
  private fill = new Graphics();
  private valueTxt: Text;
  private readonly barW: number;

  constructor(
    name: string, x: number, y: number,
    private readonly max: number,
    barW = 150,
  ) {
    super();
    this.position.set(x, y);
    this.barW = barW;

    this.addChild(label(name, 0, 0, { fontSize: 11, fill: COLOR.dim }));

    const back = new Graphics();
    back.roundRect(0, 15, barW, 8, 2).fill({ color: COLOR.barBack });
    this.addChild(back);
    this.addChild(this.fill);

    this.valueTxt = label("", barW + 8, 12, { fontSize: 11 });
    this.addChild(this.valueTxt);
  }

  setValue(v: number): void {
    const frac = Math.max(0, Math.min(1, v / this.max));
    this.fill.clear();
    if (frac > 0) {
      this.fill.roundRect(0, 15, this.barW * frac, 8, 2).fill({ color: COLOR.bar });
    }
    const shown = String(Math.round(v));
    if (this.valueTxt.text !== shown) this.valueTxt.text = shown;
  }
}

export class ScrollBox extends Container {
  readonly content = new Container();
  private maskG = new Graphics();
  private scrollY = 0;

  constructor(
    x: number, y: number,
    private readonly w: number,
    private readonly h: number,
  ) {
    super();
    this.position.set(x, y);
    this.maskG.rect(0, 0, w, h).fill({ color: 0xffffff });
    this.addChild(this.maskG);
    this.addChild(this.content);
    this.content.mask = this.maskG;
  }

  update(): void {
    if (!Input.wheelDelta) return;
    if (!hitTest(this.x, this.y, this.w, this.h)) return;
    this.scrollBy(Input.wheelDelta * 4 * 6);
    Input.wheelDelta = 0;
  }

  scrollBy(dy: number): void {
    const overflow = Math.max(0, this.content.height - this.h);
    this.scrollY = Math.max(-overflow, Math.min(0, this.scrollY - dy));
    this.content.y = this.scrollY;
  }

  focusRow(top: number, h: number, x = 0, w = this.w): void {
    focusable(this.x + x, this.y + this.content.y + top, w, h, {
      key: `row:${this.x},${this.y}:${top}`,
      clip: [this.x, this.y, this.w, this.h],
      reveal: () => this.reveal(top, h),
    });
  }

  reveal(top: number, h: number): void {
    const view = -this.scrollY;
    if (top < view) this.scrollBy(top - view);
    else if (top + h > view + this.h) this.scrollBy(top + h - (view + this.h));
  }

  resetScroll(): void {
    this.scrollY = 0;
    this.content.y = 0;
  }
}

export function ease(current: number, target: number, k: number): number {
  return current + (target - current) * k;
}
