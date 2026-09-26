import type { Graphics } from "pixi.js";

export const BAR_H = 4;
const SHINE_H = 1;
const SHINE_ALPHA = 0.4;
const LINE_W = 0.5;
const LINE_ALPHA = 0.25;
const LINE_MIN_GAP = 2;
const TRACK_GAP = 0.5;
const TRACK_H = 1.5;
const TRACK_ALPHA = 0.3;
const HURT_COLOR = 0xff0000;
const HURT_ALPHA = 0.5;

const NAME_LIGHTEN = 0.3;
export const NAME_ALPHA = 0.85;
export const LEVEL_ALPHA = 1;
export const TEXT_LIFT = 2.5;
export const NAME_GAP = 3;
export const NAME_FONT = ["QTypeSquare-Medium", "Verdana", "sans-serif"];

export interface BarSpec {
  width: number;
  hp: number;
  hurt: number;
  step: number;
  armor: number;
  color: number;
  alpha: number;
}

export function drawBar(g: Graphics, x: number, y: number, b: BarSpec): void {
  const rect = (lx: number, ly: number, w: number, h: number, color: number, alpha: number): void => {
    if (!Number.isFinite(w) || !(w > 0) || !(alpha > 0)) return;
    g.rect(x + lx, y + ly, w, h).fill({ color, alpha });
  };
  const width = Number.isFinite(b.width) ? b.width : 0;
  const hp = clamp(b.hp, 0, width);
  rect(0, 0, hp, BAR_H, b.color, b.alpha);
  rect(0, 0, hp, SHINE_H, 0xffffff, SHINE_ALPHA * b.alpha);
  rect(hp, 0, Math.min(b.hurt, width - hp), BAR_H, HURT_COLOR, HURT_ALPHA * b.alpha);
  let step = b.step;
  if (Number.isFinite(step) && step > 0) {
    while (step < LINE_MIN_GAP) step *= 2;
    for (let i = step; i < hp; i += step) rect(i, 0, LINE_W, BAR_H, 0x000000, LINE_ALPHA * b.alpha);
  }
  rect(0, BAR_H + TRACK_GAP, clamp(b.armor, 0, width), TRACK_H, 0xffffff, TRACK_ALPHA * b.alpha);
}

export function nameTint(color: number): number {
  const mix = (c: number): number => Math.round(c + (255 - c) * NAME_LIGHTEN);
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}

function clamp(v: number, lo: number, hi: number): number {
  return !(v >= lo) ? lo : v > hi ? hi : v;
}
