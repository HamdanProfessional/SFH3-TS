import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import { BitmapWallMask, type ArenaDef, type RawNode } from "./Arena";
import { getMap, type MapInfo } from "../data/StatsMaps";
import arenaData from "../assets/arenaData.json";
import bgRig from "../assets/bgRig.json";
import { SVG_TILE, rasterSvg, svgScale, useSvgArt, type ArtTile } from "./svgArt";

interface MapArt {
  file: string;
  x: number; y: number;
  w: number; h: number;
  svg?: string;
  sw?: number; sh?: number;
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
  svg?: string;
  sx?: number; sy?: number;
  sw?: number; sh?: number;
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
  artTiles?: ArtTile[];
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

function svgLayer(rec: LayerRecord): boolean {
  return useSvgArt() && !!rec.svg && rec.sw !== undefined && rec.sh !== undefined;
}

async function layerTexture(dir: string, rec: LayerRecord): Promise<Texture> {
  if (svgLayer(rec)) {
    const scale = Math.min(svgScale(), SVG_TILE / rec.w, SVG_TILE / rec.h);
    try {
      const [tile] = await rasterSvg({
        url: url(`${dir}/${rec.svg}`), sw: rec.sw!, sh: rec.sh!,
        x: rec.sx ?? 0, y: rec.sy ?? 0, w: rec.w, h: rec.h,
      }, scale);
      if (tile) return tile.tex;
    } catch {}
  }
  return Assets.load<Texture>(url(`${dir}/${rec.file}`));
}

function layerUrl(dir: string, rec: LayerRecord): string[] {
  return svgLayer(rec) ? [] : [url(`${dir}/${rec.file}`)];
}

async function bgLayer(label: string): Promise<BgLayer | null> {
  const rec = BG.bg[label];
  if (!rec) return null;
  const tex = await layerTexture("bg", rec);
  return { tex, x: rec.lx, y: rec.ly, useW: rec.useW, useH: rec.useH };
}

async function skyLayer(label: string): Promise<SkyLayer | null> {
  const rec = BG.sky[label];
  if (!rec) return null;
  const tex = await layerTexture("sky", rec);
  return { tex, x: rec.lx, y: rec.ly };
}

function svgMap(art: MapArt): boolean {
  return useSvgArt() && !!art.svg && art.sw !== undefined && art.sh !== undefined;
}

async function mapArt(art: MapArt): Promise<{ art: Texture; artTiles?: ArtTile[] }> {
  if (svgMap(art)) {
    try {
      const artTiles = await rasterSvg({
        url: url(`maps/${art.svg}`), sw: art.sw!, sh: art.sh!, x: 0, y: 0, w: art.w, h: art.h,
      }, svgScale());
      if (artTiles.length) return { art: Texture.EMPTY, artTiles };
    } catch {}
  }
  return { art: await Assets.load<Texture>(url(`maps/${art.file}`)) };
}

export function mapAssetUrls(id: string): string[] {
  const rec = DATA.maps[id];
  if (!rec) return [];
  const out = [
    ...(svgMap(rec.image) ? [] : [url(`maps/${rec.image.file}`)]),
    url(`maps/${rec.wall.file}`),
    url(`maps/${rec.radar.file}`),
  ];
  return [...out, ...backdropUrls(getMap(id))];
}

export function backdropUrls(info: MapInfo): string[] {
  const out: string[] = [];
  const bg1 = info.bg1 ? BG.bg[info.bg1] : null;
  const bg2 = info.bg2 ? BG.bg[info.bg2] : null;
  const sky = info.sky ? BG.sky[info.sky] : null;
  if (bg1) out.push(...layerUrl("bg", bg1));
  if (bg2) out.push(...layerUrl("bg", bg2));
  if (sky) out.push(...layerUrl("sky", sky));
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

export interface StockArtRect {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function stockArtRect(id: string): StockArtRect | null {
  const rec = DATA.maps[id];
  if (!rec) return null;
  return { url: url(`maps/${rec.image.file}`), x: rec.image.x, y: rec.image.y, w: rec.image.w, h: rec.image.h };
}

export async function loadStockArt(id: string):
  Promise<Pick<LoadedMap, "art" | "artX" | "artY" | "width" | "height"> | null> {
  const r = stockArtRect(id);
  if (!r) return null;
  const art = await Assets.load<Texture>(r.url);
  return { art, artX: r.x, artY: r.y, width: r.w, height: r.h };
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
      mapArt(rec.image),
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
      ...art,
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
