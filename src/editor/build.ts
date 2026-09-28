import { BitmapWallMask, type ArenaDef, type RawNode } from "../game/Arena";
import { CELL, MATERIALS, MAT, ITEM_RESPAWN, type CustomMap } from "./format";

const IDS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  + Array.from({ length: 0x180 - 0xc0 }, (_, i) => String.fromCharCode(0xc0 + i))
    .filter((c) => c !== "×" && c !== "÷").join("");

const HEADROOM = 6;
const STEP = 4;
const MIN_FLOOR = 3;
const JUMP_UP_MIN = 5;
const JUMP_UP_MAX = 13;
const JUMP_UP_LIMIT = 40;
const LAUNCH_REACH = 8;
const LAUNCH_REACH_BOOSTED = 16;
const GAP_MAX = 16;
const GAP_LIMIT = 30;
const DROP_MAX = 80;
export const CTF_PATH_BUDGET = 5000;

const GRAV = 0.8;
const Y_MAX = 20;
const Y_JUMP = 13;
const Y_BOOST = 6;
const X_MAX = 9.5;

export interface NavPoint {
  id: string;
  x: number;
  y: number;
  links: string[];
}

export interface NavBox {
  x: number;
  y: number;
  width: number;
  height: number;
  target: string;
  from: string;
}

export interface NavGraph {
  points: NavPoint[];
  boxes: NavBox[];
}

function mat(m: CustomMap, x: number, y: number) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return MATERIALS[0];
  return MATERIALS[m.cells[y * m.w + x]] ?? MATERIALS[0];
}

function cellId(m: CustomMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 0;
  return m.cells[y * m.w + x];
}

export function isSolidCell(m: CustomMap, x: number, y: number): boolean {
  return mat(m, x, y).solid;
}

export function buildMask(m: CustomMap): BitmapWallMask {
  const W = m.w * CELL;
  const H = m.h * CELL;
  const data = new Uint32Array(W * H);
  const row = new Uint32Array(W);
  for (let cy = 0; cy < m.h; cy++) {
    for (let cx = 0; cx < m.w; cx++) {
      row.fill(MATERIALS[m.cells[cy * m.w + cx]]?.argb ?? 0, cx * CELL, (cx + 1) * CELL);
    }
    for (let py = 0; py < CELL; py++) data.set(row, (cy * CELL + py) * W);
  }
  return new BitmapWallMask(W, H, data);
}

export function buildPhysBoxes(m: CustomMap): RawNode[] {
  const used = new Uint8Array(m.w * m.h);
  const solid = (x: number, y: number) => mat(m, x, y).solid && !used[y * m.w + x];
  const out: RawNode[] = [];
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!solid(x, y)) continue;
      let w = 1;
      while (x + w < m.w && solid(x + w, y)) w++;
      let h = 1;
      grow: while (y + h < m.h) {
        for (let i = 0; i < w; i++) if (!solid(x + i, y + h)) break grow;
        h++;
      }
      for (let j = 0; j < h; j++) used.fill(1, (y + j) * m.w + x, (y + j) * m.w + x + w);
      out.push({
        kind: "physbox", name: "",
        x: (x + w / 2) * CELL, y: (y + h / 2) * CELL,
        width: w * CELL, height: h * CELL, rotation: 0,
      });
    }
  }
  return out;
}

interface Arc {
  curve: number[];
  rise: number;
  air: number;
}

function jumpArc(modJump: number, gravAt: (y: number) => number,
                 ceilAt: (y: number) => boolean): Arc {
  const curve: number[] = [];
  let y = -Y_BOOST;
  let v = -Y_JUMP * modJump;
  for (let t = 0; t < 300; t++) {
    const g = gravAt(y);
    y += v;
    v += GRAV * g;
    if (v > Y_MAX * g) v = Y_MAX * g;
    for (let i = 0; i < 60 && ceilAt(y - 50); i++) {
      y += 1;
      if (v < 0) v = 0;
    }
    curve.push(-y);
    if (v > 0 && y >= 0) break;
  }
  return { curve, rise: Math.max(0, ...curve), air: curve.length };
}

const BASE = jumpArc(1, () => 1, () => false);
const MANTLE = JUMP_UP_MAX * CELL - BASE.rise;

function reachUp(a: Arc): number {
  return Math.floor((a.rise + MANTLE) / CELL + 1e-6);
}

function gapReach(a: Arc): number {
  return Math.min(GAP_LIMIT, Math.floor((GAP_MAX * a.air) / BASE.air + 1e-6));
}

function riseAt(a: Arc, t: number): number {
  return a.curve[Math.min(a.curve.length - 1, Math.max(0, Math.floor(t)))] ?? 0;
}

function arcFrom(m: CustomMap, cx: number, cy: number): Arc {
  const floor = cellId(m, cx, cy);
  const modJump = floor === MAT.jump ? 1.8 : floor === MAT.water ? 0.8 : 1;
  if (modJump === 1) {
    let field = false;
    for (let y = cy - 1; y >= Math.max(0, cy - 45) && !field; y--) {
      field = cellId(m, cx, y) === MAT.lowfield;
    }
    if (!field) return BASE;
  }
  const y0 = cy * CELL - 1;
  const row = (y: number) => Math.floor((y0 + y) / CELL);
  return jumpArc(
    modJump,
    (y) => (cellId(m, cx, row(y + 1)) === MAT.lowfield ? 0.5 : 1),
    (y) => mat(m, cx, row(y)).solid,
  );
}

interface Floor {
  cells: { x: number; y: number }[];
  anchors: Set<number>;
  wps: NavPoint[];
}

function standable(m: CustomMap, x: number, y: number): boolean {
  if (!mat(m, x, y).walkable || y < HEADROOM) return false;
  for (let i = 1; i <= HEADROOM; i++) if (mat(m, x, y - i).solid) return false;
  return true;
}

function findFloors(m: CustomMap): { floors: Floor[]; floorAt: Int32Array } {
  const floorAt = new Int32Array(m.w * m.h).fill(-1);
  const parent: number[] = [];
  const cellsOf: { x: number; y: number }[] = [];
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const tmp = new Int32Array(m.w * m.h).fill(-1);
  for (let x = 0; x < m.w; x++) {
    for (let y = 0; y < m.h; y++) {
      if (!standable(m, x, y)) continue;
      const id = parent.length;
      parent.push(id);
      cellsOf.push({ x, y });
      tmp[y * m.w + x] = id;
      if (x === 0) continue;
      for (let dy = -STEP; dy <= STEP; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= m.h) continue;
        const o = tmp[ny * m.w + x - 1];
        if (o >= 0) parent[find(o)] = find(id);
      }
    }
  }
  const byRoot = new Map<number, Floor>();
  for (let i = 0; i < parent.length; i++) {
    const r = find(i);
    let f = byRoot.get(r);
    if (!f) { f = { cells: [], anchors: new Set(), wps: [] }; byRoot.set(r, f); }
    f.cells.push(cellsOf[i]);
  }
  const floors = [...byRoot.values()].filter((f) => f.cells.length >= MIN_FLOOR);
  floors.forEach((f, i) => {
    f.cells.sort((a, b) => a.x - b.x || a.y - b.y);
    for (const c of f.cells) floorAt[c.y * m.w + c.x] = i;
  });
  return { floors, floorAt };
}

function floorRow(f: Floor, x: number): number {
  let best = -1;
  for (const c of f.cells) if (c.x === x && (best < 0 || c.y < best)) best = c.y;
  return best;
}

function feet(y: number): number {
  return y * CELL - 1;
}

interface Jump {
  from: Floor; fromX: number; to: Floor; toEnd: "l" | "r";
  back: boolean;
  lo?: number; hi?: number;
}

function boostedRun(f: Floor, x: number, ok: (cx: number) => boolean):
  { lo: number; hi: number } | null {
  let lo = x;
  let hi = x;
  while (lo > x - 3 && floorRow(f, lo - 1) >= 0 && ok(lo - 1)) lo--;
  while (hi < x + 3 && floorRow(f, hi + 1) >= 0 && ok(hi + 1)) hi++;
  if (hi - lo < 2) return null;
  return { lo: lo + 1, hi: hi - 1 };
}

type Anchors = Map<Floor, number[]>;

function floorUnder(m: CustomMap, floors: Floor[], floorAt: Int32Array, x: number, y: number):
  { floor: Floor; cx: number } | null {
  const cx = Math.max(0, Math.min(m.w - 1, Math.floor(x / CELL)));
  for (let cy = Math.max(0, Math.floor((y - CELL) / CELL)); cy < m.h; cy++) {
    if (!mat(m, cx, cy).solid) continue;
    const i = floorAt[cy * m.w + cx];
    return i >= 0 ? { floor: floors[i], cx } : null;
  }
  return null;
}

function objectiveAnchors(m: CustomMap, mode: string, floors: Floor[], floorAt: Int32Array):
  Anchors {
  const out: Anchors = new Map();
  const objs = mode === "ctf" ? m.flags : mode === "dom" ? m.holds : [];
  for (const o of objs) {
    const u = floorUnder(m, floors, floorAt, o.x, o.y);
    if (!u) continue;
    const list = out.get(u.floor) ?? [];
    list.push(u.cx);
    out.set(u.floor, list);
  }
  return out;
}

interface Built extends NavGraph { cross: Set<string> }

function tryGraph(m: CustomMap, floors: Floor[], floorAt: Int32Array, fill: number,
                  extra: Anchors): Built | null {
  for (const f of floors) {
    f.anchors = new Set(extra.get(f) ?? []);
    f.wps = [];
  }
  const at = (x: number, y: number): Floor | null => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
    const i = floorAt[y * m.w + x];
    return i >= 0 ? floors[i] : null;
  };
  const clearColumn = (x: number, yTop: number, yBottom: number): boolean => {
    for (let y = Math.max(0, yTop); y < yBottom; y++) if (mat(m, x, y).solid) return false;
    return true;
  };
  const arcs = new Map<number, Arc>();
  const arc = (x: number, y: number): Arc => {
    const k = y * m.w + x;
    let a = arcs.get(k);
    if (!a) { a = arcFrom(m, x, y); arcs.set(k, a); }
    return a;
  };

  const jumps: Jump[] = [];
  for (const top of floors) {
    for (const end of ["l", "r"] as const) {
      const c = end === "l" ? top.cells[0] : top.cells[top.cells.length - 1];
      const d = end === "l" ? -1 : 1;
      let step = true;
      for (let y = c.y; y < c.y + JUMP_UP_MIN && step; y++) step = mat(m, c.x, y).solid;
      const makes = (x: number, y: number, k: number): "plain" | "boosted" | null => {
        const dy = y - c.y;
        if (k < 1 || !clearColumn(x, c.y - HEADROOM, y)) return null;
        const a = arc(x, y);
        if (reachUp(a) < dy) return null;
        if (dy <= JUMP_UP_MAX) return k <= LAUNCH_REACH && (step || k >= 4) ? "plain" : null;
        if (!step && (k < 4 || riseAt(a, (k * CELL) / X_MAX) + MANTLE < dy * CELL)) return null;
        return "boosted";
      };
      for (let k = step ? 1 : 4; k <= LAUNCH_REACH_BOOSTED; k++) {
        const x = c.x + d * k;
        let hit: Floor | null = null;
        let hy = -1;
        for (let y = c.y + JUMP_UP_MIN; y <= c.y + JUMP_UP_LIMIT && y < m.h; y++) {
          const f = at(x, y);
          if (f && f !== top) { hit = f; hy = y; break; }
          if (mat(m, x, y).solid) break;
        }
        const kind = hit ? makes(x, hy, k) : null;
        if (!hit || !kind) continue;
        const j: Jump = { from: hit, fromX: x, to: top, toEnd: end, back: true };
        if (kind === "boosted") {
          const from = hit;
          const run = boostedRun(from, x, (cx) => {
            const r = floorRow(from, cx);
            return makes(cx, r, (cx - c.x) * d) === "boosted";
          });
          if (!run) continue;
          j.lo = run.lo;
          j.hi = run.hi;
        }
        hit.anchors.add(x);
        jumps.push(j);
        break;
      }
      const reach = gapReach(arc(c.x, c.y));
      for (let k = 2; k <= Math.max(GAP_MAX, reach); k++) {
        const x = c.x + d * k;
        let hit: Floor | null = null;
        for (let dy = -STEP; dy <= STEP; dy++) {
          const f = at(x, c.y + dy);
          if (f && f !== top) { hit = f; break; }
        }
        if (hit) {
          let open = true;
          for (let i = 1; i < k && open; i++) {
            open = clearColumn(c.x + d * i, c.y - HEADROOM, c.y);
          }
          if (open && k <= reach) {
            const toEnd = end === "l" ? "r" : "l";
            const far = toEnd === "l" ? hit.cells[0] : hit.cells[hit.cells.length - 1];
            const back = gapReach(arc(far.x, far.y)) >= k;
            const j: Jump = { from: top, fromX: c.x, to: hit, toEnd, back };
            if (k > GAP_MAX) {
              const run = boostedRun(top, c.x, (cx) =>
                gapReach(arc(cx, floorRow(top, cx))) >= k + Math.abs(cx - c.x));
              if (run) { j.lo = run.lo; j.hi = run.hi; jumps.push(j); }
            } else {
              jumps.push(j);
            }
          }
          break;
        }
        if (mat(m, x, c.y - 1).solid) break;
      }
    }
  }

  const floorNear = (px: number, py: number): { f: Floor; cx: number } | null => {
    const cx0 = Math.max(0, Math.min(m.w - 1, Math.floor(px / CELL)));
    const cy0 = Math.floor((py + 1) / CELL);
    for (const dx of [0, -1, 1, -2, 2]) {
      for (let dy = -2; dy <= 4; dy++) {
        const f = at(cx0 + dx, cy0 + dy);
        if (f) return { f, cx: cx0 + dx };
      }
    }
    return null;
  };
  const authored: { from: Floor; fx: number; to: Floor; tx: number; walk: boolean }[] = [];
  for (const j of m.jumps ?? []) {
    const a = floorNear(j.x, j.y);
    const b = floorNear(j.tx, j.ty);
    if (!a || !b || a.f === b.f) continue;
    a.f.anchors.add(a.cx);
    b.f.anchors.add(b.cx);
    authored.push({ from: a.f, fx: a.cx, to: b.f, tx: b.cx, walk: !!j.walk });
  }

  let n = 0;
  for (const f of floors) {
    const x0 = f.cells[0].x;
    const last = f.cells[f.cells.length - 1];
    const x1 = last.x;
    const inset = Math.min(3, Math.floor((x1 - x0) / 2));
    const insetR = cellId(m, x1, last.y) === MAT.conveyor
      ? Math.min(6, Math.floor((x1 - x0) / 2)) : inset;
    const cols = new Set<number>([x0 + inset, x1 - insetR, ...f.anchors]);
    let lastY = f.cells[0].y;
    for (const c of f.cells) {
      if (Math.abs(c.y - lastY) >= STEP) { cols.add(c.x); lastY = c.y; }
    }
    const sorted = [...cols].sort((a, b) => a - b);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const gap = sorted[i + 1] - sorted[i];
      if (gap > fill) {
        const parts = Math.ceil(gap / fill);
        for (let p = 1; p < parts; p++) cols.add(Math.round(sorted[i] + (gap * p) / parts));
      }
    }
    for (const x of [...cols].sort((a, b) => a - b)) {
      const y = floorRow(f, x);
      if (y < 0) continue;
      if (n >= IDS.length) return null;
      f.wps.push({ id: IDS[n++], x: x * CELL + CELL / 2, y: feet(y), links: [] });
    }
  }

  const cross = new Set<string>();
  const link = (a: NavPoint, b: NavPoint, between = false): void => {
    if (a !== b && !a.links.includes(b.id)) a.links.push(b.id);
    if (between && a !== b) cross.add(`${a.id}>${b.id}`);
  };
  const nearest = (f: Floor, px: number): NavPoint | null => {
    let best: NavPoint | null = null;
    for (const w of f.wps) if (!best || Math.abs(w.x - px) < Math.abs(best.x - px)) best = w;
    return best;
  };
  const endWp = (f: Floor, end: "l" | "r"): NavPoint | null =>
    (end === "l" ? f.wps[0] : f.wps[f.wps.length - 1]) ?? null;

  for (const f of floors) {
    for (let i = 0; i + 1 < f.wps.length; i++) {
      link(f.wps[i], f.wps[i + 1]);
      link(f.wps[i + 1], f.wps[i]);
    }
  }

  const boxes: NavBox[] = [];
  const seen = new Set<string>();
  for (const j of jumps) {
    const target = endWp(j.to, j.toEnd);
    const launch = nearest(j.from, j.fromX * CELL + CELL / 2);
    if (!target || !launch) continue;
    link(launch, target, true);
    if (j.back) link(target, launch, true);
    const lx = j.fromX * CELL + CELL / 2;
    const ly = feet(floorRow(j.from, j.fromX));
    const key = `${lx},${ly},${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (j.lo !== undefined && j.hi !== undefined) {
      boxes.push({
        x: j.lo * CELL, y: ly - 72, width: (j.hi - j.lo + 1) * CELL, height: 80,
        target: target.id, from: launch.id,
      });
    } else {
      boxes.push({ x: lx - 42, y: ly - 72, width: 85, height: 80, target: target.id, from: launch.id });
    }
  }

  for (const a of authored) {
    const lx = a.fx * CELL + CELL / 2;
    const launch = nearest(a.from, lx);
    const target = nearest(a.to, a.tx * CELL + CELL / 2);
    if (!launch || !target) continue;
    link(launch, target, true);
    if (a.walk) continue;
    const ly = feet(floorRow(a.from, a.fx));
    const key = `${lx},${ly},${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    boxes.push({ x: lx - 42, y: ly - 72, width: 85, height: 80, target: target.id, from: launch.id });
  }

  for (const f of floors) {
    for (const end of ["l", "r"] as const) {
      const c = end === "l" ? f.cells[0] : f.cells[f.cells.length - 1];
      const from = endWp(f, end);
      if (!from) continue;
      const x = c.x + (end === "l" ? -2 : 2);
      if (x < 0 || x >= m.w) continue;
      for (let y = c.y + 1; y < m.h && y <= c.y + DROP_MAX; y++) {
        if (!mat(m, x, y).solid) continue;
        const g = at(x, y);
        const to = g && g !== f ? nearest(g, x * CELL) : null;
        if (to) link(from, to, true);
        break;
      }
    }
  }

  const points = floors.flatMap((f) => f.wps);
  return { points, boxes, cross };
}

function adjacency(points: readonly NavPoint[]): Map<string, string[]> {
  const ids = new Set(points.map((p) => p.id));
  const adj = new Map(points.map((p) => [p.id, p.links.filter((id) => ids.has(id))]));
  const inbound = new Set<string>();
  for (const l of adj.values()) for (const t of l) inbound.add(t);
  for (const [id, l] of adj) {
    if (inbound.has(id)) continue;
    for (const t of l) {
      const back = adj.get(t)!;
      if (!back.includes(id)) back.push(id);
    }
  }
  return adj;
}

function pathCount(adj: Map<string, string[]>, src: string, cap: number): number {
  let n = 0;
  const on = new Set<string>();
  const go = (id: string): void => {
    if (n > cap) return;
    n++;
    on.add(id);
    for (const t of adj.get(id) ?? []) if (!on.has(t)) go(t);
    on.delete(id);
  };
  go(src);
  return n;
}

function maxPaths(adj: Map<string, string[]>, cap: number, first?: string): { n: number; at: string } {
  const order = [...adj.keys()];
  if (first && adj.has(first)) order.unshift(first);
  let worst = { n: 0, at: "" };
  for (const id of order) {
    const n = pathCount(adj, id, cap);
    if (n > worst.n) worst = { n, at: id };
    if (n > cap) break;
  }
  return worst;
}

function reachable(adj: Map<string, string[]>, src: string): Set<string> {
  const seen = new Set([src]);
  const stack = [src];
  while (stack.length) {
    for (const t of adj.get(stack.pop()!) ?? []) {
      if (!seen.has(t)) { seen.add(t); stack.push(t); }
    }
  }
  return seen;
}

function reachPairs(adj: Map<string, string[]>): number {
  let n = 0;
  for (const id of adj.keys()) n += reachable(adj, id).size;
  return n;
}

function nearestPoint(points: readonly NavPoint[], x: number, y: number): NavPoint | null {
  let best: NavPoint | null = null;
  let bd = Infinity;
  for (const p of points) {
    const d = Math.abs(p.x - x) + 3 * Math.abs(p.y - y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function flagPoint(nav: NavGraph, m: CustomMap, team: 1 | 2): NavPoint | null {
  const f = m.flags.find((o) => o.team === team);
  if (!f) return null;
  const y = settle(m, f.x, lift(m, f.x, f.y) - CELL);
  const p = nearestPoint(nav.points, f.x, y);
  return p && Math.abs(p.x - f.x) <= 30 && Math.abs(p.y - y) <= 20 ? p : null;
}

function dropPoints(g: NavGraph, drop: Set<string>): void {
  g.points = g.points.filter((p) => !drop.has(p.id));
  for (const p of g.points) p.links = p.links.filter((id) => !drop.has(id));
  g.boxes = g.boxes.filter((b) => !drop.has(b.target) && !drop.has(b.from));
}

function fitCtf(g: Built, m: CustomMap): number {
  for (;;) {
    const inbound = new Set<string>();
    for (const p of g.points) for (const id of p.links) inbound.add(id);
    const lost = new Set(g.points.filter((p) => !inbound.has(p.id)).map((p) => p.id));
    if (!lost.size || lost.size === g.points.length) break;
    dropPoints(g, lost);
  }
  const f1 = flagPoint(g, m, 1);
  const f2 = flagPoint(g, m, 2);
  const adj = adjacency(g.points);
  if (f1 && f2 && reachable(adj, f1.id).has(f2.id) && reachable(adj, f2.id).has(f1.id)) {
    const drop = new Set<string>();
    for (const p of g.points) {
      const r = reachable(adj, p.id);
      if (!r.has(f1.id) || !r.has(f2.id)) drop.add(p.id);
    }
    dropPoints(g, drop);
  }

  const byId = new Map(g.points.map((p) => [p.id, p]));
  const pairs = new Map<string, { a: NavPoint; b: NavPoint; len: number }>();
  for (const key of g.cross) {
    const [ia, ib] = key.split(">");
    const a = byId.get(ia);
    const b = byId.get(ib);
    if (!a || !b) continue;
    const k = ia < ib ? `${ia}${ib}` : `${ib}${ia}`;
    if (!pairs.has(k)) pairs.set(k, { a, b, len: Math.hypot(a.x - b.x, a.y - b.y) });
  }
  const order = [...pairs.values()].sort((p, q) => q.len - p.len);

  let cur = adjacency(g.points);
  const base = reachPairs(cur);
  let worst = maxPaths(cur, CTF_PATH_BUDGET);
  for (const { a, b } of order) {
    if (worst.n <= CTF_PATH_BUDGET) break;
    const la = a.links;
    const lb = b.links;
    a.links = la.filter((id) => id !== b.id);
    b.links = lb.filter((id) => id !== a.id);
    const next = adjacency(g.points);
    if (reachPairs(next) < base) {
      a.links = la;
      b.links = lb;
      continue;
    }
    cur = next;
    worst = maxPaths(cur, CTF_PATH_BUDGET, worst.at);
  }
  g.boxes = g.boxes.filter((bx) => byId.get(bx.from)?.links.includes(bx.target));
  if (worst.n <= CTF_PATH_BUDGET) worst = maxPaths(cur, Infinity);
  return worst.n;
}

export function buildNav(m: CustomMap, mode = "tdm"): NavGraph {
  const { floors, floorAt } = findFloors(m);
  const extra = objectiveAnchors(m, mode, floors, floorAt);
  const ctf = mode === "ctf";
  const pick: { g: NavGraph | null; paths: number } = { g: null, paths: Infinity };
  const offer = (g: Built | null): boolean => {
    if (!g) return false;
    if (!ctf) { pick.g = g; return true; }
    const n = fitCtf(g, m);
    if (n < pick.paths) { pick.g = g; pick.paths = n; }
    return n <= CTF_PATH_BUDGET;
  };
  const result = (): NavGraph => ({ points: pick.g!.points, boxes: pick.g!.boxes });

  for (const fill of [40, 70, 120, 1000]) {
    if (offer(tryGraph(m, floors, floorAt, fill, extra))) return result();
  }
  if (pick.g) return result();
  const kept = [...floors].sort((a, b) =>
    Number(extra.has(b)) - Number(extra.has(a)) || b.cells.length - a.cells.length);
  while (kept.length > 1 && !extra.has(kept[kept.length - 1])) {
    kept.pop();
    const keep = new Set(kept);
    const idx = new Int32Array(floorAt.length).fill(-1);
    const list = floors.filter((f) => keep.has(f));
    list.forEach((f, i) => { for (const c of f.cells) idx[c.y * m.w + c.x] = i; });
    if (offer(tryGraph(m, list, idx, 1000, extra)) || pick.g) return result();
  }
  return { points: [], boxes: [] };
}

export function lift(m: CustomMap, x: number, y: number): number {
  const cx = Math.max(0, Math.min(m.w - 1, Math.floor(x / CELL)));
  let cy = Math.floor((y - 1) / CELL);
  for (let guard = 0; guard < m.h; guard++) {
    let blocked = -1;
    for (let i = 0; i < HEADROOM; i++) {
      const r = cy - i;
      if (r >= 0 && r < m.h && mat(m, cx, r).solid) { blocked = r; break; }
    }
    if (blocked < 0) return guard ? feet(cy + 1) : y;
    let top = blocked;
    while (top > 0 && mat(m, cx, top - 1).solid) top--;
    if (top <= 0) return y;
    cy = top - 1;
  }
  return y;
}

export function settle(m: CustomMap, x: number, y: number): number {
  const cx = Math.max(0, Math.min(m.w - 1, Math.floor(x / CELL)));
  for (let cy = Math.max(0, Math.floor(y / CELL)); cy < m.h; cy++) {
    if (mat(m, cx, cy).solid) return feet(cy);
  }
  return y;
}

export interface BuildIssue { level: "error" | "warn"; text: string }

const TEAM_NAME = ["", "red", "blue"] as const;

export function checkMap(m: CustomMap, mode: string, nav = buildNav(m, mode)): BuildIssue[] {
  const out: BuildIssue[] = [];
  if (!m.spawns.length) out.push({ level: "error", text: "Place at least one spawn point." });
  if (!nav.points.length) {
    out.push({ level: "error", text: "No floor wide enough to stand on: bots need somewhere to walk." });
  }
  const t1 = m.spawns.some((s) => s.team === 1);
  const t2 = m.spawns.some((s) => s.team === 2);
  const ffa = m.spawns.some((s) => s.team === 0);
  const teams = mode !== "dm";
  if (teams && (!t1 || !t2)) {
    out.push({ level: "warn", text: "Team modes want both a red and a blue spawn; the missing team will share." });
  }
  if (mode === "dm" && !ffa) {
    out.push({ level: "warn", text: "No free-for-all spawns: team spawns will be used." });
  }
  if (mode === "ctf") {
    const pts: (NavPoint | null)[] = [];
    for (const team of [1, 2] as const) {
      if (!m.flags.some((f) => f.team === team)) {
        out.push({ level: "error", text: `Capture the Flag needs a ${TEAM_NAME[team]} flag.` });
        pts.push(null);
        continue;
      }
      const p = flagPoint(nav, m, team);
      if (!p) {
        out.push({ level: "error",
          text: `The ${TEAM_NAME[team]} flag must stand on a floor bots can walk to (6 cells of air above it).` });
      }
      pts.push(p);
    }
    const [a, b] = pts;
    if (a && b) {
      const adj = adjacency(nav.points);
      if (!reachable(adj, a.id).has(b.id) || !reachable(adj, b.id).has(a.id)) {
        out.push({ level: "error",
          text: "Bots cannot get from one flag to the other and back. A Bot jump across the gap fixes it." });
      }
    }
  }
  if (mode === "dom") {
    if (!m.holds.length) out.push({ level: "error", text: "Domination needs at least one zone." });
    const lost = m.holds.filter((h) => {
      const y = settle(m, h.x, h.y - CELL);
      const p = nearestPoint(nav.points, h.x, y);
      return !p || Math.abs(p.x - h.x) > 60 || Math.abs(p.y - y) > 20;
    }).length;
    if (lost) {
      out.push({ level: "warn",
        text: `${lost} zone${lost > 1 ? "s are" : " is"} off the bots' paths: bots will rarely take ${lost > 1 ? "them" : "it"}.` });
    }
  }
  return out;
}

export function buildArena(m: CustomMap, mode: string): ArenaDef {
  const nav = buildNav(m, mode);
  const nodes: RawNode[] = [];
  for (const p of nav.points) {
    nodes.push({ kind: "waypoint", name: `${p.id}_${p.links.join("")}`, x: p.x, y: p.y });
  }
  for (const b of nav.boxes) {
    nodes.push({
      kind: "aiaction", name: `j_${b.target}`,
      x: b.x, y: b.y, width: b.width, height: b.height,
    });
  }
  nodes.push(...buildPhysBoxes(m));

  const nearest = (x: number, y: number): string => nearestPoint(nav.points, x, y)?.id ?? "";
  const ground = (x: number, y: number): number => settle(m, x, lift(m, x, y) - CELL);
  let spawns = m.spawns.map((s) => ({ ...s, y: ground(s.x, s.y) }));
  const has = (t: number) => spawns.some((s) => s.team === t);
  if (mode === "dm" && !has(0)) spawns = spawns.map((s) => ({ ...s, team: 0 as const }));
  if (mode !== "dm") {
    const free = spawns.filter((s) => s.team === 0);
    if (!has(1)) spawns.push(...(free.length ? free : spawns).map((s) => ({ ...s, team: 1 as const })));
    if (!has(2)) spawns.push(...(free.length ? free : spawns).map((s) => ({ ...s, team: 2 as const })));
  }
  for (const s of spawns) {
    nodes.push({ kind: "spawn", name: `${nearest(s.x, s.y)}_${s.team}`, x: s.x, y: s.y });
  }
  for (const it of m.items) {
    nodes.push({
      kind: "pickup", name: `${it.kind}_${ITEM_RESPAWN}`,
      x: it.x, y: ground(it.x, it.y), rotation: 0,
    });
  }
  for (const f of m.flags) {
    const y = ground(f.x, f.y);
    nodes.push({ kind: "ctfflag", name: `${nearest(f.x, y)}__${f.team}`, x: f.x, y, rotation: 0 });
  }
  for (const h of m.holds) {
    nodes.push({ kind: "holdpoint", name: "", x: h.x, y: ground(h.x, h.y), rotation: 0 });
  }
  return { wall: buildMask(m), nodes };
}
