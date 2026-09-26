import { Assets, Texture } from "pixi.js";
import extras from "./../assets/menuExtras.json";

export interface ExtraRec {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

const E = extras as unknown as {
  logos: Record<string, ExtraRec>;
  tutorials: Record<string, ExtraRec>;
  deploy: { squadcode: ExtraRec };
};

const BASE = "ui/";
const cache = new Map<string, Texture>();
const pending = new Set<string>();

function tex(rec: ExtraRec | null): Texture {
  if (!rec) return Texture.EMPTY;
  const hit = cache.get(rec.file);
  if (hit) return hit;
  if (!pending.has(rec.file)) {
    pending.add(rec.file);
    Assets.load<Texture>(`${BASE}${rec.file}`)
      .then((t) => void cache.set(rec.file, t))
      .catch(() => void pending.delete(rec.file));
  }
  return Texture.EMPTY;
}

export const EXTRAS_SCALE = 2;

export const MenuExtras = {
  logo(key: "armor" | "notdoppler"): ExtraRec | null {
    return E.logos[key] ?? null;
  },

  tutorial(frame: number): ExtraRec | null {
    return E.tutorials[String(frame)] ?? null;
  },

  squadCode(): ExtraRec | null {
    return E.deploy?.squadcode ?? null;
  },

  texture: tex,
};
