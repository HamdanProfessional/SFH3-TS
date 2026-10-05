import { computeStageSize } from "./Config";

interface Hints {
  matchMedia?: (q: string) => { matches: boolean };
  screen?: { width: number; height: number };
  navigator?: { hardwareConcurrency?: number; deviceMemory?: number; maxTouchPoints?: number };
  devicePixelRatio?: number;
  innerWidth?: number;
  innerHeight?: number;
}
const g = globalThis as Hints;
const browser = typeof g.matchMedia === "function";

function media(q: string): boolean {
  try {
    return !!g.matchMedia?.(q).matches;
  } catch {
    return false;
  }
}

export const isPhone: boolean = browser && (
  media("(pointer: coarse)")
  || Math.min(g.screen?.width ?? 1e4, g.screen?.height ?? 1e4) < 600
);

export const hasTouch: boolean = browser && (
  (g.navigator?.maxTouchPoints ?? 0) > 0 || media("(any-pointer: coarse)")
);

export const isLowPower: boolean = isPhone || (browser && (
  ((g.navigator?.hardwareConcurrency ?? 8) > 0 && (g.navigator?.hardwareConcurrency ?? 8) <= 2)
  || (g.navigator?.deviceMemory ?? 8) <= 2
));

let dprCap = Infinity;

export function setDprCap(cap: number): void {
  dprCap = cap;
}

export function deviceDpr(): number {
  return Math.min(g.devicePixelRatio || 1, dprCap);
}

export function screenDensity(): number {
  if (!browser) return 1;
  const dpr = deviceDpr();
  const { scale } = computeStageSize(Math.max(1, g.innerWidth ?? 1), Math.max(1, g.innerHeight ?? 1));
  return scale * dpr;
}
