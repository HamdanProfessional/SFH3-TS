import { Assets, Texture } from "pixi.js";
import { fillCache, manifestFiles } from "./menuParts";
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
const cache = new Map<string, Texture>();
const pending = new Map<string, Promise<unknown>>();
let epoch = 0;

export function rigEpoch(): number {
  return epoch;
}

export function rigArtUrls(): string[] {
  return [...manifestFiles(INFO, manifestFiles(R))].map((f) => BASE + f);
}

export async function loadRigArt(): Promise<void> {
  await fillCache(BASE, manifestFiles(INFO, manifestFiles(R)), cache);
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
      pending.set(rec.file, Assets.load<Texture>(`${BASE}${rec.file}`)
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
