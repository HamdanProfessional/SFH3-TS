import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng } from "./png";
import { BitmapWallMask, type ArenaDef, type RawNode } from "../src/game/Arena";
import arenaData from "../src/assets/arenaData.json";

interface MapRecord {
  wall: { file: string; w: number; h: number };
  nodes: RawNode[];
}

const DATA = arenaData as unknown as { maps: Record<string, MapRecord> };

export const SERVER_MAP_IDS: readonly string[] = Object.keys(DATA.maps);

const cache = new Map<string, ArenaDef>();

export function loadServerMap(id: string, assetDir: string): ArenaDef {
  const hit = cache.get(id);
  if (hit) return hit;
  const rec = DATA.maps[id];
  if (!rec) throw new Error(`no baked map "${id}"`);

  const png = decodePng(readFileSync(join(assetDir, "maps", rec.wall.file)));
  if (png.width !== rec.wall.w || png.height !== rec.wall.h) {
    throw new Error(
      `${rec.wall.file} is ${png.width}x${png.height}, `
      + `arenaData says ${rec.wall.w}x${rec.wall.h}`,
    );
  }

  const def: ArenaDef = {
    wall: BitmapWallMask.fromRGBA(png.width, png.height, png.data),
    nodes: rec.nodes,
  };
  cache.set(id, def);
  return def;
}
