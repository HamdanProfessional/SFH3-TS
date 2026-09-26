import type { DatabaseSync } from "node:sqlite";

export const FIRST_CLEAR_EXP = [0, 300, 700, 1500] as const;
export const REPEAT_SHARE = 0.25;

export type Cleared = Map<number, number>;

export class CoopProgress {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS coop_progress (
        account INTEGER NOT NULL,
        mission INTEGER NOT NULL,
        diff    INTEGER NOT NULL,
        clears  INTEGER NOT NULL DEFAULT 1,
        first   INTEGER NOT NULL,
        PRIMARY KEY (account, mission, diff)
      );
    `);
  }

  cleared(account: number): Cleared {
    const rows = this.db.prepare(
      "SELECT mission, MAX(diff) AS d FROM coop_progress WHERE account = ? GROUP BY mission",
    ).all(account) as unknown as { mission: number; d: number }[];
    return new Map(rows.map((r) => [Number(r.mission), Number(r.d)]));
  }

  record(account: number, mission: number, diff: number): boolean {
    const had = this.db.prepare(
      "SELECT clears FROM coop_progress WHERE account = ? AND mission = ? AND diff = ?",
    ).get(account, mission, diff) as { clears: number } | undefined;
    this.db.prepare(`
      INSERT INTO coop_progress (account, mission, diff, clears, first) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT (account, mission, diff) DO UPDATE SET clears = clears + 1
    `).run(account, mission, diff, Date.now());
    return !had;
  }
}

export function unlocked(list: readonly number[], cleared: Cleared | null,
  mission: number, diff: number): boolean {
  const at = list.indexOf(mission);
  if (at < 0) return false;
  const best = (m: number): number => cleared?.get(m) ?? 0;
  const prevOk = at === 0 || best(list[at - 1]) >= diff;
  const stepOk = diff === 1 || best(mission) >= diff - 1;
  return prevOk && stepOk;
}

export function clearBonus(diff: number, first: boolean): number {
  const full = FIRST_CLEAR_EXP[diff] ?? 0;
  return first ? full : Math.round(full * REPEAT_SHARE);
}
