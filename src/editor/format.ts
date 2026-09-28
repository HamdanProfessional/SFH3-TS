export const CELL = 10;

export const MIN_W = 120;
export const MAX_W = 400;
export const MIN_H = 60;
export const MAX_H = 200;

export const MAX_SPAWNS = 32;
export const MAX_ITEMS = 24;
export const MAX_HOLDS = 5;
export const MAX_NAME = 32;
export const MAX_RLE = 96 * 1024;

export const FORMAT_VERSION = 7;
const READS = [1, 2, 3, 4, 5, 6, 7];

export interface Material {
  id: number;
  key: string;
  label: string;
  argb: number;
  tint: number;
  solid: boolean;
  walkable: boolean;
  hint: string;
  legacy?: boolean;
}

export const MATERIALS: readonly Material[] = [
  { id: 0, key: "air", label: "Air", argb: 0x00000000, tint: 0x000000,
    solid: false, walkable: false, hint: "Empty space" },
  { id: 1, key: "solid", label: "Ground", argb: 0xffff0000, tint: 0x8a8f99,
    solid: true, walkable: true, hint: "Plain solid ground" },
  { id: 2, key: "back", label: "Back wall", argb: 0x80ff0000, tint: 0x3a3f4a,
    solid: false, walkable: false, hint: "Scenery only: drawn, never collides" },
  { id: 3, key: "bounce", label: "Bounce", argb: 0xffff6699, tint: 0xff6699,
    solid: true, walkable: false, hint: "Trampoline: throws you up on contact" },
  { id: 4, key: "jump", label: "Jump pad", argb: 0xff00ffff, tint: 0x00e5ff,
    solid: true, walkable: true, hint: "Jumps from here go 1.8x higher" },
  { id: 5, key: "snow", label: "Snow", argb: 0xffffffff, tint: 0xf2f6fa,
    solid: true, walkable: true, hint: "Brakes hard, kicks up snow" },
  { id: 6, key: "water", label: "Water", argb: 0xff6699ff, tint: 0x4a7fe0,
    solid: true, walkable: true, hint: "Slow, low jumps, puts out fire" },
  { id: 7, key: "conveyor", label: "Conveyor", argb: 0xff999966, tint: 0xb3a35a,
    solid: true, walkable: true, hint: "Pushes everything right" },
  { id: 8, key: "lowgrav", label: "Low-grav floor", argb: 0xff3363ff, tint: 0x9a6bff,
    solid: true, walkable: true, hint: "Old maps only: plays as plain ground", legacy: true },
  { id: 9, key: "safe", label: "Soft landing", argb: 0xff33cc99, tint: 0x33cc99,
    solid: true, walkable: true, hint: "No hard landing from any height" },
  { id: 10, key: "pit", label: "Death pit", argb: 0xff330000, tint: 0xb3261e,
    solid: true, walkable: false, hint: "Instant death on touch" },
  { id: 11, key: "lowfield", label: "Low gravity", argb: 0x803363ff, tint: 0x9a6bff,
    solid: false, walkable: false, hint: "Passable field: half gravity while you are inside it" },
];

export const MAT = { bounce: 3, jump: 4, water: 6, conveyor: 7, lowfield: 11 } as const;

export const AIR = 0;
export const SOLID = 1;

export const ITEM_KINDS = [
  "health", "healthbig", "ammo", "ammobig", "armor", "armorbig",
] as const;
export type ItemKind = typeof ITEM_KINDS[number];
export const ITEM_RESPAWN = 10;

export interface EdSpawn { x: number; y: number; team: 0 | 1 | 2 }
export interface EdItem { x: number; y: number; kind: ItemKind }
export interface EdFlag { x: number; y: number; team: 1 | 2 }
export interface EdHold { x: number; y: number }

export interface CustomMap {
  name: string;
  w: number;
  h: number;
  backdrop: string;
  theme: string;
  cells: Uint8Array;
  spawns: EdSpawn[];
  items: EdItem[];
  flags: EdFlag[];
  holds: EdHold[];
  mission?: EdMission | null;
  stock?: string;
  stockArt?: boolean;
  jumps?: EdJump[];
  decals?: EdDecal[];
}

export interface EdDecal {
  src: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  x: number;
  y: number;
  fx?: boolean;
  fy?: boolean;
}

export const MAX_DECALS = 64;
export const MAX_DECAL_SIDE = 2400;

export interface EdJump { x: number; y: number; tx: number; ty: number; walk?: boolean }

export const MAX_JUMPS = 160;

export interface MapWire {
  v: number;
  name: string;
  w: number;
  h: number;
  backdrop: string;
  theme: string;
  rle: string;
  spawns: [number, number, number][];
  items: [number, number, string][];
  flags?: [number, number, number][];
  holds?: [number, number][];
  mission?: EdMission;
  stock?: string;
  stockArt?: boolean;
  jumps?: ([number, number, number, number] | [number, number, number, number, number])[];
  decals?: [string, number, number, number, number, number, number, number][];
}

export const SIZE_PRESETS: readonly { label: string; w: number; h: number }[] = [
  { label: "Small (1600 x 1000)", w: 160, h: 100 },
  { label: "Medium (2400 x 1200)", w: 240, h: 120 },
  { label: "Large (3200 x 1600)", w: 320, h: 160 },
  { label: "Wide (4000 x 1200)", w: 400, h: 120 },
  { label: "Tall (2000 x 2000)", w: 200, h: 200 },
];

export function blankMap(w: number, h: number, name = "Untitled"): CustomMap {
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y >= h - 6 || x < 3 || x >= w - 3) cells[y * w + x] = SOLID;
    }
  }
  const floorY = (h - 6) * CELL;
  return {
    name, w, h, backdrop: "street", theme: "concrete", cells,
    spawns: [
      { x: 20 * CELL, y: floorY, team: 1 },
      { x: (w - 20) * CELL, y: floorY, team: 2 },
      { x: Math.round(w / 2) * CELL, y: floorY, team: 0 },
    ],
    items: [],
    flags: [],
    holds: [],
  };
}

export function encodeCells(cells: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  while (i < cells.length) {
    const m = cells[i];
    let n = 1;
    while (i + n < cells.length && cells[i + n] === m) n++;
    out.push(String.fromCharCode(65 + m) + n.toString(36));
    i += n;
  }
  return out.join("");
}

export function decodeCells(rle: string, count: number): Uint8Array | null {
  if (rle.length > MAX_RLE) return null;
  const cells = new Uint8Array(count);
  const re = /([A-Z])([0-9a-z]+)/g;
  let at = 0;
  let consumed = 0;
  for (let m = re.exec(rle); m; m = re.exec(rle)) {
    if (m.index !== consumed) return null;
    consumed = re.lastIndex;
    const mat = m[1].charCodeAt(0) - 65;
    const n = parseInt(m[2], 36);
    if (mat >= MATERIALS.length || !(n > 0) || at + n > count) return null;
    cells.fill(mat, at, at + n);
    at += n;
  }
  return consumed === rle.length && at === count ? cells : null;
}

export function toWire(m: CustomMap): MapWire {
  const w: MapWire = {
    v: wireVersion(m),
    name: m.name,
    w: m.w,
    h: m.h,
    backdrop: m.backdrop,
    theme: m.theme,
    rle: encodeCells(m.cells),
    spawns: m.spawns.map((s) => [s.x, s.y, s.team]),
    items: m.items.map((it) => [it.x, it.y, it.kind]),
    flags: m.flags.map((f) => [f.x, f.y, f.team]),
    holds: m.holds.map((h) => [h.x, h.y]),
  };
  if (m.mission) w.mission = cloneMission(m.mission);
  if (m.stock) {
    w.stock = m.stock;
    if (m.stockArt) w.stockArt = true;
  }
  if (m.jumps?.length) {
    w.jumps = m.jumps.map((j) => j.walk ? [j.x, j.y, j.tx, j.ty, 1] : [j.x, j.y, j.tx, j.ty]);
  }
  if (m.decals?.length) {
    w.decals = m.decals.map((d) => [d.src, d.sx, d.sy, d.sw, d.sh, d.x, d.y,
      (d.fx ? 1 : 0) | (d.fy ? 2 : 0)]);
  }
  return w;
}

function wireVersion(m: CustomMap): number {
  if (m.decals?.length) return 7;
  if (m.jumps?.length) return 6;
  if (m.stock || (m.mission && usesHeroes(m.mission))) return 5;
  if (m.mission) return usesDevs(m.mission) ? 4 : 3;
  return 2;
}

function int(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function cleanName(v: unknown): string {
  const s = String(v ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
  return s || "Untitled";
}

const KEY_RE = /^[a-z0-9]{1,16}$/;

export function sanitiseMap(raw: unknown): CustomMap | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!READS.includes(Number(r.v))) return null;
  const w = Number(r.w);
  const h = Number(r.h);
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null;
  if (w < MIN_W || w > MAX_W || h < MIN_H || h > MAX_H) return null;
  if (typeof r.rle !== "string") return null;
  const cells = decodeCells(r.rle, w * h);
  if (!cells) return null;

  const pxW = w * CELL;
  const pxH = h * CELL;
  const spawns: EdSpawn[] = [];
  for (const s of Array.isArray(r.spawns) ? r.spawns.slice(0, MAX_SPAWNS) : []) {
    if (!Array.isArray(s)) continue;
    const x = int(s[0], 0, pxW);
    const y = int(s[1], 0, pxH);
    const t = Number(s[2]);
    if (x === null || y === null || (t !== 0 && t !== 1 && t !== 2)) continue;
    spawns.push({ x, y, team: t });
  }
  const items: EdItem[] = [];
  for (const it of Array.isArray(r.items) ? r.items.slice(0, MAX_ITEMS) : []) {
    if (!Array.isArray(it)) continue;
    const x = int(it[0], 0, pxW);
    const y = int(it[1], 0, pxH);
    const kind = String(it[2]) as ItemKind;
    if (x === null || y === null || !ITEM_KINDS.includes(kind)) continue;
    items.push({ x, y, kind });
  }
  const flags: EdFlag[] = [];
  for (const f of Array.isArray(r.flags) ? r.flags.slice(0, 2) : []) {
    if (!Array.isArray(f)) continue;
    const x = int(f[0], 0, pxW);
    const y = int(f[1], 0, pxH);
    const t = Number(f[2]);
    if (x === null || y === null || (t !== 1 && t !== 2)) continue;
    if (flags.some((o) => o.team === t)) continue;
    flags.push({ x, y, team: t });
  }
  const holds: EdHold[] = [];
  for (const h of Array.isArray(r.holds) ? r.holds.slice(0, MAX_HOLDS) : []) {
    if (!Array.isArray(h)) continue;
    const x = int(h[0], 0, pxW);
    const y = int(h[1], 0, pxH);
    if (x === null || y === null) continue;
    holds.push({ x, y });
  }
  const backdrop = typeof r.backdrop === "string" && KEY_RE.test(r.backdrop)
    ? r.backdrop : "street";
  const theme = typeof r.theme === "string" && KEY_RE.test(r.theme) ? r.theme : "concrete";
  const mission = sanitiseMission(r.mission);
  const stock = typeof r.stock === "string" && KEY_RE.test(r.stock) ? r.stock : "";
  const jumps: EdJump[] = [];
  for (const j of Array.isArray(r.jumps) ? r.jumps.slice(0, MAX_JUMPS) : []) {
    if (!Array.isArray(j)) continue;
    const x = int(j[0], 0, pxW);
    const y = int(j[1], 0, pxH);
    const tx = int(j[2], 0, pxW);
    const ty = int(j[3], 0, pxH);
    if (x === null || y === null || tx === null || ty === null) continue;
    jumps.push(j[4] === 1 ? { x, y, tx, ty, walk: true } : { x, y, tx, ty });
  }
  const decals: EdDecal[] = [];
  for (const d of Array.isArray(r.decals) ? r.decals.slice(0, MAX_DECALS) : []) {
    if (!Array.isArray(d) || typeof d[0] !== "string" || !KEY_RE.test(d[0])) continue;
    const sx = int(d[1], 0, 8000);
    const sy = int(d[2], 0, 8000);
    const sw = int(d[3], 1, MAX_DECAL_SIDE);
    const sh = int(d[4], 1, MAX_DECAL_SIDE);
    const x = int(d[5], -MAX_DECAL_SIDE, pxW);
    const y = int(d[6], -MAX_DECAL_SIDE, pxH);
    const f = int(d[7], 0, 3) ?? 0;
    if (sx === null || sy === null || sw === null || sh === null || x === null || y === null) continue;
    decals.push({ src: d[0], sx, sy, sw, sh, x, y, ...(f & 1 ? { fx: true } : {}), ...(f & 2 ? { fy: true } : {}) });
  }
  return {
    name: cleanName(r.name), w, h, backdrop, theme, cells, spawns, items, flags, holds,
    ...(mission ? { mission } : {}),
    ...(stock ? { stock, stockArt: r.stockArt === true } : {}),
    ...(jumps.length ? { jumps } : {}),
    ...(decals.length ? { decals } : {}),
  };
}

export function cloneMap(m: CustomMap): CustomMap {
  return {
    ...m,
    cells: m.cells.slice(),
    spawns: m.spawns.map((s) => ({ ...s })),
    items: m.items.map((it) => ({ ...it })),
    flags: m.flags.map((f) => ({ ...f })),
    holds: m.holds.map((h) => ({ ...h })),
    mission: m.mission ? cloneMission(m.mission) : null,
    jumps: (m.jumps ?? []).map((j) => ({ ...j })),
    decals: (m.decals ?? []).map((d) => ({ ...d })),
  };
}

export const MISSION_MODES = ["tdm", "dm", "ctf", "dom"] as const;
export type MissionMode = typeof MISSION_MODES[number];

export const MISSION_WINS = ["score", "survive", "elim", "boss"] as const;
export type MissionWin = typeof MISSION_WINS[number];

export const MISSION_RULES = [
  "none", "streak", "invisible", "enemyInvisible", "enemyRegen", "allTraits", "vampire",
] as const;
export type MissionRule = typeof MISSION_RULES[number];

export const MISSION_CLASSES = ["", "eng", "jug", "med", "gun", "eli", "mer", "sni", "nin"] as const;

export const MISSION_DEVS = ["mike", "justin"] as const;
export const MISSION_HEROES = ["wesley", "nathan", "jyn", "tower", "dex"] as const;
export const MISSION_ROSTER = [...MISSION_CLASSES, ...MISSION_DEVS, ...MISSION_HEROES] as const;

export function isDev(cls: string): cls is typeof MISSION_DEVS[number] {
  return (MISSION_DEVS as readonly string[]).includes(cls);
}

export function isHero(cls: string): cls is typeof MISSION_HEROES[number] {
  return (MISSION_HEROES as readonly string[]).includes(cls);
}

export function isNamed(cls: string): boolean {
  return isDev(cls) || isHero(cls);
}

function usesDevs(mis: EdMission): boolean {
  return mis.devPhases || mis.units.some((u) => isDev(u.cls));
}

function usesHeroes(mis: EdMission): boolean {
  return mis.units.some((u) => isHero(u.cls));
}

export const MISSION_MAX_LVL = 35;
export const MISSION_MAX_ENEMIES = 12;
export const MISSION_MAX_ALLIES = 4;
export const MISSION_MAX_ROWS = 12;
export const MISSION_MAX_SCORE = 200;
export const MISSION_MAX_TIME = 30 * 60;
export const MAX_PROMPT = 100;
export const MAX_BRIEF = 300;

export interface EdMissionUnit {
  cls: string;
  lvl: number;
  count: number;
  ally: boolean;
  lives: number;
  boss: boolean;
  name: string;
  statMod: number;
  scale: number;
}

export interface MissionText {
  brief: string;
  start: string;
  half: string;
  win: string;
  lose: string;
}

export interface EdMission {
  title: string;
  mode: MissionMode;
  win: MissionWin;
  score: number;
  time: number;
  squad: number;
  rule: MissionRule;
  devPhases: boolean;
  units: EdMissionUnit[];
  text: MissionText;
}

export function cloneMission(m: EdMission): EdMission {
  return { ...m, units: m.units.map((u) => ({ ...u })), text: { ...m.text } };
}

export function cleanText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return list.includes(v as T) ? v as T : fallback;
}

function tenth(v: unknown, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(lo, Math.min(hi, n)) * 10) / 10;
}

export function sanitiseMission(raw: unknown): EdMission | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!MISSION_MODES.includes(r.mode as MissionMode)) return null;
  const units: EdMissionUnit[] = [];
  let enemies = 0;
  let allies = 0;
  let boss = false;
  const devs = new Set<string>();
  for (const x of Array.isArray(r.units) ? r.units.slice(0, MISSION_MAX_ROWS) : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const cls = oneOf(o.cls, MISSION_ROSTER, "");
    const dev = isNamed(cls);
    if (dev && devs.has(cls)) continue;
    const ally = o.ally === true;
    const isBoss = !ally && !boss && o.boss === true;
    const left = ally ? MISSION_MAX_ALLIES - allies : MISSION_MAX_ENEMIES - enemies;
    const count = Math.min(left, isBoss || dev ? 1 : int(o.count, 1, MISSION_MAX_ENEMIES) ?? 1);
    if (count < 1) continue;
    if (ally) allies += count;
    else enemies += count;
    if (isBoss) boss = true;
    if (dev) devs.add(cls);
    units.push({
      cls,
      lvl: int(o.lvl, 1, MISSION_MAX_LVL) ?? 1,
      count,
      ally,
      lives: int(o.lives, 1, 9) ?? 1,
      boss: isBoss,
      name: dev ? "" : cleanText(o.name, 20),
      statMod: tenth(o.statMod, 0, 3),
      scale: tenth(o.scale, -0.5, 1),
    });
  }
  const t = (r.text && typeof r.text === "object" ? r.text : {}) as Record<string, unknown>;
  return {
    title: cleanText(r.title, MAX_NAME),
    mode: r.mode as MissionMode,
    win: oneOf(r.win, MISSION_WINS, "score"),
    score: int(r.score, 1, MISSION_MAX_SCORE) ?? 10,
    time: int(r.time, 0, MISSION_MAX_TIME) ?? 0,
    squad: int(r.squad, 1, 5) ?? 1,
    rule: oneOf(r.rule, MISSION_RULES, "none"),
    devPhases: r.devPhases === true,
    units,
    text: {
      brief: cleanText(t.brief, MAX_BRIEF),
      start: cleanText(t.start, MAX_PROMPT),
      half: cleanText(t.half, MAX_PROMPT),
      win: cleanText(t.win, MAX_PROMPT),
      lose: cleanText(t.lose, MAX_PROMPT),
    },
  };
}
