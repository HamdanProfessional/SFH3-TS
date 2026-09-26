import {
  CELL, MAX_HOLDS, MAX_ITEMS, MAX_SPAWNS, encodeCells, type CustomMap, type EdFlag, type EdHold,
  type EdItem, type EdMission, type EdSpawn,
} from "./format";
import { settle } from "./build";

export const HISTORY_STEPS = 100;
const HISTORY_BYTES = 16 * 1024 * 1024;

export interface CellRect { ax: number; ay: number; bx: number; by: number }

type Packed = string | Uint8Array;

function pack(cells: Uint8Array): Packed {
  const rle = encodeCells(cells);
  return rle.length < cells.length ? rle : cells.slice();
}

function unpack(p: Packed, count: number): Uint8Array {
  if (typeof p !== "string") return p;
  const out = new Uint8Array(count);
  let at = 0;
  let i = 0;
  while (i < p.length) {
    const mat = p.charCodeAt(i++) - 65;
    let j = i;
    while (j < p.length && (p.charCodeAt(j) < 65 || p.charCodeAt(j) > 90)) j++;
    const n = parseInt(p.slice(i, j), 36);
    out.fill(mat, at, at + n);
    at += n;
    i = j;
  }
  return out;
}

function sizeOf(p: Packed | null): number {
  return p === null ? 0 : p.length;
}

function restOf(m: CustomMap): string {
  return JSON.stringify({
    name: m.name, backdrop: m.backdrop, theme: m.theme,
    spawns: m.spawns, items: m.items, flags: m.flags, holds: m.holds,
    mission: m.mission ?? null,
  });
}

function applyRest(m: CustomMap, json: string): void {
  const r = JSON.parse(json) as {
    name: string; backdrop: string; theme: string; spawns: EdSpawn[]; items: EdItem[];
    flags: EdFlag[]; holds: EdHold[]; mission: EdMission | null;
  };
  m.name = r.name;
  m.backdrop = r.backdrop;
  m.theme = r.theme;
  m.spawns = r.spawns;
  m.items = r.items;
  m.flags = r.flags;
  m.holds = r.holds;
  m.mission = r.mission;
}

function region(cells: Uint8Array, w: number, r: CellRect): Uint8Array {
  const rw = r.bx - r.ax + 1;
  const out = new Uint8Array(rw * (r.by - r.ay + 1));
  for (let y = r.ay; y <= r.by; y++) {
    out.set(cells.subarray(y * w + r.ax, y * w + r.bx + 1), (y - r.ay) * rw);
  }
  return out;
}

function blit(cells: Uint8Array, w: number, r: CellRect, src: Uint8Array): void {
  const rw = r.bx - r.ax + 1;
  for (let y = r.ay; y <= r.by; y++) {
    cells.set(src.subarray((y - r.ay) * rw, (y - r.ay + 1) * rw), y * w + r.ax);
  }
}

function changedBox(a: Uint8Array, b: Uint8Array, w: number): CellRect | null {
  let ax = w;
  let ay = -1;
  let bx = -1;
  let by = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (ay < 0) ay = y;
    by = y;
    if (x < ax) ax = x;
    if (x > bx) bx = x;
  }
  return ay < 0 ? null : { ax, ay, bx, by };
}

interface Step {
  label: string;
  box: CellRect | null;
  before: Packed | null;
  after: Packed | null;
  restBefore: string | null;
  restAfter: string | null;
  bytes: number;
}

export class History {
  private undos: Step[] = [];
  private redos: Step[] = [];
  private cells: Uint8Array;
  private rest: string;
  private bytes = 0;

  constructor(readonly map: CustomMap) {
    this.cells = map.cells.slice();
    this.rest = restOf(map);
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  pending(): boolean {
    return !!changedBox(this.cells, this.map.cells, this.map.w) || restOf(this.map) !== this.rest;
  }

  commit(label: string): boolean {
    const m = this.map;
    const box = changedBox(this.cells, m.cells, m.w);
    const rest = restOf(m);
    const restMoved = rest !== this.rest;
    if (!box && !restMoved) return false;
    const step: Step = {
      label, box, before: null, after: null,
      restBefore: restMoved ? this.rest : null, restAfter: restMoved ? rest : null, bytes: 0,
    };
    if (box) {
      const now = region(m.cells, m.w, box);
      step.before = pack(region(this.cells, m.w, box));
      step.after = pack(now);
      blit(this.cells, m.w, box, now);
    }
    step.bytes = sizeOf(step.before) + sizeOf(step.after)
      + (step.restBefore?.length ?? 0) + (step.restAfter?.length ?? 0);
    this.rest = rest;
    this.undos.push(step);
    this.bytes += step.bytes;
    for (const s of this.redos) this.bytes -= s.bytes;
    this.redos = [];
    while (this.undos.length > HISTORY_STEPS
      || (this.bytes > HISTORY_BYTES && this.undos.length > 1)) {
      this.bytes -= this.undos.shift()!.bytes;
    }
    return true;
  }

  undo(): string | null {
    this.commit("Edit");
    const s = this.undos.pop();
    if (!s) return null;
    this.apply(s, false);
    this.redos.push(s);
    return s.label;
  }

  redo(): string | null {
    if (this.commit("Edit")) return null;
    const s = this.redos.pop();
    if (!s) return null;
    this.apply(s, true);
    this.undos.push(s);
    return s.label;
  }

  private apply(s: Step, forward: boolean): void {
    const m = this.map;
    const cells = forward ? s.after : s.before;
    if (s.box && cells !== null) {
      const b = s.box;
      const src = unpack(cells, (b.bx - b.ax + 1) * (b.by - b.ay + 1));
      blit(m.cells, m.w, b, src);
      blit(this.cells, m.w, b, src);
    }
    const rest = forward ? s.restAfter : s.restBefore;
    if (rest !== null) {
      applyRest(m, rest);
      this.rest = rest;
    }
  }
}

type Pt = { x: number; y: number };

export function anchorOf(o: Pt): Pt {
  return { x: Math.floor(o.x / CELL), y: Math.floor(o.y / CELL) };
}

function inRect(o: Pt, r: CellRect): boolean {
  const a = anchorOf(o);
  return a.x >= r.ax && a.x <= r.bx && a.y >= r.ay && a.y <= r.by;
}

function flipX(x: number, w: number): number {
  return w * CELL - x;
}

function flipY(y: number, h: number): number {
  return (h - 2 - Math.floor(y / CELL)) * CELL - 1;
}

export function swapTeam<T extends 0 | 1 | 2>(t: T): T {
  return (t === 1 ? 2 : t === 2 ? 1 : 0) as T;
}

function clampTo(m: CustomMap, o: Pt): Pt {
  return {
    x: Math.max(0, Math.min(m.w * CELL, Math.round(o.x))),
    y: Math.max(0, Math.min(m.h * CELL, Math.round(o.y))),
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function addObjects(m: CustomMap, extra: Omit<Clip, "w" | "h" | "cells">): string[] {
  let spawns = 0;
  let items = 0;
  let flags = 0;
  let holds = 0;
  for (const s of extra.spawns) {
    if (m.spawns.length < MAX_SPAWNS) m.spawns.push(s); else spawns++;
  }
  for (const it of extra.items) {
    if (m.items.length < MAX_ITEMS) m.items.push(it); else items++;
  }
  for (const f of extra.flags) {
    if (!m.flags.some((o) => o.team === f.team)) m.flags.push(f); else flags++;
  }
  for (const h of extra.holds) {
    if (m.holds.length < MAX_HOLDS) m.holds.push(h); else holds++;
  }
  const out: string[] = [];
  if (spawns) out.push(`${plural(spawns, "spawn")} left out (at most ${MAX_SPAWNS})`);
  if (items) out.push(`${plural(items, "pickup")} left out (at most ${MAX_ITEMS})`);
  if (flags) out.push(`${plural(flags, "flag")} left out (one per team)`);
  if (holds) out.push(`${plural(holds, "zone")} left out (at most ${MAX_HOLDS})`);
  return out;
}

export interface Clip {
  w: number;
  h: number;
  cells: Uint8Array;
  spawns: EdSpawn[];
  items: EdItem[];
  flags: EdFlag[];
  holds: EdHold[];
}

export function copyArea(m: CustomMap, r: CellRect, objects: boolean): Clip {
  const ox = r.ax * CELL;
  const oy = r.ay * CELL;
  const rel = <T extends Pt>(o: T): T => ({ ...o, x: o.x - ox, y: o.y - oy });
  const pick = <T extends Pt>(list: T[]): T[] =>
    objects ? list.filter((o) => inRect(o, r)).map(rel) : [];
  return {
    w: r.bx - r.ax + 1,
    h: r.by - r.ay + 1,
    cells: region(m.cells, m.w, r),
    spawns: pick(m.spawns),
    items: pick(m.items),
    flags: pick(m.flags),
    holds: pick(m.holds),
  };
}

export function clearArea(m: CustomMap, r: CellRect, objects: boolean): void {
  for (let y = r.ay; y <= r.by; y++) m.cells.fill(0, y * m.w + r.ax, y * m.w + r.bx + 1);
  if (!objects) return;
  const keep = <T extends Pt>(list: T[]): T[] => list.filter((o) => !inRect(o, r));
  m.spawns = keep(m.spawns);
  m.items = keep(m.items);
  m.flags = keep(m.flags);
  m.holds = keep(m.holds);
}

export function flipClip(c: Clip, horizontal: boolean): Clip {
  const cells = new Uint8Array(c.cells.length);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const from = horizontal ? y * c.w + (c.w - 1 - x) : (c.h - 1 - y) * c.w + x;
      cells[y * c.w + x] = c.cells[from];
    }
  }
  const f = <T extends Pt>(o: T): T => horizontal
    ? { ...o, x: flipX(o.x, c.w) }
    : { ...o, y: flipY(o.y, c.h) };
  return {
    w: c.w, h: c.h, cells,
    spawns: c.spawns.map(f), items: c.items.map(f), flags: c.flags.map(f), holds: c.holds.map(f),
  };
}

export function pasteClip(m: CustomMap, c: Clip, x0: number, y0: number, air: boolean): string[] {
  for (let y = 0; y < c.h; y++) {
    const my = y0 + y;
    if (my < 0 || my >= m.h) continue;
    for (let x = 0; x < c.w; x++) {
      const mx = x0 + x;
      if (mx < 0 || mx >= m.w) continue;
      const v = c.cells[y * c.w + x];
      if (v || air) m.cells[my * m.w + mx] = v;
    }
  }
  const W = m.w * CELL;
  const H = m.h * CELL;
  const place = <T extends Pt>(list: T[]): T[] => list
    .map((o) => ({ ...o, x: o.x + x0 * CELL, y: o.y + y0 * CELL }))
    .filter((o) => o.x >= 0 && o.x <= W && o.y >= 0 && o.y <= H)
    .map((o) => ({ ...o, x: Math.round(o.x), y: Math.round(settle(m, o.x, o.y)) }));
  return addObjects(m, {
    spawns: place(c.spawns), items: place(c.items), flags: place(c.flags), holds: place(c.holds),
  });
}

export type MirrorDir = "lr" | "rl" | "tb" | "bt";

export const MIRROR_DIRS: readonly { key: MirrorDir; label: string }[] = [
  { key: "lr", label: "Left half → right" },
  { key: "rl", label: "Right half → left" },
  { key: "tb", label: "Top half → bottom" },
  { key: "bt", label: "Bottom half → top" },
];

export function mirrorMap(m: CustomMap, dir: MirrorDir): string[] {
  const { w, h, cells } = m;
  const lr = dir === "lr" || dir === "rl";
  if (lr) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w >> 1; x++) {
        const a = y * w + x;
        const b = y * w + (w - 1 - x);
        if (dir === "lr") cells[b] = cells[a]; else cells[a] = cells[b];
      }
    }
  } else {
    for (let y = 0; y < h >> 1; y++) {
      const a = y * w;
      const b = (h - 1 - y) * w;
      if (dir === "tb") cells.copyWithin(b, a, a + w); else cells.copyWithin(a, b, b + w);
    }
  }
  const axis = (lr ? w : h) * CELL / 2;
  const at = (o: Pt): number => (lr ? o.x : o.y) - axis;
  const side = (o: Pt): number => {
    const d = at(o);
    if (Math.abs(d) < CELL) return 0;
    return (d < 0) === (dir === "lr" || dir === "tb") ? -1 : 1;
  };
  const twin = <T extends Pt>(o: T): T => {
    const p = clampTo(m, lr ? { x: flipX(o.x, w), y: o.y } : { x: o.x, y: flipY(o.y, h) });
    return { ...o, x: p.x, y: lr ? p.y : Math.round(settle(m, p.x, p.y)) };
  };
  const split = <T extends Pt>(list: T[]): [T[], T[]] => {
    const kept = list.filter((o) => side(o) <= 0);
    return [kept, kept.filter((o) => side(o) < 0).map(twin)];
  };
  const [spawns, sTwins] = split(m.spawns);
  const [items, iTwins] = split(m.items);
  const [flags, fTwins] = split(m.flags);
  const [holds, hTwins] = split(m.holds);
  m.spawns = spawns;
  m.items = items;
  m.flags = flags;
  m.holds = holds;
  return addObjects(m, {
    spawns: sTwins.map((s) => ({ ...s, team: swapTeam(s.team) })),
    items: iTwins,
    flags: fTwins.map((f) => ({ ...f, team: swapTeam(f.team) })),
    holds: hTwins,
  });
}

export function mirrorRect(m: CustomMap, r: CellRect, lr: boolean): CellRect {
  return lr
    ? { ax: m.w - 1 - r.bx, bx: m.w - 1 - r.ax, ay: r.ay, by: r.by }
    : { ax: r.ax, bx: r.bx, ay: m.h - 1 - r.by, by: m.h - 1 - r.ay };
}

export function mirrorPoint(m: CustomMap, o: Pt, lr: boolean): Pt {
  const p = clampTo(m, lr ? { x: flipX(o.x, m.w), y: o.y } : { x: o.x, y: flipY(o.y, m.h) });
  return lr ? p : { x: p.x, y: Math.round(settle(m, p.x, p.y)) };
}
