import { Assets, Texture } from "pixi.js";
import { ASSET_V } from "../core/Config";
import { screenDensity } from "../core/device";
import { manifestFiles } from "./menuParts";
import rig from "./menuRig.json";
import info from "./menuInfo.json";

export interface TexRec {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  bb?: [number, number, number, number];
}

export interface Nested {
  cid: number;
  m: number[];
}

export interface LimbRec extends TexRec {
  stow?: Nested;
}

export interface HeadRec {
  tex: TexRec;
  face?: Nested;
  hair?: Nested;
  skin?: Nested;
}

export interface FaceRec extends TexRec {
  skin?: Nested;
}

interface MenuRigData {
  timeline: { frames: (string | number)[][][] };
  costumeFrames: number[];
  parts: Record<string, Record<string, LimbRec>>;
  heads: Record<string, HeadRec>;
  faces: Record<string, Record<string, FaceRec>>;
  skins: Record<string, Record<string, TexRec>>;
  hairs: Record<string, Record<string, TexRec>>;
  guns: Record<string, TexRec>;
  stows: Record<string, TexRec>;
  gunLabels: Record<string, number>;
  animLabels: Record<string, number>;
  shadow: TexRec;
  hi?: string;
}

export interface InfoField {
  x: number; y: number;
  sx: number; sy: number;
  cid?: number;
  spec?: {
    font?: string; size?: number; color?: number; alpha?: number;
    align?: string; leading?: number; w?: number; h?: number;
    x?: number; y?: number;
  };
}

export interface InfoRec extends TexRec {
  fields: Record<string, InfoField>;
}

const R = rig as unknown as MenuRigData;
const INFO = info as unknown as Record<string, InfoRec> & { bar?: TexRec };

const BASE = "assets/menu-parts/";
const RIG_FILES = manifestFiles(R);
const MENU_HI_AT = 1.25;
const cache = new Map<string, Texture>();
const pending = new Map<string, Promise<unknown>>();
let epoch = 0;
let hiMenu: boolean | null = null;

function url(file: string): string {
  hiMenu ??= !!R.hi && screenDensity() > MENU_HI_AT;
  return `${BASE}${hiMenu && RIG_FILES.has(file) ? R.hi : ""}${file}?v=${ASSET_V}`;
}

export function rigEpoch(): number {
  return epoch;
}

export function rigArtUrls(): string[] {
  return [...manifestFiles(INFO, manifestFiles(R))].map(url);
}

export async function loadRigArt(): Promise<void> {
  await Promise.all([...manifestFiles(INFO, manifestFiles(R))].map(async (f) => {
    if (cache.has(f)) return;
    try {
      cache.set(f, await Assets.load<Texture>(url(f)));
    } catch {}
  }));
  epoch++;
}

export const MenuRig = {
  data: R,
  costumeFrames: R.costumeFrames,

  get frameCount(): number {
    return R.timeline.frames.length;
  },

  texture(rec: TexRec | null | undefined): Texture {
    if (!rec) return Texture.EMPTY;
    const hit = cache.get(rec.file);
    if (hit) return hit;
    if (!pending.has(rec.file)) {
      pending.set(rec.file, Assets.load<Texture>(url(rec.file))
        .then((t) => { cache.set(rec.file, t); epoch++; })
        .catch(() => void pending.delete(rec.file)));
    }
    return Texture.EMPTY;
  },

  limb(part: string, frame: number): LimbRec | null {
    return R.parts[part]?.[String(frame)] ?? null;
  },

  head(frame: number): HeadRec | null {
    return R.heads[String(frame)] ?? null;
  },

  face(cid: number, frame: number): FaceRec | null {
    return R.faces[String(cid)]?.[String(frame)] ?? null;
  },

  skin(cid: number, frame: number): TexRec | null {
    return R.skins[String(cid)]?.[String(frame)] ?? null;
  },

  hair(cid: number, frame: number): TexRec | null {
    return R.hairs[String(cid)]?.[String(frame)] ?? null;
  },

  gun(frame: number): TexRec | null {
    return R.guns[String(frame)] ?? null;
  },

  stow(frame: number): TexRec | null {
    return R.stows[String(frame)] ?? null;
  },

  gunFrame(id: string, rarity = 0): number {
    const frame = R.gunLabels[id];
    if (!frame) return -1;
    return frame + (rarity >= 0 && rarity <= 3 ? rarity : 0);
  },

  info(state: number): InfoRec | null {
    return INFO[String(state)] ?? null;
  },

  get bar(): TexRec | null {
    return INFO.bar ?? null;
  },
};
