import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import { BitmapWallMask, type ArenaDef, type RawNode } from "./Arena";
import { getMap, type MapInfo } from "../data/StatsMaps";
import arenaData from "../assets/arenaData.json";
import bgRig from "../assets/bgRig.json";

interface MapArt {
  file: string;
  x: number; y: number;
  w: number; h: number;
}

interface MapWall {
  file: string;
  w: number; h: number;
}

interface MapRadar {
  file: string;
  w: number; h: number;
}

interface MapRecord {
  image: MapArt;
  wall: MapWall;
  radar: MapRadar;
  nodes: RawNode[];
}

interface LayerRecord {
  file: string;
  w: number; h: number;
  lx: number; ly: number;
  useW: number; useH: number;
}

const DATA = arenaData as unknown as { maps: Record<string, MapRecord> };
const BG = bgRig as unknown as {
  maps: Record<string, { bg1: string; bg2: string; sky: string }>;
  bg: Record<string, LayerRecord>;
  sky: Record<string, LayerRecord>;
};

export function mapIds(): string[] {
  return Object.keys(DATA.maps);
}

export function hasMap(id: string): boolean {
  return id in DATA.maps;
}

export interface BgLayer {
  tex: Texture;
  x: number;
  y: number;
  useW: number;
  useH: number;
}

export interface SkyLayer {
  tex: Texture;
  x: number;
  y: number;
}

export interface LoadedMap {
  id: string;
  info: MapInfo;
  def: ArenaDef;
  art: Texture;
  wallTex: Texture;
  wallW: number;
  wallH: number;
  radarTex: Texture;
  artX: number;
  artY: number;
  width: number;
  height: number;
  bg1: BgLayer | null;
  bg2: BgLayer | null;
  sky: SkyLayer | null;
}

function url(path: string): string {
  return `${ASSET_BASE}/${path}?v=${ASSET_V}`;
}

function maskFrom(texture: Texture, width: number, height: number): BitmapWallMask {
  const src = texture.source.resource as CanvasImageSource;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return BitmapWallMask.empty(width, height);
  ctx.drawImage(src, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  return BitmapWallMask.fromRGBA(width, height, rgba);
}

async function bgLayer(label: string): Promise<BgLayer | null> {
  const rec = BG.bg[label];
  if (!rec) return null;
  const tex = await Assets.load<Texture>(url(`bg/${rec.file}`));
  return { tex, x: rec.lx, y: rec.ly, useW: rec.useW, useH: rec.useH };
}

async function skyLayer(label: string): Promise<SkyLayer | null> {
  const rec = BG.sky[label];
  if (!rec) return null;
  const tex = await Assets.load<Texture>(url(`sky/${rec.file}`));
  return { tex, x: rec.lx, y: rec.ly };
}

export function mapAssetUrls(id: string): string[] {
  const rec = DATA.maps[id];
  if (!rec) return [];
  const out = [
    url(`maps/${rec.image.file}`),
    url(`maps/${rec.wall.file}`),
    url(`maps/${rec.radar.file}`),
  ];
  const info = getMap(id);
  const bg1 = info.bg1 ? BG.bg[info.bg1] : null;
  const bg2 = info.bg2 ? BG.bg[info.bg2] : null;
  const sky = info.sky ? BG.sky[info.sky] : null;
  if (bg1) out.push(url(`bg/${bg1.file}`));
  if (bg2) out.push(url(`bg/${bg2.file}`));
  if (sky) out.push(url(`sky/${sky.file}`));
  return out;
}

export function backdropUrls(info: MapInfo): string[] {
  const out: string[] = [];
  const bg1 = info.bg1 ? BG.bg[info.bg1] : null;
  const bg2 = info.bg2 ? BG.bg[info.bg2] : null;
  const sky = info.sky ? BG.sky[info.sky] : null;
  if (bg1) out.push(url(`bg/${bg1.file}`));
  if (bg2) out.push(url(`bg/${bg2.file}`));
  if (sky) out.push(url(`sky/${sky.file}`));
  return out;
}

export async function loadBackdrop(info: MapInfo):
  Promise<Pick<LoadedMap, "bg1" | "bg2" | "sky">> {
  const [bg1, bg2, sky] = await Promise.all([
    info.bg1 ? bgLayer(info.bg1) : Promise.resolve(null),
    info.bg2 ? bgLayer(info.bg2) : Promise.resolve(null),
    info.sky ? skyLayer(info.sky) : Promise.resolve(null),
  ]);
  return { bg1, bg2, sky };
}

const cache = new Map<string, Promise<LoadedMap>>();

export function loadMap(id: string): Promise<LoadedMap> {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = (async (): Promise<LoadedMap> => {
    const rec = DATA.maps[id];
    if (!rec) throw new Error(`no baked map "${id}"`);
    const info = getMap(id);
    const [art, wallTex, radarTex, bg1, bg2, sky] = await Promise.all([
      Assets.load<Texture>(url(`maps/${rec.image.file}`)),
      Assets.load<Texture>(url(`maps/${rec.wall.file}`)),
      Assets.load<Texture>(url(`maps/${rec.radar.file}`)),
      info.bg1 ? bgLayer(info.bg1) : Promise.resolve(null),
      info.bg2 ? bgLayer(info.bg2) : Promise.resolve(null),
      info.sky ? skyLayer(info.sky) : Promise.resolve(null),
    ]);
    const mask = maskFrom(wallTex, rec.wall.w, rec.wall.h);
    return {
      id,
      info,
      def: { wall: mask, nodes: rec.nodes },
      art,
      wallTex,
      wallW: rec.wall.w,
      wallH: rec.wall.h,
      radarTex,
      artX: rec.image.x,
      artY: rec.image.y,
      width: rec.image.w,
      height: rec.image.h,
      bg1,
      bg2,
      sky,
    };
  })();
  cache.set(id, p);
  return p;
}
