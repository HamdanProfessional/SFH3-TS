export const BASE_LAG = 3;
export const MAX_LAG = 9;
const CATCHUP = 0.08;
const MAX_ADJ = 0.25;
export const RESYNC = 30;
const PATIENCE = 300;

export interface Stamped {
  t: number;
}

export interface Bracket<T> {
  a: T;
  b: T;
  f: number;
}

export class PlaybackClock {
  play = -1;
  firedTo = -1;
  lag = BASE_LAG;
  private sinceDry = 0;
  resynced = false;

  advance(newest: number): void {
    const target = newest - this.lag;
    this.resynced = false;

    if (this.play < 0 || Math.abs(target - this.play) > RESYNC) {
      this.play = target;
      this.firedTo = target;
      this.resynced = true;
      return;
    }

    if (this.play >= newest) {
      this.lag = Math.min(MAX_LAG, this.lag + 0.5);
      this.sinceDry = 0;
    } else if (++this.sinceDry > PATIENCE && this.lag > BASE_LAG) {
      this.lag = Math.max(BASE_LAG, this.lag - 0.5);
      this.sinceDry = 0;
    }

    const drift = target - this.play;
    this.play += 1 + Math.max(-MAX_ADJ, Math.min(MAX_ADJ, drift * CATCHUP));
    if (this.play > newest) this.play = newest;
  }

  bracket<T extends Stamped>(snaps: readonly T[], at = this.play): Bracket<T> {
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].t > at) i--;
    const a = snaps[i];
    const b = snaps[i + 1] ?? a;
    const span = b.t - a.t;
    const f = span > 0 ? clamp01((at - a.t) / span) : 0;
    return { a, b, f };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function angleLerp(from: number, to: number, f: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return from + d * f;
}

export function playhead(
  cur: number, to: number | undefined, f: number, sameClip: boolean,
): number {
  if (to === undefined || !sameClip || f <= 0 || to <= cur) return cur;
  return Math.round(cur + (to - cur) * f);
}
