export type EaseFn = (t: number) => number;

export const Ease = {
  linear: (t: number): number => t,
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export interface TweenOpts {
  ease?: EaseFn;
  delay?: number;
  onDone?: () => void;
  owner?: object;
}

interface Job {
  apply: (t: number) => void;
  ms: number;
  elapsed: number;
  delay: number;
  ease: EaseFn;
  onDone?: () => void;
  owner?: object;
}

class TweenSystem {
  private jobs: Job[] = [];

  to(ms: number, apply: (t: number) => void, opts: TweenOpts = {}): void {
    const ease = opts.ease ?? Ease.outCubic;
    const delay = opts.delay ?? 0;
    if (ms <= 0 && delay <= 0) {
      apply(1);
      opts.onDone?.();
      return;
    }
    apply(0);
    this.jobs.push({
      apply,
      ms,
      elapsed: 0,
      delay,
      ease,
      onDone: opts.onDone,
      owner: opts.owner,
    });
  }

  update(dtMs: number): void {
    if (!this.jobs.length) return;
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      if (j.delay > 0) {
        j.delay -= dtMs;
        if (j.delay > 0) continue;
        j.elapsed = -j.delay;
        j.delay = 0;
      } else {
        j.elapsed += dtMs;
      }
      const raw = j.ms > 0 ? Math.min(1, j.elapsed / j.ms) : 1;
      j.apply(j.ease(raw));
      if (raw >= 1) {
        this.jobs.splice(i, 1);
        j.onDone?.();
      }
    }
  }

  cancel(owner?: object): void {
    this.jobs = owner ? this.jobs.filter((j) => j.owner !== owner) : [];
  }
}

export const Tween = new TweenSystem();

interface Fadeable {
  alpha: number;
}
interface Movable extends Fadeable {
  x: number;
  y: number;
}

export function fadeIn(target: Fadeable, ms = 250, opts: TweenOpts = {}): void {
  Tween.to(ms, (t) => void (target.alpha = t), opts);
}

export function slideIn(
  target: Movable,
  dx: number,
  dy: number,
  ms = 280,
  opts: TweenOpts = {},
): void {
  const restX = target.x;
  const restY = target.y;
  Tween.to(
    ms,
    (t) => {
      const k = 1 - t;
      target.x = restX + dx * k;
      target.y = restY + dy * k;
      target.alpha = t;
    },
    opts,
  );
}
