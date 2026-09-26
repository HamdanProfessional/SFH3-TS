import {
  Assets, Container, Rectangle, Sprite, Text, Texture, TextStyle,
} from "pixi.js";
import type { TextStyleOptions } from "pixi.js";
import manifest from "../assets/menuUi.json";

const BASE = "ui/";

export interface TextSpec {
  cid: number;
  x: number; y: number; w: number; h: number;
  size?: number;
  font?: string;
  color?: number;
  alpha?: number;
  align?: "left" | "right" | "center" | "justify";
  leading?: number;
  wordWrap?: boolean;
  multiline?: boolean;
  text?: string;
}

export interface FrameItem {
  name: string;
  cid: number;
  kind: "button" | "text";
  x: number; y: number; w: number; h: number;
  sx: number; sy: number;
  order: number;
}

export interface ButtonArt {
  states: Partial<Record<"up" | "over" | "down", string>>;
  offX: number; offY: number; w: number; h: number;
}

interface FrameArt {
  frame: number;
  plate: string;
  plateX: number; plateY: number; plateW: number; plateH: number;
  bgSpot: string | null;
  bgX: number | null;
  vignette: string | null;
  items: FrameItem[];
}

interface BgTile { file: string; x: number; w: number }

interface BgRoom { x: number; w: number }

interface BgArt {
  x: number; y: number; w: number; h: number;
  rooms: BgRoom[];
  tiles: BgTile[];
}

const M = manifest as unknown as {
  design: [number, number];
  scale: number;
  buttons: Record<string, ButtonArt>;
  text: Record<string, TextSpec>;
  frames: Record<string, FrameArt>;
  bg: BgArt;
  chrome: [number, number][];
};

export const CHROME_BANDS: readonly (readonly [number, number])[] =
  M.chrome ?? [];

export const PORT_BUTTONS: Readonly<Record<string, ButtonArt>> = {
  multiplayer: {
    offX: -1.2, offY: -0.7, w: 234.5, h: 22,
    states: {
      up: "btn_mp_up.png", over: "btn_mp_over.png", down: "btn_mp_down.png",
    },
  },
};

const PORT_FRAMES: Readonly<Record<string, FrameArt>> = {
  multiplayer: {
    frame: -1,
    plate: "plate_multiplayer.png",
    plateX: 0, plateY: 0, plateW: 800, plateH: 600,
    bgSpot: null, bgX: null,
    vignette: "vig_2431.png",
    items: [],
  },
  mapBrowser: {
    frame: -1,
    plate: "plate_multiplayer.png",
    plateX: 0, plateY: 0, plateW: 800, plateH: 600,
    bgSpot: null, bgX: null,
    vignette: "vig_2431.png",
    items: [],
  },
};

function frameRec(label: string): FrameArt | null {
  return M.frames[label] ?? PORT_FRAMES[label] ?? null;
}

export const ART_SCALE = M.scale;

let loaded = false;

export async function loadArt(): Promise<void> {
  if (loaded) return;

  await Promise.all([
    Assets.load(menuArtUrls()),
    loadFonts(),
  ]);
  loaded = true;
}

export function menuArtUrls(): string[] {
  const urls = new Set<string>();
  const frames = [...Object.values(M.frames), ...Object.values(PORT_FRAMES)];
  for (const f of frames) urls.add(BASE + f.plate);
  for (const t of M.bg?.tiles ?? []) urls.add(BASE + t.file);
  for (const f of frames) {
    if (f.vignette) urls.add(BASE + f.vignette);
  }
  for (const b of [...Object.values(M.buttons), ...Object.values(PORT_BUTTONS)]) {
    for (const src of Object.values(b.states)) urls.add(BASE + src);
  }
  return [...urls];
}

export { loadFonts };

const FAMILIES = [
  "QTypeSquare-Book", "QTypeSquare-Bold", "QTypeSquare-BlackMajuscles",
  "QTypeSquare-Light", "QTypeSquare-Medium", "QTypeSquare-ExtraLight",
  "Xoireqe",
];

async function loadFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(FAMILIES.map((f) => document.fonts.load(`16px "${f}"`)));
  await document.fonts.ready;
}

export function frameArt(label: string): FrameArt | null {
  return frameRec(label);
}

export function itemOf(label: string, name: string): FrameItem | null {
  return M.frames[label]?.items.find((i) => i.name === name) ?? null;
}

export function textSpec(cid: number): TextSpec | null {
  return M.text[String(cid)] ?? null;
}

export function fitText(t: Text, max: number): void {
  if (t.scale.x !== 1 || t.scale.y !== 1) t.scale.set(1);
  if (max > 0 && t.width > max) t.scale.set(max / t.width);
}

function tex(file: string): Texture {
  return Assets.get(BASE + file) ?? Texture.EMPTY;
}

export function platefor(label: string): Sprite | null {
  const f = frameRec(label);
  if (!f) return null;
  const s = new Sprite(tex(f.plate));
  s.width = f.plateW;
  s.height = f.plateH;
  s.position.set(f.plateX, f.plateY);
  return s;
}

export function vignetteFor(label: string): Texture | null {
  const f = frameRec(label);
  return f?.vignette ? tex(f.vignette) : null;
}

export class BgStrip extends Container {
  private static readonly OVERHANG = 4000;

  private readonly art = M.bg;
  private readonly tiles: { sp: Sprite; rec: BgTile }[] = [];
  private readonly shoulders: { sp: Sprite; at: number; side: "l" | "r" }[] = [];
  private target = 0;
  private cut = false;

  constructor() {
    super();
    const art = this.art;
    if (!art) return;

    for (const rec of art.tiles) {
      const sp = new Sprite(tex(rec.file));
      sp.position.set(rec.x, art.y);
      sp.width = rec.w;
      sp.height = art.h;
      this.addChild(sp);
      this.tiles.push({ sp, rec });
    }

    const rooms = art.rooms ?? [];
    const O = BgStrip.OVERHANG;
    rooms.forEach((r, i) => {
      const prev = rooms[i - 1];
      const next = rooms[i + 1];
      const lo = prev ? (prev.x + prev.w + r.x) / 2 : r.x - O;
      const hi = next ? (r.x + r.w + next.x) / 2 : r.x + r.w + O;
      for (const [at, from, to, side] of [
        [r.x, lo, r.x, "l"],
        [r.x + r.w, r.x + r.w, hi, "r"],
      ] as [number, number, number, "l" | "r"][]) {
        const sp = new Sprite();
        sp.position.set(from, art.y);
        sp.width = to - from;
        sp.height = art.h;
        sp.visible = false;
        this.addChild(sp);
        this.shoulders.push({ sp, at, side });
      }
    });
  }

  snap(x: number): void {
    this.target = x;
    this.x = x;
  }

  slideTo(x: number): void {
    this.target = x;
  }

  update(): void {
    if (!this.art) return;
    if (!this.cut) this.cutColumns();
    const gap = this.target - this.x;
    this.x = Math.abs(gap) < 0.5 ? this.target : this.x + gap * 0.5;
  }

  private cutColumns(): void {
    for (const { sp, at, side } of this.shoulders) {
      const t = this.columnAt(at, side);
      if (!t) return;
      sp.texture = t;
      sp.visible = sp.width > 0;
    }
    this.cut = true;
  }

  private columnAt(x: number, side: "l" | "r"): Texture | null {
    for (const { sp, rec } of this.tiles) {
      const inside = side === "l"
        ? x >= rec.x && x < rec.x + rec.w
        : x > rec.x && x <= rec.x + rec.w;
      if (!inside) continue;
      const t = sp.texture;
      if (!t || t === Texture.EMPTY || t.frame.width < 2) return null;
      const k = t.frame.width / rec.w;
      const col = Math.max(1, Math.round(k));
      const px = (x - rec.x) * k - (side === "l" ? 0 : col);
      const at = Math.max(0, Math.min(t.frame.width - col, Math.round(px)));
      return new Texture({
        source: t.source,
        frame: new Rectangle(t.frame.x + at, t.frame.y, col, t.frame.height),
      });
    }
    return null;
  }

  refresh(): void {
    for (const { sp, rec } of this.tiles) {
      if (sp.texture === Texture.EMPTY) sp.texture = tex(rec.file);
    }
  }
}

export class ArtButton extends Container {
  readonly w: number;
  readonly h: number;
  private up: Sprite;
  private over: Sprite | null = null;
  private down: Sprite | null = null;
  private state: "up" | "over" | "down" = "up";

  constructor(art_: number | ButtonArt, x: number, y: number, sx = 1, sy = 1) {
    super();
    const art = typeof art_ === "number" ? M.buttons[String(art_)] : art_;
    this.position.set(x, y);
    this.w = (art?.w ?? 0) * sx;
    this.h = (art?.h ?? 0) * sy;

    const make = (file?: string): Sprite | null => {
      if (!file) return null;
      const sp = new Sprite(tex(file));
      sp.width = art.w * sx;
      sp.height = art.h * sy;
      sp.position.set(art.offX * sx, art.offY * sy);
      sp.visible = false;
      this.addChild(sp);
      return sp;
    };

    this.up = make(art?.states.up) ?? new Sprite();
    this.over = make(art?.states.over);
    this.down = make(art?.states.down);
    this.up.visible = true;
  }

  hitBox(): [number, number, number, number] {
    return [
      this.x + (this.up.x || 0) * this.scale.x,
      this.y + (this.up.y || 0) * this.scale.y,
      this.w * this.scale.x,
      this.h * this.scale.y,
    ];
  }

  setState(s: "up" | "over" | "down"): void {
    if (this.state === s) return;
    this.state = s;
    this.up.visible = s === "up" || (s === "over" && !this.over)
      || (s === "down" && !this.down && !this.over);
    if (this.over) this.over.visible = s === "over" || (s === "down" && !this.down);
    if (this.down) this.down.visible = s === "down";
  }
}

export function fieldText(
  cid: number, place: { x: number; y: number }, initial = "",
  override: Partial<TextStyleOptions> = {},
): Text {
  const spec = textSpec(cid);
  const align = spec?.align ?? "left";
  const t = new Text({
    text: initial,
    style: new TextStyle({
      fontFamily: [spec?.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
      fontSize: spec?.size ?? 12,
      fill: spec?.color ?? 0xffffff,
      align: align === "justify" ? "left" : align,
      wordWrap: spec?.wordWrap ?? false,
      wordWrapWidth: spec?.w ?? 200,
      lineHeight: spec?.size
        ? spec.size + (spec.leading ?? 0)
        : undefined,
      ...override,
    }),
  });
  t.alpha = spec?.alpha ?? 1;

  const bx = place.x + (spec?.x ?? 0);
  const by = place.y + (spec?.y ?? 0);
  const bw = spec?.w ?? 0;
  if (align === "center") {
    t.anchor.set(0.5, 0);
    t.position.set(bx + bw / 2, by);
  } else if (align === "right") {
    t.anchor.set(1, 0);
    t.position.set(bx + bw, by);
  } else {
    t.position.set(bx, by);
  }
  return t;
}
