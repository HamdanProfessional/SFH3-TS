import type { DatabaseSync } from "node:sqlite";
import {
  START_RATING, prevSeason, rankLabel, ratingDelta, seasonOf, softReset, tierOf,
} from "../src/net/ranks";
import type { RankedRow, RankedMe } from "../src/net/protocol";

export interface Rating {
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface RankedEntry {
  account: number;
  team: number;
  quit: boolean;
}

export interface RatingChange {
  account: number;
  from: number;
  to: number;
  games: number;
}

export class RatingStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        account INTEGER NOT NULL,
        season  TEXT NOT NULL,
        rating  INTEGER NOT NULL,
        games   INTEGER NOT NULL DEFAULT 0,
        wins    INTEGER NOT NULL DEFAULT 0,
        peak    INTEGER NOT NULL,
        PRIMARY KEY (account, season)
      );
      CREATE INDEX IF NOT EXISTS ratings_by_season ON ratings (season, rating);
    `);
  }

  get(account: number, season = seasonOf()): Rating {
    const row = this.row(account, season);
    if (row) return row;
    const prev = this.row(account, prevSeason(season));
    const start = softReset(prev ? prev.rating : null);
    return { rating: start, games: 0, wins: 0, peak: start };
  }

  settle(entries: readonly RankedEntry[], winner: number, season = seasonOf()): RatingChange[] {
    if (entries.length < 2) return [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = entries.map((e) => ({ e, r: this.get(e.account, season) }));
      const avg = (team: number): number => {
        const side = now.filter((x) => x.e.team === team);
        return side.length ? side.reduce((s, x) => s + x.r.rating, 0) / side.length : START_RATING;
      };
      const t1 = avg(1);
      const t2 = avg(2);
      const out: RatingChange[] = [];
      const put = this.db.prepare(`
        INSERT INTO ratings (account, season, rating, games, wins, peak)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (account, season) DO UPDATE SET
          rating = excluded.rating, games = excluded.games,
          wins = excluded.wins, peak = excluded.peak
      `);
      for (const { e, r } of now) {
        const mine = e.team === 1 ? t1 : t2;
        const theirs = e.team === 1 ? t2 : t1;
        const score = e.quit ? 0 : winner === 0 ? 0.5 : winner === e.team ? 1 : 0;
        const to = Math.max(0, r.rating + ratingDelta(mine, theirs, score, r.games));
        const games = r.games + 1;
        put.run(e.account, season, to, games, r.wins + (score === 1 ? 1 : 0), Math.max(r.peak, to));
        out.push({ account: e.account, from: r.rating, to, games });
      }
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  top(season = seasonOf(), limit = 50): RankedRow[] {
    const rows = this.db.prepare(`
      SELECT a.name, r.rating, r.games, r.wins, r.peak
      FROM ratings r JOIN accounts a ON a.id = r.account
      WHERE r.season = ?
      ORDER BY (r.games >= 5) DESC, r.rating DESC, r.games DESC
      LIMIT ?
    `).all(season, Math.max(1, Math.min(100, limit))) as unknown as
      { name: string; rating: number; games: number; wins: number; peak: number }[];
    return rows.map((r) => ({
      name: r.name, rating: r.rating, games: r.games, wins: r.wins, peak: r.peak,
      tier: tierOf(r.rating, r.games),
    }));
  }

  me(account: number): RankedMe {
    const season = seasonOf();
    const cur = this.get(account, season);
    const past = this.db.prepare(`
      SELECT season, rating, games, wins, peak FROM ratings
      WHERE account = ? AND season <> ? ORDER BY season DESC LIMIT 8
    `).all(account, season) as unknown as
      { season: string; rating: number; games: number; wins: number; peak: number }[];
    return {
      ok: true,
      season,
      ...cur,
      rank: rankLabel(cur.rating, cur.games),
      tier: tierOf(cur.rating, cur.games),
      history: past.map((p) => ({ ...p, tier: tierOf(p.rating, p.games) })),
    };
  }

  private row(account: number, season: string): Rating | null {
    if (!season) return null;
    const r = this.db.prepare(
      "SELECT rating, games, wins, peak FROM ratings WHERE account = ? AND season = ?",
    ).get(account, season) as Rating | undefined;
    return r ? { rating: Number(r.rating), games: Number(r.games), wins: Number(r.wins), peak: Number(r.peak) } : null;
  }
}
