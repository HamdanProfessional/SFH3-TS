import { MAT, MATERIALS, SOLID } from "./format";
import type { Clip } from "./edit";

export const PIECES = [
  { key: "stairsR", label: "Stairs up →" },
  { key: "stairsL", label: "Stairs up ←" },
  { key: "platform", label: "Platform" },
  { key: "bridge", label: "Bridge" },
  { key: "pillar", label: "Pillar with ledges" },
  { key: "bunker", label: "Bunker" },
  { key: "arch", label: "Arch" },
  { key: "pad", label: "Jump pad" },
] as const;

export type PieceKey = typeof PIECES[number]["key"];

function grid(w: number, h: number): { cells: Uint8Array; set: (x: number, y: number, v: number) => void } {
  const cells = new Uint8Array(w * h);
  return {
    cells,
    set: (x, y, v) => {
      if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = v;
    },
  };
}

function box(set: (x: number, y: number, v: number) => void, x0: number, y0: number, x1: number,
             y1: number, v: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v);
}

function clip(w: number, h: number, cells: Uint8Array): Clip {
  return { w, h, cells, spawns: [], items: [], flags: [], holds: [], jumps: [] };
}

export function makePiece(key: PieceKey, material: number): Clip {
  const mt = MATERIALS[material];
  const v = mt && mt.solid && mt.walkable ? material : SOLID;
  switch (key) {
    case "stairsR":
    case "stairsL": {
      const steps = 6, rise = 2, run = 3;
      const w = steps * run, h = steps * rise;
      const g = grid(w, h);
      for (let i = 0; i < steps; i++) {
        const top = h - (i + 1) * rise;
        const x0 = key === "stairsR" ? i * run : w - (i + 1) * run;
        box(g.set, x0, top, x0 + run - 1, h - 1, v);
      }
      return clip(w, h, g.cells);
    }
    case "platform": {
      const w = 20, h = 2;
      const g = grid(w, h);
      box(g.set, 0, 0, w - 1, h - 1, v);
      return clip(w, h, g.cells);
    }
    case "bridge": {
      const w = 34, h = 10;
      const g = grid(w, h);
      box(g.set, 0, 0, w - 1, 1, v);
      box(g.set, 2, 2, 3, h - 1, v);
      box(g.set, w - 4, 2, w - 3, h - 1, v);
      return clip(w, h, g.cells);
    }
    case "pillar": {
      const w = 12, h = 30;
      const g = grid(w, h);
      box(g.set, 4, 0, 7, h - 1, v);
      for (let i = 0; i < 3; i++) {
        const y = 4 + i * 9;
        if (i % 2 === 0) box(g.set, 0, y, 3, y + 1, v);
        else box(g.set, 8, y, 11, y + 1, v);
      }
      box(g.set, 2, 0, 9, 1, v);
      return clip(w, h, g.cells);
    }
    case "bunker": {
      const w = 34, h = 14;
      const g = grid(w, h);
      box(g.set, 0, 0, w - 1, 1, v);
      box(g.set, 0, 2, 1, 4, v);
      box(g.set, w - 2, 2, w - 1, 4, v);
      box(g.set, 12, 2, 21, 3, v);
      return clip(w, h, g.cells);
    }
    case "arch": {
      const w = 26, h = 16;
      const g = grid(w, h);
      box(g.set, 0, 0, 3, h - 1, v);
      box(g.set, w - 4, 0, w - 1, h - 1, v);
      box(g.set, 0, 0, w - 1, 1, v);
      for (let x = 4; x < w - 4; x++) {
        const t = (x - 4) / (w - 9);
        const d = Math.round(4 * (1 - Math.sin(t * Math.PI)));
        box(g.set, x, 2, x, 1 + d, v);
      }
      return clip(w, h, g.cells);
    }
    case "pad": {
      const w = 8, h = 2;
      const g = grid(w, h);
      box(g.set, 0, 0, w - 1, 0, MAT.jump);
      box(g.set, 0, 1, w - 1, 1, SOLID);
      return clip(w, h, g.cells);
    }
  }
}
