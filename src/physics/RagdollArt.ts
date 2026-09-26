import { Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import { MenuRig } from "../assets/MenuRig";
import rig from "../assets/ragdollRig.json";

export type PartKind =
  | "body" | "head" | "hand" | "foot"
  | "upperArm" | "lowerArm" | "upperLeg" | "lowerLeg";

export interface Costume {
  body: number;
  head: number;
  skin: number;
  face: number;
  hair: number;
}

interface SheetRec {
  file: string;
  w: number;
  h: number;
}

interface LayerRec {
  name: string;
  cid: number;
  m: number[];
}

type OrderItem = number | "base";

interface ClipRec {
  cid: number;
  cell: [number, number];
  origin: [number, number];
  cols: number;
  perPage: number;
  sheets: SheetRec[];
  frames: Record<string, number>;
  layers?: Record<string, LayerRec[]>;
  order?: Record<string, OrderItem[]>;
  gunRuns?: { from: number; cid: number; m: number[] }[];
}

interface Rig {
  frameMin: number;
  frameMax: number;
  clips: Record<PartKind, ClipRec>;
  layerClips: Record<string, ClipRec>;
}

const RIG = rig as unknown as Rig;

const sheets = new Map<string, Texture>();
const texCache = new Map<string, Texture>();
const maxFrameCache = new Map<string, number>();

function clipRec(key: string): ClipRec | null {
  return RIG.clips[key as PartKind] ?? RIG.layerClips[key] ?? null;
}

function clampFrame(rec: ClipRec, frame: number): number {
  const f = Math.round(frame);
  if (rec.frames[String(f)] !== undefined) return f;
  let max = maxFrameCache.get(String(rec.cid));
  if (max === undefined) {
    max = RIG.frameMin;
    for (const k of Object.keys(rec.frames)) max = Math.max(max, Number(k));
    maxFrameCache.set(String(rec.cid), max);
  }
  if (f < RIG.frameMin) return RIG.frameMin;
  if (f > max) return max;
  for (let d = 1; d <= 8; d++) {
    if (f - d >= RIG.frameMin && rec.frames[String(f - d)] !== undefined) return f - d;
    if (rec.frames[String(f + d)] !== undefined) return f + d;
  }
  return RIG.frameMin;
}

function layerFrame(name: string, costume: Costume): number {
  switch (name) {
    case "skin": return costume.skin;
    case "face": return costume.face;
    case "hair": return costume.hair;
    case "robot": return 1;
    default: return 1;
  }
}

function texture(key: string, cell: number): Texture | null {
  const rec = clipRec(key);
  if (!rec) return null;
  const cacheKey = `${key}#${cell}`;
  const hit = texCache.get(cacheKey);
  if (hit) return hit;
  const page = Math.floor(cell / rec.perPage);
  const sheet = sheets.get(rec.sheets[page]?.file ?? rec.sheets[0]?.file ?? "");
  if (!sheet) return null;
  const local = cell % rec.perPage;
  const col = local % rec.cols;
  const row = Math.floor(local / rec.cols);
  const tex = new Texture({
    source: sheet.source,
    frame: new Rectangle(col * rec.cell[0], row * rec.cell[1], rec.cell[0], rec.cell[1]),
  });
  texCache.set(cacheKey, tex);
  return tex;
}

function baseSprite(key: string, frame: number): Sprite | null {
  const rec = clipRec(key);
  if (!rec) return null;
  const cell = rec.frames[String(frame)];
  if (cell === undefined) return null;
  const tex = texture(key, cell);
  if (!tex) return null;
  const sp = new Sprite(tex);
  sp.anchor.set(rec.origin[0] / rec.cell[0], rec.origin[1] / rec.cell[1]);
  return sp;
}

function buildClip(target: Container, key: string, frame: number, costume: Costume): void {
  const rec = clipRec(key);
  if (!rec) return;
  const f = clampFrame(rec, frame);
  const order = rec.order?.[String(f)] ?? ["base"];
  const layers = rec.layers?.[String(f)] ?? [];
  for (const item of order) {
    if (item === "base") {
      const sp = baseSprite(key, f);
      if (sp) target.addChild(sp);
      continue;
    }
    const lay = layers[item];
    if (!lay) continue;
    const [a, b, c, d, tx, ty] = lay.m;
    const holder = new Container();
    holder.position.set(tx, ty);
    holder.rotation = Math.atan2(b, a);
    const sx = Math.hypot(a, b) || 1;
    holder.scale.set(sx, (a * d - b * c) / sx);
    buildClip(holder, `${lay.name}:${lay.cid}`, layerFrame(lay.name, costume), costume);
    target.addChild(holder);
  }
}

let loading: Promise<void> | null = null;

export function ragdollArtUrls(): string[] {
  const files = new Set<string>();
  for (const rec of [...Object.values(RIG.clips), ...Object.values(RIG.layerClips)]) {
    for (const s of rec.sheets) files.add(s.file);
  }
  return [...files].map((f) => `${ASSET_BASE}/ragdoll/${f}?v=${ASSET_V}`);
}

export function loadRagdollArt(): Promise<void> {
  if (loading) return loading;
  const files = new Set<string>();
  for (const rec of [...Object.values(RIG.clips), ...Object.values(RIG.layerClips)]) {
    for (const s of rec.sheets) files.add(s.file);
  }
  loading = Promise.all(
    [...files].map(async (file) => {
      try {
        const tex = await Assets.load<Texture>(`${ASSET_BASE}/ragdoll/${file}?v=${ASSET_V}`);
        sheets.set(file, tex);
      } catch {
      }
    }),
  ).then(() => undefined);
  return loading;
}

export function buildPartView(target: Container, kind: PartKind, costume: Costume): void {
  buildClip(target, kind, kind === "head" ? costume.head : costume.body, costume);
}

export interface HolsterView {
  root: Container;
  tick(): void;
}

export function holsterView(
  kind: PartKind, costumeFrame: number, gunId: string,
): HolsterView | null {
  const runs = clipRec(kind)?.gunRuns;
  if (!runs?.length) return null;
  const run = runs.find((r, i) =>
    costumeFrame >= r.from
    && (i + 1 === runs.length || costumeFrame < runs[i + 1].from));
  if (!run) return null;
  const frame = MenuRig.gunFrame(gunId);
  if (frame < 0) return null;
  const art = run.cid === 1362 ? MenuRig.stow(frame) : MenuRig.gun(frame);
  if (!art) return null;
  const sp = new Sprite(Texture.EMPTY);
  sp.anchor.set(art.ox / (art.w || 1), art.oy / (art.h || 1));
  sp.position.set(run.m[4], run.m[5]);
  sp.rotation = Math.atan2(run.m[1], run.m[0]);
  const baseSx = Math.hypot(run.m[0], run.m[1]) || 1;
  const baseSy = (run.m[0] * run.m[3] - run.m[1] * run.m[2]) / baseSx;
  const apply = (): void => {
    const t = MenuRig.texture(art);
    if (t === Texture.EMPTY) return;
    sp.texture = t;
    const k = t.width > 1 && art.w ? art.w / t.width : 1;
    sp.scale.set(baseSx * k, baseSy * k);
  };
  apply();
  const root = new Container();
  root.addChild(sp);
  return { root, tick: apply };
}
