import { Assets, Container, Sprite, Texture } from "pixi.js";

export interface PartRec {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export const PARTS_BASE = "assets/menu-parts/";

const cache = new Map<string, Texture>();
const loading = new Set<string>();
let epoch = 0;

export function partsEpoch(): number {
  return epoch;
}

export function manifestFiles(node: unknown,
                              out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const v of node) manifestFiles(v, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "file" && typeof v === "string") out.add(v);
      else manifestFiles(v, out);
    }
  }
  return out;
}

export async function fillCache(base: string, files: Iterable<string>,
                                into: Map<string, Texture>): Promise<void> {
  await Promise.all([...files].map(async (f) => {
    if (into.has(f)) return;
    try {
      into.set(f, await Assets.load<Texture>(base + f));
    } catch {}
  }));
}

export async function loadParts(files: Iterable<string>): Promise<void> {
  await fillCache(PARTS_BASE, files, cache);
  epoch++;
}

export function partTexture(rec: PartRec | null | undefined): Texture {
  if (!rec) return Texture.EMPTY;
  const hit = cache.get(rec.file);
  if (hit) return hit;
  if (!loading.has(rec.file)) {
    loading.add(rec.file);
    void Assets.load<Texture>(PARTS_BASE + rec.file)
      .then((t) => { cache.set(rec.file, t); epoch++; })
      .catch(() => void loading.delete(rec.file));
  }
  return Texture.EMPTY;
}

export function applyRec(
  sp: Sprite, rec: PartRec, placeX = 1, placeY = placeX,
): void {
  const tex = partTexture(rec);
  if (sp.texture !== tex) sp.texture = tex;
  sp.anchor.set(rec.w ? rec.ox / rec.w : 0, rec.h ? rec.oy / rec.h : 0);
  sp.scale.set(
    (tex.width ? rec.w / tex.width : 1) * placeX,
    (tex.height ? rec.h / tex.height : 1) * placeY,
  );
}

export function partSprite(rec: PartRec | null | undefined): Sprite {
  const sp = new Sprite();
  if (rec) applyRec(sp, rec);
  return sp;
}

export interface ButtonRec {
  states: Partial<Record<"up" | "over" | "down", string>>;
  offX: number;
  offY: number;
  w: number;
  h: number;
}

export class PartButton extends Container {
  readonly w: number;
  readonly h: number;
  readonly rec: ButtonRec;
  private states: Partial<Record<"up" | "over" | "down", Sprite>> = {};
  private state: "up" | "over" | "down" = "up";

  constructor(rec: ButtonRec, x = 0, y = 0) {
    super();
    this.rec = rec;
    this.position.set(x, y);
    this.w = rec.w;
    this.h = rec.h;
    for (const key of ["up", "over", "down"] as const) {
      const file = rec.states[key];
      if (!file) continue;
      const sp = new Sprite();
      sp.position.set(rec.offX, rec.offY);
      sp.width = rec.w;
      sp.height = rec.h;
      sp.visible = key === "up";
      this.addChild(sp);
      this.states[key] = sp;
    }
    if (!this.states.up && this.states.over) this.states.over.visible = true;
  }

  update(): void {
    for (const key of ["up", "over", "down"] as const) {
      const file = this.rec.states[key];
      const sp = this.states[key];
      if (!sp || !file) continue;
      const tex = partTexture({ file, w: 0, h: 0, ox: 0, oy: 0 });
      if (sp.texture !== tex && tex !== Texture.EMPTY) {
        sp.texture = tex;
        sp.width = this.rec.w;
        sp.height = this.rec.h;
      }
    }
  }

  hitBox(): [number, number, number, number] {
    const sx = this.scale.x;
    const sy = this.scale.y;
    return [this.x + this.rec.offX * sx, this.y + this.rec.offY * sy,
            this.w * sx, this.h * sy];
  }

  setState(s: "up" | "over" | "down"): void {
    if (this.state === s) return;
    this.state = s;
    const has = (k: "up" | "over" | "down") => !!this.states[k];
    const show: Record<"up" | "over" | "down", boolean> = {
      up: s === "up" || (s === "over" && !has("over")) || (s === "down" && !has("down") && !has("over")),
      over: s === "over" || (s === "down" && !has("down")),
      down: s === "down",
    };
    for (const key of ["up", "over", "down"] as const) {
      const sp = this.states[key];
      if (sp) sp.visible = show[key];
    }
  }
}
