import type { RoomKind, RoomPhase } from "../src/net/protocol";

export type TickHealth = "green" | "amber" | "red";

export interface ServerStatus {
  ok: true;
  protocol: number;
  name: string;
  kind: RoomKind;
  phase: RoomPhase;
  map: string;
  mode: string;
  startedAt: string;
  uptimeSec: number;
  node: string;
  players: number;
  maxPlayers: number;
  spectators: number;
  bots: number;
  peakToday: { date: string; players: number };
  rounds: number;
  roundsAbandoned: number;
  connections: number;
  tick: {
    hz: number;
    budgetMs: number;
    samples: number;
    avgMs: number;
    worstMs: number;
    overruns: number;
    overrunsTotal: number;
    stalls: number;
    health: TickHealth;
  };
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  errors: { total: number; recent: { at: string; line: string }[] };
}

interface Bucket {
  sec: number;
  n: number;
  sum: number;
  worst: number;
  over: number;
}

const WINDOW_SEC = 60;
const RECENT_ERRORS = 20;
const LINE_MAX = 300;

export function scrub(line: string): string {
  return line
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[ip]")
    .replace(/\b(?:[0-9a-f]{1,4}:){5,7}[0-9a-f]{1,4}\b/gi, "[ip]")
    .replace(/(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:?){0,7}(?:\[ip\])?/gi, "[ip]")
    .replace(/[A-Za-z0-9_\-+/=.]{32,}/g, "[redacted]")
    .slice(0, LINE_MAX);
}

export class StatusTracker {
  readonly startedAt = Date.now();
  private readonly budgetMs: number;
  private buckets: Bucket[] = [];
  private overrunsTotal = 0;
  private stalls = 0;
  private rounds = 0;
  private abandoned = 0;
  private lastPhase: RoomPhase | null = null;
  private peakDate = "";
  private peak = 0;
  private lastPeakCheck = 0;
  private errorTotal = 0;
  private recent: { at: string; line: string }[] = [];

  constructor(readonly hz: number) {
    this.budgetMs = 1000 / hz;
  }

  tick(update: () => void): void {
    const t0 = performance.now();
    update();
    const ms = performance.now() - t0;
    const sec = Math.floor(Date.now() / 1000);
    let b = this.buckets[this.buckets.length - 1];
    if (!b || b.sec !== sec) {
      b = { sec, n: 0, sum: 0, worst: 0, over: 0 };
      this.buckets.push(b);
      while (this.buckets.length && this.buckets[0].sec <= sec - WINDOW_SEC) this.buckets.shift();
    }
    b.n++;
    b.sum += ms;
    if (ms > b.worst) b.worst = ms;
    if (ms > this.budgetMs) { b.over++; this.overrunsTotal++; }
  }

  stall(): void {
    this.stalls++;
  }

  observe(phase: RoomPhase, players: () => number): void {
    if (phase !== this.lastPhase) {
      if (this.lastPhase === "live" && phase === "over") this.rounds++;
      else if (this.lastPhase === "live" && phase === "lobby") this.abandoned++;
      this.lastPhase = phase;
    }
    const now = Date.now();
    if (now - this.lastPeakCheck < 1000) return;
    this.lastPeakCheck = now;
    const date = new Date(now).toISOString().slice(0, 10);
    if (date !== this.peakDate) { this.peakDate = date; this.peak = 0; }
    this.peak = Math.max(this.peak, players());
  }

  countError(line: string): void {
    this.errorTotal++;
    this.recent.push({ at: new Date().toISOString(), line: scrub(line) });
    if (this.recent.length > RECENT_ERRORS) this.recent.shift();
  }

  hookConsole(): void {
    const orig = console.error.bind(console);
    console.error = (...a: unknown[]): void => {
      try {
        this.countError(a.map((x) => (x instanceof Error ? (x.stack ?? x.message)
          : typeof x === "string" ? x : safeJson(x))).join(" "));
      } catch {}
      orig(...a);
    };
  }

  private tickStats(): ServerStatus["tick"] {
    const since = Math.floor(Date.now() / 1000) - WINDOW_SEC;
    let n = 0, sum = 0, worst = 0, over = 0;
    for (const b of this.buckets) {
      if (b.sec <= since) continue;
      n += b.n; sum += b.sum; over += b.over;
      if (b.worst > worst) worst = b.worst;
    }
    const avg = n ? sum / n : 0;
    const health: TickHealth =
      avg > this.budgetMs / 2 || over > n / 20 ? "red"
        : over > 0 || avg > this.budgetMs / 4 ? "amber" : "green";
    return {
      hz: this.hz,
      budgetMs: round2(this.budgetMs),
      samples: n,
      avgMs: round2(avg),
      worstMs: round2(worst),
      overruns: over,
      overrunsTotal: this.overrunsTotal,
      stalls: this.stalls,
      health,
    };
  }

  snapshot(room: Omit<ServerStatus, "startedAt" | "uptimeSec" | "node" | "peakToday"
    | "rounds" | "roundsAbandoned" | "tick" | "memory" | "errors">): ServerStatus {
    const mem = process.memoryUsage();
    const mb = (b: number): number => Math.round(b / 1048576 * 10) / 10;
    return {
      ...room,
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      node: process.version,
      peakToday: { date: this.peakDate || new Date().toISOString().slice(0, 10), players: this.peak },
      rounds: this.rounds,
      roundsAbandoned: this.abandoned,
      tick: this.tickStats(),
      memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal) },
      errors: { total: this.errorTotal, recent: [...this.recent] },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeJson(x: unknown): string {
  try { return JSON.stringify(x) ?? String(x); } catch { return String(x); }
}
