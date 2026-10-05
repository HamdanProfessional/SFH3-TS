import { CanvasSource, Texture } from "pixi.js";
import { isPhone, screenDensity } from "../core/device";

export interface ArtTile {
  tex: Texture;
  x: number;
  y: number;
}

export interface SvgCrop {
  url: string;
  sw: number;
  sh: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SVG_TILE = 4096;
const MAX_SCALE = isPhone ? 1.5 : 2;

export function svgScale(): number {
  return Math.min(MAX_SCALE, screenDensity());
}

export function useSvgArt(): boolean {
  return svgScale() > 1.05;
}

function sized(svg: string, sw: number, sh: number, scale: number): string {
  const end = svg.indexOf(">", svg.indexOf("<svg"));
  if (end < 0) throw new Error("not an svg");
  let root = svg.slice(0, end);
  root = root.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "");
  if (!/\sviewBox=/.test(root)) root += ` viewBox="0 0 ${sw / 2} ${sh / 2}"`;
  root += ` width="${sw * scale}" height="${sh * scale}" preserveAspectRatio="none"`;
  return root + svg.slice(end);
}

export async function rasterSvg(c: SvgCrop, scale: number): Promise<ArtTile[]> {
  const res = await fetch(c.url);
  if (!res.ok) throw new Error(`${c.url}: ${res.status}`);
  const blob = new Blob([sized(await res.text(), c.sw, c.sh, scale)], { type: "image/svg+xml" });
  const src = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const W = Math.ceil(c.w * scale);
    const H = Math.ceil(c.h * scale);
    const out: ArtTile[] = [];
    for (let ty = 0; ty < H; ty += SVG_TILE) {
      for (let tx = 0; tx < W; tx += SVG_TILE) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(SVG_TILE, W - tx);
        canvas.height = Math.min(SVG_TILE, H - ty);
        const g = canvas.getContext("2d");
        if (!g) throw new Error("no 2d canvas");
        g.drawImage(img, -c.x * scale - tx, -c.y * scale - ty, c.sw * scale, c.sh * scale);
        out.push({
          tex: new Texture({ source: new CanvasSource({ resource: canvas, resolution: scale }) }),
          x: tx / scale,
          y: ty / scale,
        });
      }
    }
    return out;
  } finally {
    URL.revokeObjectURL(src);
  }
}
