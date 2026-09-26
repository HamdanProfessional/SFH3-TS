import type { DatabaseSync } from "node:sqlite";
import { AccountError } from "./accounts";
import type { ProfileMatch, RoomKind } from "../src/net/protocol";

export const KEEP = 50;
export const SHOWN = 20;

export interface HistoryRow {
  account: number;
  room: string;
  kind: RoomKind;
  mode: string;
  map: string;
  won: number;
  kills: number;
  deaths: number;
  exp: number;
  rating?: number;
}

export class HistoryStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS match_history (
        id      INTEGER PRIMARY KEY,
        account INTEGER NOT NULL,
        at      INTEGER NOT NULL,
        room    TEXT NOT NULL,
        kind    TEXT NOT NULL,
        mode    TEXT NOT NULL,
        map     TEXT NOT NULL,
        won     INTEGER NOT NULL,
        kills   INTEGER NOT NULL,
        deaths  INTEGER NOT NULL,
        exp     INTEGER NOT NULL,
        rating  INTEGER
      );
      CREATE INDEX IF NOT EXISTS match_history_by_account ON match_history (account, at DESC);
      CREATE TABLE IF NOT EXISTS weapon_kills (
        account INTEGER NOT NULL,
        weapon  TEXT NOT NULL,
        kills   INTEGER NOT NULL,
        PRIMARY KEY (account, weapon)
      );
    `);
  }

  record(rows: readonly HistoryRow[], weapons: ReadonlyMap<number, ReadonlyMap<string, number>>,
    now = Date.now()): void {
    if (!rows.length && !weapons.size) return;
    const put = this.db.prepare(`
      INSERT INTO match_history (account, at, room, kind, mode, map, won, kills, deaths, exp, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const trim = this.db.prepare(`
      DELETE FROM match_history WHERE account = ? AND id NOT IN (
        SELECT id FROM match_history WHERE account = ? ORDER BY at DESC, id DESC LIMIT ?
      )
    `);
    const gun = this.db.prepare(`
      INSERT INTO weapon_kills (account, weapon, kills) VALUES (?, ?, ?)
      ON CONFLICT (account, weapon) DO UPDATE SET kills = kills + excluded.kills
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        put.run(r.account, now, r.room.slice(0, 40), r.kind, r.mode, r.map.slice(0, 40), r.won,
          r.kills, r.deaths, Math.round(r.exp), r.rating ?? null);
        trim.run(r.account, r.account, KEEP);
      }
      for (const [account, byGun] of weapons) {
        for (const [weapon, n] of byGun) if (n > 0) gun.run(account, weapon.slice(0, 40), n);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  recent(account: number, n = SHOWN): ProfileMatch[] {
    const rows = this.db.prepare(`
      SELECT at, room, kind, mode, map, won, kills, deaths, exp, rating FROM match_history
      WHERE account = ? ORDER BY at DESC, id DESC LIMIT ?
    `).all(account, n) as unknown as (Omit<ProfileMatch, "rating" | "kind"> &
      { kind: string; rating: number | null })[];
    return rows.map((r) => ({
      at: Number(r.at), room: r.room, kind: r.kind as RoomKind, mode: r.mode, map: r.map,
      won: Number(r.won), kills: Number(r.kills), deaths: Number(r.deaths), exp: Number(r.exp),
      ...(r.rating !== null ? { rating: Number(r.rating) } : {}),
    }));
  }

  weapons(account: number, n = 5): { id: string; kills: number }[] {
    return (this.db.prepare(`
      SELECT weapon AS id, kills FROM weapon_kills WHERE account = ? ORDER BY kills DESC LIMIT ?
    `).all(account, n) as unknown as { id: string; kills: number }[])
      .map((w) => ({ id: w.id, kills: Number(w.kills) }));
  }

  lookup(rawName: unknown): { id: number; name: string; since: number } {
    const name = String(rawName ?? "").trim().slice(0, 32);
    const row = name
      ? this.db.prepare("SELECT id, name, created FROM accounts WHERE name = ? COLLATE NOCASE")
        .get(name) as { id: number; name: string; created: number } | undefined
      : undefined;
    if (!row) throw new AccountError(404, "No player by that name");
    return { id: Number(row.id), name: row.name, since: Number(row.created) };
  }
}
