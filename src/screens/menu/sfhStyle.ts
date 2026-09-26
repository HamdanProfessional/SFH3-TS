import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { focusable, hitTest, isBackLabel } from "../../ui/kit";
import { SH } from "../../audio/SH";
import { Input } from "../../core/Input";

export const SFH = {
  cyan: 0x00ffff,
  metal: 0xb4b0b6,
  metalDark: 0x7e7c80,
  orange: 0xff9900,
  gold: 0xffcc00,
  white: 0xffffff,
  grey: 0x9aa7ad,
  dim: 0x6f8087,
  red: 0xff4444,
  green: 0x33ff66,
  team1: 0x66ccff,
  team2: 0xff6666,
} as const;

export const CAPS = ["QTypeSquare-BlackMajuscles", "QTypeSquare-Bold", "Verdana", "sans-serif"];
export const BOOK = ["QTypeSquare-Book", "Verdana", "sans-serif"];
export const BOLD = ["QTypeSquare-Bold", "Verdana", "sans-serif"];
export const DISPLAY = ["Xoireqe", "QTypeSquare-Bold", "Verdana", "sans-serif"];

export function sText(
  str: string, x: number, y: number, size = 12, fill: number = SFH.white, font = BOOK,
): Text {
  const t = new Text({ text: str, style: new TextStyle({ fontFamily: font, fontSize: size, fill }) });
  t.position.set(x, y);
  return t;
}

export function sTitle(str: string, x: number, y: number): Text {
  return sText(str.toUpperCase(), x, y, 20, SFH.gold, DISPLAY);
}

export function sHeading(into: Container, str: string, x: number, y: number, w: number): void {
  const g = new Graphics();
  g.rect(x - 4, y - 3, w + 2, 20).fill({ color: 0x000000 });
  g.rect(x - 4, y + 17, w + 2, 2).fill({ color: SFH.metalDark, alpha: 0.9 });
  into.addChild(g);
  into.addChild(sText(str.toUpperCase(), x, y - 1, 13, SFH.white, DISPLAY));
}

export function sPanel(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.7 });
  g.position.set(x, y);
  return g;
}

export function sInfo(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.85 });
  g.position.set(x, y);
  return g;
}

export function paintRow(g: Graphics, w: number, h: number, lit: boolean, live = true): Graphics {
  g.clear();
  g.rect(0, 0, w, h).fill({ color: lit && live ? SFH.cyan : 0x000000, alpha: lit && live ? 0.3 : 0.45 });
  g.rect(0, h - 1, w, 1).fill({ color: SFH.metalDark, alpha: 0.5 });
  g.rect(0, 0, 4, h).fill({ color: lit ? SFH.orange : live ? SFH.cyan : SFH.metalDark, alpha: live ? 0.9 : 0.4 });
  return g;
}

export class SfhButton extends Container {
  readonly w: number;
  readonly h: number;
  private bg = new Graphics();
  private txt: Text;
  private hovered = false;
  private pressed = false;
  private active = false;
  private enabled = true;

  constructor(str: string, x: number, y: number, w: number, h: number, fontSize = 12) {
    super();
    this.w = w;
    this.h = h;
    this.position.set(x, y);
    this.addChild(this.bg);
    this.txt = new Text({
      text: str.toUpperCase(),
      style: new TextStyle({ fontFamily: CAPS, fontSize, fill: SFH.white, letterSpacing: 1 }),
    });
    this.txt.anchor.set(0.5);
    this.txt.position.set(w / 2, h / 2 + 1);
    const room = w - 10;
    if (this.txt.width > room) this.txt.scale.set(room / this.txt.width);
    this.addChild(this.txt);
    this.redraw();
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
    if (this.pressed) {
      this.bg.rect(0, 0, this.w, this.h).fill({ color: 0x000000, alpha: 0.8 });
    } else if (this.active) {
      this.bg.rect(0, 0, this.w, this.h).fill({ color: SFH.orange, alpha: this.hovered ? 1 : 0.92 });
    } else {
      this.bg.rect(0, 0, this.w, this.h)
        .fill({ color: SFH.cyan, alpha: this.hovered ? 0.8 : 0.3 });
    }
    this.alpha = this.enabled ? 1 : 0.35;
  }
}
