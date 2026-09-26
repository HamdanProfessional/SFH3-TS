import { Texture } from "pixi.js";
import { getMap, type MapInfo } from "../data/StatsMaps";
import { loadBackdrop, type LoadedMap } from "../game/maps";
import { CELL, MAT, MATERIALS, SOLID, type CustomMap } from "./format";
import { buildArena } from "./build";

export const THEMES: readonly { key: string; label: string; tint: number }[] = [
  { key: "concrete", label: "Concrete", tint: 0x8a8f99 },
  { key: "rock", label: "Rock", tint: 0x8b6b4a },
  { key: "metal", label: "Metal", tint: 0x5d7084 },
  { key: "jungle", label: "Jungle", tint: 0x5a7d3a },
  { key: "sand", label: "Sand", tint: 0xc2a36b },
  { key: "lava", label: "Basalt", tint: 0x4a3a3a },
];

export function themeTint(key: string): number {
  return (THEMES.find((t) => t.key === key) ?? THEMES[0]).tint;
}

export function cellTint(id: number, theme: string): number {
  return id === SOLID ? themeTint(theme) : MATERIALS[id]?.tint ?? 0;
}

function css(rgb: number, alpha = 1): string {
  return `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${alpha})`;
}

export function shade(rgb: number, k: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k + (k > 1 ? 18 : 0))));
  return (c((rgb >> 16) & 255) << 16) | (c((rgb >> 8) & 255) << 8) | c(rgb & 255);
}

function forRuns(m: CustomMap, fn: (x: number, y: number, n: number, id: number) => void): void {
  for (let y = 0; y < m.h; y++) {
    let x = 0;
    while (x < m.w) {
      const id = m.cells[y * m.w + x];
      let n = 1;
      while (x + n < m.w && m.cells[y * m.w + x + n] === id) n++;
      if (id) fn(x, y, n, id);
      x += n;
    }
  }
}

function speckle(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
    const r = 1 + Math.floor(rnd() * 3);
    g.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), r, r);
  }
  return c;
}

export function paintTerrain(m: CustomMap): HTMLCanvasElement {
  const W = m.w * CELL;
  const H = m.h * CELL;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < m.w && y < m.h && !!MATERIALS[m.cells[y * m.w + x]]?.solid;

  const back = shade(themeTint(m.theme), 0.45);
  g.fillStyle = css(back, 0.9);
  forRuns(m, (x, y, n, id) => {
    if (id === 2) g.fillRect(x * CELL, y * CELL, n * CELL, CELL);
  });
  g.fillStyle = css(MATERIALS[MAT.lowfield].tint, 0.16);
  forRuns(m, (x, y, n, id) => {
    if (id === MAT.lowfield) g.fillRect(x * CELL, y * CELL, n * CELL, CELL);
  });
  g.fillStyle = css(MATERIALS[MAT.lowfield].tint, 0.35);
  forRuns(m, (x, y, n, id) => {
    if (id !== MAT.lowfield || y % 4) return;
    for (let i = x; i < x + n; i++) if ((i + y) % 7 === 0) g.fillRect(i * CELL + 4, y * CELL, 2, CELL * 2);
  });

  g.fillStyle = "rgba(10,12,16,0.95)";
  forRuns(m, (x, y, n, id) => {
    if (MATERIALS[id]?.solid) g.fillRect(x * CELL - 2, y * CELL - 2, n * CELL + 4, CELL + 4);
  });

  const fill = document.createElement("canvas");
  fill.width = W;
  fill.height = H;
  const f = fill.getContext("2d")!;
  forRuns(m, (x, y, n, id) => {
    if (!MATERIALS[id]?.solid) return;
    f.fillStyle = css(cellTint(id, m.theme), id === 6 ? 0.85 : 1);
    f.fillRect(x * CELL, y * CELL, n * CELL, CELL);
  });
  f.globalCompositeOperation = "source-atop";
  const pat = f.createPattern(speckle(), "repeat");
  if (pat) { f.fillStyle = pat; f.fillRect(0, 0, W, H); }
  const grad = f.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(255,255,255,0.06)");
  grad.addColorStop(1, "rgba(0,0,0,0.25)");
  f.fillStyle = grad;
  f.fillRect(0, 0, W, H);
  f.globalCompositeOperation = "source-over";

  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const id = m.cells[y * m.w + x];
      if (!MATERIALS[id]?.solid) continue;
      const tint = cellTint(id, m.theme);
      if (!solid(x, y - 1)) {
        f.fillStyle = css(shade(tint, 1.35));
        f.fillRect(x * CELL, y * CELL, CELL, 3);
        if (id === 10) {
          f.fillStyle = "rgba(20,0,0,0.9)";
          f.beginPath();
          f.moveTo(x * CELL, y * CELL + 3);
          f.lineTo(x * CELL + CELL / 2, y * CELL - 6);
          f.lineTo(x * CELL + CELL, y * CELL + 3);
          f.fill();
        } else if (id === 4 && x % 3 === 0) {
          f.fillStyle = "rgba(255,255,255,0.8)";
          f.fillRect(x * CELL + 4, y * CELL + 4, 2, 4);
        } else if (id === 7 && x % 2 === 0) {
          f.fillStyle = "rgba(40,30,0,0.6)";
          f.fillRect(x * CELL + 3, y * CELL + 4, 5, 2);
        }
      }
      if (!solid(x, y + 1)) {
        f.fillStyle = css(shade(tint, 0.55));
        f.fillRect(x * CELL, y * CELL + CELL - 2, CELL, 2);
      }
    }
  }
  g.drawImage(fill, 0, 0);
  fill.width = fill.height = 0;
  return canvas;
}

export function paintRadar(m: CustomMap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = m.w;
  c.height = m.h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(m.w, m.h);
  for (let i = 0; i < m.cells.length; i++) {
    const argb = MATERIALS[m.cells[i]]?.argb ?? 0;
    img.data[i * 4] = (argb >>> 16) & 255;
    img.data[i * 4 + 1] = (argb >>> 8) & 255;
    img.data[i * 4 + 2] = argb & 255;
    img.data[i * 4 + 3] = (argb >>> 24) & 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function customInfo(m: CustomMap): MapInfo {
  const base = getMap(m.backdrop);
  return {
    id: "custom", map: "custom", bg1: base.bg1, bg2: base.bg2, sky: base.sky,
    particles: base.particles, name: m.name, phys: "", extra: "", water: 0,
  };
}

export async function loadCustomMap(m: CustomMap, mode: string): Promise<LoadedMap> {
  const info = customInfo(m);
  const backdrop = await loadBackdrop(info);
  const art = Texture.from(paintTerrain(m));
  const radarTex = Texture.from(paintRadar(m));
  const W = m.w * CELL;
  const H = m.h * CELL;
  return {
    id: "custom",
    info,
    def: buildArena(m, mode),
    art,
    wallTex: radarTex,
    wallW: W,
    wallH: H,
    radarTex,
    artX: 0,
    artY: 0,
    width: W,
    height: H,
    ...backdrop,
  };
}
