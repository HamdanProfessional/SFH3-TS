import arena from "../assets/arenaData.json";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import { MAP_ORDER, getMap } from "../data/StatsMaps";
import {
  AIR, CELL, ITEM_KINDS, MAX_H, MAX_HOLDS, MAX_ITEMS, MAX_SPAWNS, MAX_W, MIN_H, MIN_W, SOLID,
  MAX_JUMPS, type CustomMap, type EdFlag, type EdHold, type EdItem, type EdJump, type EdSpawn,
  type ItemKind,
} from "./format";

interface ArenaNode { kind: string; name: string; x: number; y: number; width?: number; height?: number }
interface ArenaRec { wall: { file: string; w: number; h: number }; nodes: ArenaNode[] }
const ARENAS = (arena as unknown as { maps: Record<string, ArenaRec> }).maps;

const THEME: Readonly<Record<string, string>> = {
  street: "concrete", factory: "metal", canyon: "sand", caves: "rock", forest: "jungle",
  cavesb: "rock", cqc: "concrete", frigate: "metal", construction: "concrete",
  junkyard: "metal", temple: "rock", volcano: "lava", gorge: "sand",
};

const SOLID_SURFACE: Readonly<Record<string, number>> = {
  ff6699: 3, ff6666: 3,
  "00ffff": 4,
  ffffff: 5,
  "6699ff": 6,
  "999966": 7,
  "33cc99": 9, "32cb99": 9,
};
const DEATH = new Set(["330000", "320000", "2c0000", "2a0000", "2e0000", "2b0000", "2f0000", "2d0000"]);
const LOW_GRAV = new Set(["3360ff", "3363ff", "3262ff", "3366ff", "3369ff"]);
const PIT = 10;
const LOW_FIELD = 11;

export function stockMaps(): { id: string; name: string }[] {
  return MAP_ORDER.filter((id) => ARENAS[id]).map((id) => {
    const n = getMap(id).name;
    return { id, name: n.charAt(0).toUpperCase() + n.slice(1) };
  });
}

function isSolid(pixel32: number): boolean {
  if (!pixel32) return false;
  const hex = (pixel32 >>> 0).toString(16);
  return hex.substring(0, 2) === "ff" && hex.substring(2).indexOf("00000") === -1;
}

async function maskPixels(file: string): Promise<ImageData> {
  const img = new Image();
  img.src = `${ASSET_BASE}/maps/${file}?v=${ASSET_V}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("no 2d canvas");
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

export async function importStockMap(id: string): Promise<CustomMap> {
  const rec = ARENAS[id];
  if (!rec) throw new Error(`no campaign map "${id}"`);
  const px = await maskPixels(rec.wall.file);
  const W = Math.max(MIN_W, Math.min(MAX_W, Math.ceil(px.width / CELL)));
  const H = Math.max(MIN_H, Math.min(MAX_H, Math.ceil(px.height / CELL)));
  const cells = new Uint8Array(W * H);
  const d = px.data;
  const votes = new Map<number, number>();
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      votes.clear();
      let total = 0;
      let solid = 0;
      for (let y = cy * CELL; y < (cy + 1) * CELL && y < px.height; y++) {
        for (let x = cx * CELL; x < (cx + 1) * CELL && x < px.width; x++) {
          const o = (y * px.width + x) * 4;
          const a = d[o + 3];
          const rgb = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
          const key = rgb.toString(16).padStart(6, "0");
          ++total;
          let mat = AIR;
          if (isSolid(((a << 24) | rgb) >>> 0)) {
            ++solid;
            mat = DEATH.has(key) ? PIT : SOLID_SURFACE[key] ?? SOLID;
          } else if (a > 0 && DEATH.has(key)) {
            mat = PIT;
          } else if (a > 0 && LOW_GRAV.has(key)) {
            mat = LOW_FIELD;
          }
          if (mat !== AIR) votes.set(mat, (votes.get(mat) ?? 0) + 1);
        }
      }
      if (!total) continue;
      let best = AIR;
      let bestN = 0;
      for (const [m, n] of votes) if (n > bestN) { best = m; bestN = n; }
      const isField = best === LOW_FIELD || (best === PIT && solid * 2 < total);
      if (isField ? bestN * 2 >= total : solid * 2 >= total) cells[cy * W + cx] = best;
    }
  }

  const inside = (n: ArenaNode): boolean =>
    n.x >= 0 && n.y >= 0 && n.x < W * CELL && n.y < H * CELL;
  const digit = (s: string): number => Number(s.charAt(s.length - 1));

  const spawns: EdSpawn[] = [];
  const items: EdItem[] = [];
  const flags: EdFlag[] = [];
  const holds: EdHold[] = [];
  const jumps: EdJump[] = [];
  const wps = new Map<string, ArenaNode>();
  for (const n of rec.nodes) if (n.kind === "waypoint") wps.set(n.name.split("_")[0], n);
  for (const a of wps.values()) {
    for (const id of a.name.split("_")[1] ?? "") {
      const t = wps.get(id);
      if (!t || t === a || jumps.length >= MAX_JUMPS) continue;
      jumps.push({
        x: Math.round(a.x), y: Math.round(a.y), tx: Math.round(t.x), ty: Math.round(t.y), walk: true,
      });
    }
  }
  for (const n of rec.nodes) {
    if (n.kind !== "aiaction" || !n.name.startsWith("j_")) continue;
    const bw = n.width ?? 85;
    const bh = n.height ?? 80;
    for (const id of n.name.slice(2)) {
      const t = wps.get(id);
      if (!t || jumps.length >= MAX_JUMPS) continue;
      jumps.push({
        x: Math.round(n.x + bw / 2), y: Math.round(n.y + bh - 8),
        tx: Math.round(t.x), ty: Math.round(t.y),
      });
    }
  }
  for (const n of rec.nodes) {
    if (!inside(n)) continue;
    const x = Math.round(n.x), y = Math.round(n.y);
    if (n.kind === "spawn" && spawns.length < MAX_SPAWNS) {
      const t = digit(n.name);
      spawns.push({ x, y, team: t === 1 || t === 2 ? t : 0 });
    } else if (n.kind === "pickup" && items.length < MAX_ITEMS) {
      const kind = n.name.replace(/^\$/, "").split("_")[0] as ItemKind;
      if ((ITEM_KINDS as readonly string[]).includes(kind)) items.push({ x, y, kind });
    } else if (n.kind === "ctfflag") {
      const t = digit(n.name);
      if ((t === 1 || t === 2) && !flags.some((f) => f.team === t)) flags.push({ x, y, team: t });
    } else if (n.kind === "holdpoint" && holds.length < MAX_HOLDS) {
      holds.push({ x, y });
    }
  }

  const name = stockMaps().find((m) => m.id === id)?.name ?? id;
  return {
    name, w: W, h: H, backdrop: id, theme: THEME[id] ?? "concrete", cells,
    spawns, items, flags, holds, stock: id, stockArt: true, jumps,
  };
}
