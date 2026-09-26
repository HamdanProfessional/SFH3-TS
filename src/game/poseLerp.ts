export type Row = (string | number)[];

function lerpAngle(from: number, to: number, t: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}

export function lerpPlacement(p: Row, c: Row, t: number, out: number[]): void {
  const a1 = Number(p[1]), b1 = Number(p[2]), c1 = Number(p[3]), d1 = Number(p[4]);
  const a2 = Number(c[1]), b2 = Number(c[2]), c2 = Number(c[3]), d2 = Number(c[4]);

  const rx = lerpAngle(Math.atan2(b1, a1), Math.atan2(b2, a2), t);
  const ry = lerpAngle(Math.atan2(-c1, d1), Math.atan2(-c2, d2), t);
  const sx1 = Math.hypot(a1, b1), sx2 = Math.hypot(a2, b2);
  const sy1 = Math.hypot(c1, d1), sy2 = Math.hypot(c2, d2);
  const sx = sx1 + (sx2 - sx1) * t;
  const sy = sy1 + (sy2 - sy1) * t;

  out[0] = Math.cos(rx) * sx;
  out[1] = Math.sin(rx) * sx;
  out[2] = -Math.sin(ry) * sy;
  out[3] = Math.cos(ry) * sy;
  out[4] = Number(p[5]) + (Number(c[5]) - Number(p[5])) * t;
  out[5] = Number(p[6]) + (Number(c[6]) - Number(p[6])) * t;
}

export function lerpRows(prev: readonly Row[], cur: readonly Row[], t: number): readonly Row[] {
  if (t >= 1 || !prev.length || !cur.length) return cur;
  if (t <= 0) return prev.length === cur.length ? prev : cur;

  const out: Row[] = [];
  for (const e of cur) {
    const name = e[0];
    let from: Row | undefined;
    for (const p of prev) {
      if (p[0] === name) { from = p; break; }
    }
    if (!from) { out.push(e); continue; }
    const m: number[] = [0, 0, 0, 0, 0, 0];
    lerpPlacement(from, e, t, m);
    out.push([name, m[0], m[1], m[2], m[3], m[4], m[5]]);
  }
  return out;
}

export function isStep(prev: number, cur: number): boolean {
  return cur === prev + 1;
}
