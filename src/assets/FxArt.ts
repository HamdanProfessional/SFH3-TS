import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import rig from "./fxRig.json";

export interface FxCell {
  p?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lx: number;
  ly: number;
}

export interface FxDef {
  cid: number;
  files: string[];
  bakeScale: number;
  rotAmt: number;
  frames: number;
  cells: FxCell[];
  subs?: Record<string, number>;
  whitened?: boolean;
  alias?: string;
  tint?: number;
  alpha?: number;
}

interface Rig {
  fx: Record<string, FxDef>;
  note: string;
}

const RIG = rig as unknown as Rig;

const pages = new Map<string, Texture>();
const cells = new Map<string, Texture>();
const loading = new Map<string, Promise<void>>();

export const FxArt = {
  loaded: false,
  rig: RIG,

  names(): string[] {
    return Object.keys(RIG.fx);
  },

  def(name: string): FxDef | null {
    const e = RIG.fx[name];
    if (!e) return null;
    if (!e.alias) return e;
    const owner = RIG.fx[e.alias];
    return owner ? { ...owner, tint: e.tint, alpha: e.alpha } : null;
  },

  has(name: string): boolean {
    return !!RIG.fx[name];
  },

  stageScale(name: string): number {
    return 2 / (this.def(name)?.bakeScale || 1);
  },

  subFrame(name: string, sub: string): number {
    const def = this.def(name);
    if (!def?.subs) return 0;
    let at = 0;
    for (const [label, count] of Object.entries(def.subs)) {
      if (label === sub) return at;
      at += count;
    }
    return 0;
  },

  async loadName(name: string): Promise<void> {
    const owner = RIG.fx[name]?.alias ?? name;
    const def = RIG.fx[owner];
    if (!def?.files) return;
    await Promise.all(def.files.map(async (file, page) => {
      const key = `${owner}#${page}`;
      if (pages.has(key)) return;
      let pending = loading.get(key);
      if (!pending) {
        pending = Assets.load<Texture>(`${ASSET_BASE}/fx/${file}?v=${ASSET_V}`)
          .then((tex) => { pages.set(key, tex); })
          .catch(() => {
          })
          .finally(() => { loading.delete(key); });
        loading.set(key, pending);
      }
      await pending;
    }));
    this.loaded = Object.keys(RIG.fx).every((n) => {
      const own = RIG.fx[RIG.fx[n].alias ?? n];
      return !own?.files
        || own.files.every((_f, page) => pages.has(`${RIG.fx[n].alias ?? n}#${page}`));
    });
  },

  async load(): Promise<void> {
    await Promise.all(Object.keys(RIG.fx).map((n) => this.loadName(n)));
  },

  urls(): string[] {
    const out = new Set<string>();
    for (const def of Object.values(RIG.fx)) {
      for (const file of def.files ?? []) {
        out.add(`${ASSET_BASE}/fx/${file}?v=${ASSET_V}`);
      }
    }
    return [...out];
  },

  cell(name: string, index: number): Texture | null {
    const e = RIG.fx[name];
    const owner = e?.alias ?? name;
    const key = `${owner}#${index}`;
    const hit = cells.get(key);
    if (hit) return hit;

    const def = RIG.fx[owner];
    const c = def?.cells[index];
    if (!def || !c || !c.w || !c.h) return null;
    const page = pages.get(`${owner}#${c.p ?? 0}`);
    if (!page) return null;

    const tex = new Texture({
      source: page.source,
      frame: new Rectangle(c.x, c.y, c.w, c.h),
    });
    cells.set(key, tex);
    return tex;
  },

  subCell(name: string, sub: string): Texture | null {
    return this.cell(name, this.subFrame(name, sub));
  },

  resolve(name: string): { base: string; rot: number; def: FxDef } | null {
    if (RIG.fx[name]) {
      const def = this.def(name);
      return def ? { base: name, rot: 0, def } : null;
    }
    const m = /^(.*?)(\d+)$/.exec(name);
    if (!m) return null;
    const def = this.def(m[1]);
    return def ? { base: m[1], rot: Number(m[2]), def } : null;
  },

  cellIndex(base: string, rot: number, sub: string, frame: number): number {
    const def = this.def(base);
    if (!def) return -1;
    if (def.subs && !(sub in def.subs)) return -1;
    const idx = rot * def.frames + this.subFrame(base, sub) + (frame - 1);
    return idx >= 0 && idx < def.cells.length ? idx : -1;
  },

  subFrames(base: string, sub: string): number {
    const def = this.def(base);
    if (!def) return 0;
    if (def.subs) return def.subs[sub] ?? 0;
    return def.frames;
  },
};
