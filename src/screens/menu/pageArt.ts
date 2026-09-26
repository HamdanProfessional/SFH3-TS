import {
  Assets, CanvasTextMetrics, Container, Rectangle, Sprite, Text, Texture,
  TextStyle,
} from "pixi.js";
import type { TextStyleOptions } from "pixi.js";
import pages from "../../assets/pagesUi.json";

export const PAGE_SCALE = 2;

export type TextRun = readonly [
  number, number, number, string, string | number, number, string,
];

export interface PageTex {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface PageTextSpec {
  x: number; y: number; w: number; h: number;
  size?: number;
  font?: string;
  color?: number;
  alpha?: number;
  align?: "left" | "right" | "center" | "justify";
  leading?: number;
  wordWrap?: boolean;
}

export interface PagePlateRec {
  plate: string;
  plateX: number;
  plateY: number;
  plateW: number;
  plateH: number;
  runs?: Record<string, TextRun[]>;
}

const P = pages as unknown as {
  scale: number;
  tips: PagePlateRec;
  credits: PagePlateRec & {
    logo1: { x: number; y: number };
    logo2: { x: number; y: number };
    logo: { armor: PageTex; notdoppler: PageTex };
  };
  medals: {
    plate: string;
    plateX: number; plateY: number; plateW: number; plateH: number;
    tile: { earned: PageTex; locked: PageTex };
    bar: PageTex;
    fields: Record<string, { x: number; y: number; sx?: number; sy?: number; spec?: PageTextSpec }>;
    icon: Record<string, PageTex>;
    tiles: Record<string, { x: number; y: number }>;
  };
  app: { cid: number; x: number; y: number; w: number; h: number }
    & { states: Partial<Record<"up" | "over" | "down", string>>; offX: number; offY: number };
};

export const PAGES = P;

export interface PageButtonRec {
  cid?: number;
  x: number; y: number;
  w?: number; h?: number;
  sx?: number; sy?: number;
  states?: Partial<Record<"up" | "over" | "down", string>>;
  offX?: number; offY?: number;
}

export class PageButton extends Container {
  readonly w: number;
  readonly h: number;
  private up: Sprite;
  private over: Sprite | null = null;
  private down: Sprite | null = null;
  private state: "up" | "over" | "down" = "up";
  private recs: { sp: Sprite; rec: PageTex }[] = [];

  constructor(rec: PageButtonRec, x: number, y: number) {
    super();
    this.position.set(x, y);
    this.scale.set(rec.sx ?? 1, rec.sy ?? 1);
    this.w = (rec.w ?? 0) * (rec.sx ?? 1);
    this.h = (rec.h ?? 0) * (rec.sy ?? 1);

    const make = (file?: string): Sprite | null => {
      if (!file) return null;
      const r = { file, w: 0, h: 0, ox: 0, oy: 0 };
      const sp = new Sprite();
      bindTex(sp, r);
      this.recs.push({ sp, rec: r });
      sizeTex(sp, rec.w ?? 0, rec.h ?? 0);
      sp.position.set(rec.offX ?? 0, rec.offY ?? 0);
      sp.visible = false;
      this.addChild(sp);
      return sp;
    };
    this.up = make(rec.states?.up) ?? new Sprite();
    this.over = make(rec.states?.over);
    this.down = make(rec.states?.down);
    this.up.visible = true;
  }

  refresh(): void {
    for (const { sp, rec } of this.recs) applyTex(sp, rec);
  }

  hitBox(): [number, number, number, number] {
    return [this.x + (this.up.x || 0) * this.scale.x,
            this.y + (this.up.y || 0) * this.scale.y, this.w, this.h];
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

const BASE = "ui/";
const cache = new Map<string, Texture>();
const pending = new Set<string>();

let blank: Texture | null = null;
function blankTexture(): Texture {
  if (blank) return blank;
  if (typeof document === "undefined") return Texture.EMPTY;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  blank = Texture.from(c);
  return blank;
}

export function pageTex(rec: PageTex | null | undefined): Texture {
  if (!rec) return blankTexture();
  const hit = cache.get(rec.file);
  if (hit) return hit;
  if (!pending.has(rec.file)) {
    pending.add(rec.file);
    Assets.load<Texture>(`${BASE}${rec.file}`)
      .then((t) => void cache.set(rec.file, t))
      .catch(() => void pending.delete(rec.file));
  }
  return blankTexture();
}

export function pageArtUrls(): string[] {
  const out = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (typeof v === "string") { if (v.endsWith(".png")) out.add(BASE + v); }
      else walk(v);
    }
  };
  walk(P);
  return [...out];
}

export async function loadPageArt(): Promise<void> {
  await Promise.all(pageArtUrls().map(async (url) => {
    const file = url.slice(BASE.length);
    if (cache.has(file)) return;
    try {
      cache.set(file, await Assets.load<Texture>(url));
      pending.add(file);
    } catch {}
  }));
}

const REC = Symbol("pageTexRec");
const SIZE = Symbol("pageTexSize");

export function bindTex(sp: Sprite, rec: PageTex): void {
  (sp as unknown as Record<symbol, PageTex>)[REC] = rec;
  sp.texture = pageTex(rec);
}

export function sizeTex(sp: Sprite, w: number, h: number): void {
  (sp as unknown as Record<symbol, [number, number]>)[SIZE] = [w, h];
  sp.width = w;
  sp.height = h;
}

function applyTex(sp: Sprite, rec: PageTex): void {
  const tex = pageTex(rec);
  if (sp.texture === tex) return;
  sp.texture = tex;
  const size = (sp as unknown as Record<symbol, [number, number] | undefined>)[SIZE];
  if (size) {
    sp.width = size[0];
    sp.height = size[1];
  }
}

export function pageSprite(rec: PageTex, x: number, y: number): Sprite {
  const sp = new Sprite();
  bindTex(sp, rec);
  sp.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
  sp.scale.set(1 / PAGE_SCALE);
  sp.position.set(x, y);
  return sp;
}

export function refreshTex(root: Container): void {
  const visit = (c: Container): void => {
    for (const child of c.children) {
      const rec = (child as unknown as Record<symbol, PageTex | undefined>)[REC];
      if (rec) applyTex(child as Sprite, rec);
      if ((child as Container).children) visit(child as Container);
    }
  };
  visit(root);
}

export function pagePlate(label: string): Sprite | null {
  const rec = label === "tips" ? P.tips
    : label === "credits" ? P.credits
      : label === "medals" ? P.medals : null;
  if (!rec) return null;
  const s = new Sprite();
  bindTex(s, { file: rec.plate, w: rec.plateW, h: rec.plateH, ox: 0, oy: 0 });
  sizeTex(s, rec.plateW, rec.plateH);
  s.position.set(rec.plateX, rec.plateY);
  return s;
}

export class PlateEdges extends Container {
  private pairs: { left: Sprite; right: Sprite }[] = [];
  private key = "";

  update(plate: Sprite | null, artW: number,
         leftW: number, rightW: number,
         bands?: readonly (readonly [number, number])[]): void {
    const t = plate?.texture;
    if (!plate || !t || t.frame.width < 4 || plate.width < 1) {
      this.visible = false;
      return;
    }
    this.visible = true;
    const key = `${t.uid}|${plate.x}|${plate.width}|${artW}|${leftW}|${rightW}`
      + `|${bands?.map((b) => b.join()).join(";") ?? ""}`;
    if (key === this.key) return;
    this.key = key;

    const k = t.frame.width / plate.width;
    const col = Math.max(1, Math.round(k));
    const ky = t.frame.height / plate.height;
    const cut = (designX: number, y: number, h: number): Texture => {
      const x = Math.max(0, Math.min(t.frame.width - col,
        Math.round((designX - plate.x) * k)));
      const ry = Math.max(0, Math.min(t.frame.height - 1,
        Math.round((y - plate.y) * ky)));
      const rh = Math.max(1, Math.min(t.frame.height - ry, Math.round(h * ky)));
      return new Texture({
        source: t.source,
        frame: new Rectangle(t.frame.x + x, t.frame.y + ry, col, rh),
      });
    };

    const slices = bands?.length
      ? bands
      : [[plate.y, plate.height] as const];
    while (this.pairs.length < slices.length) {
      const left = new Sprite();
      const right = new Sprite();
      this.addChild(left, right);
      this.pairs.push({ left, right });
    }
    for (let i = slices.length; i < this.pairs.length; i++) {
      this.pairs[i].left.visible = this.pairs[i].right.visible = false;
    }

    slices.forEach(([y, h], i) => {
      const { left, right } = this.pairs[i];
      for (const [sp, texX, x, w] of [
        [left, 0, -leftW, leftW],
        [right, artW - col / k, artW, rightW],
      ] as [Sprite, number, number, number][]) {
        const old = sp.texture;
        sp.texture = cut(texX, y, h);
        if (old !== Texture.EMPTY) old.destroy(false);
        sp.position.set(x, y);
        sp.width = Math.max(0, w);
        sp.height = h;
        sp.visible = w > 0;
      }
    });
  }
}

const ascentCache = new Map<string, number>();

function ascent(font: string, size: number): number {
  const key = `${size}:${font}`;
  const hit = ascentCache.get(key);
  if (hit !== undefined) return hit;
  let a = size * 0.78;
  const m = CanvasTextMetrics as unknown as {
    measureFont?: (f: string) => { ascent?: number };
  };
  try {
    const got = m.measureFont?.(`${size}px "${font}"`);
    if (got?.ascent) a = got.ascent;
  } catch {
  }
  ascentCache.set(key, a);
  return a;
}

export function drawRuns(view: Container, runs: readonly TextRun[], dy = 0): void {
  for (const [x, y, size, font, fill, alpha, text] of runs) {
    const t = new Text({
      text,
      style: new TextStyle({
        fontFamily: [font, "Verdana", "sans-serif"],
        fontSize: size,
        fill: fill as string,
      }),
    });
    t.alpha = alpha;
    t.position.set(x, y - dy - ascent(font, size));
    view.addChild(t);
  }
}

export function pageField(
  spec: PageTextSpec,
  place: { x: number; y: number },
  initial = "",
  override: Partial<TextStyleOptions> = {},
): Text {
  const align = spec.align ?? "left";
  const wrapW = spec.w > 0 ? spec.w : undefined;
  const t = new Text({
    text: initial,
    style: new TextStyle({
      fontFamily: [spec.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
      fontSize: spec.size ?? 12,
      fill: spec.color ?? 0xffffff,
      align: align === "justify" ? "left" : align,
      wordWrap: spec.wordWrap ?? false,
      wordWrapWidth: wrapW ?? 200,
      lineHeight: spec.size ? spec.size + (spec.leading ?? 0) : undefined,
      ...override,
    }),
  });
  t.alpha = spec.alpha ?? 1;

  const bx = place.x + spec.x;
  const by = place.y + spec.y;
  if (align === "center") {
    t.anchor.set(0.5, 0);
    t.position.set(bx + spec.w / 2, by);
  } else if (align === "right") {
    t.anchor.set(1, 0);
    t.position.set(bx + spec.w, by);
  } else {
    t.position.set(bx, by);
  }
  return t;
}
