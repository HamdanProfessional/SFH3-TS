export type QualityLevel = "low" | "medium" | "high" | "max";

export const QUALITY_LEVELS: QualityLevel[] = ["low", "medium", "high", "max"];

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

export interface QualityProfile {
  particleScale: number;
  detail: boolean;
  maxFx: number;
  tracerLife: number;
  maxFps: number;
  stageQuality: string;
}

const PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    particleScale: 0.35,
    detail: false,
    maxFx: 12,
    tracerLife: 3,
    maxFps: 30,
    stageQuality: "low",
  },
  medium: {
    particleScale: 0.6,
    detail: true,
    maxFx: 24,
    tracerLife: 4,
    maxFps: 45,
    stageQuality: "medium",
  },
  high: {
    particleScale: 1,
    detail: true,
    maxFx: 40,
    tracerLife: 5,
    maxFps: 60,
    stageQuality: "high",
  },
  max: {
    particleScale: 1.4,
    detail: true,
    maxFx: 80,
    tracerLife: 6,
    maxFps: 0,
    stageQuality: "best",
  },
};

export function normalizeQuality(v: unknown): QualityLevel {
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if ((QUALITY_LEVELS as string[]).includes(s)) return s as QualityLevel;
    if (s === "best") return "max";
    if (s === "med") return "medium";
  }
  if (typeof v === "number" && v >= 0 && v < QUALITY_LEVELS.length) {
    return QUALITY_LEVELS[v | 0];
  }
  return "high";
}

type Listener = () => void;

class QualityState {
  level: QualityLevel = "high";
  glow = true;
  ragev = true;
  graphPart = 2;

  particleScale = PROFILES.high.particleScale;
  detail = PROFILES.high.detail;
  maxFx = PROFILES.high.maxFx;
  tracerLife = PROFILES.high.tracerLife;
  maxFps = PROFILES.high.maxFps;
  stageQuality = PROFILES.high.stageQuality;

  private listeners: Listener[] = [];

  get index(): number {
    return QUALITY_LEVELS.indexOf(this.level);
  }

  get label(): string {
    return QUALITY_LABELS[this.level];
  }

  stars(filled = "*", empty = "-"): string {
    const n = this.index + 1;
    return filled.repeat(n) + empty.repeat(QUALITY_LEVELS.length - n);
  }

  nextLevel(): QualityLevel {
    return QUALITY_LEVELS[(this.index + 1) % QUALITY_LEVELS.length];
  }

  set(level: QualityLevel, noGlow: boolean, ragev = true, graphPart = 2): void {
    this.level = level;
    this.ragev = ragev;
    this.graphPart = Math.max(0, Math.min(3, graphPart | 0));
    const p = PROFILES[level];
    this.particleScale = p.particleScale;
    this.detail = p.detail;
    this.maxFx = p.maxFx;
    this.tracerLife = p.tracerLife;
    this.maxFps = p.maxFps;
    this.stageQuality = p.stageQuality;
    this.glow = !noGlow && level !== "low";
    for (const l of this.listeners.slice()) l();
  }

  onChange(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  count(n: number): number {
    return Math.max(1, Math.round(n * this.particleScale));
  }
}

export const Quality = new QualityState();
