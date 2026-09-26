import type { DatabaseSync } from "node:sqlite";
import { AccountError } from "./accounts";
import type { FriendRow, FriendsReply } from "../src/net/protocol";

export const MAX_FRIENDS = 100;
export const MAX_OUTGOING = 30;
export const ONLINE_MS = 90_000;

export interface RoomPresence {
  room: string;
  code: string;
}

export class FriendStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS friends (
        a     INTEGER NOT NULL,
        b     INTEGER NOT NULL,
        since INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE TABLE IF NOT EXISTS friend_requests (
        src INTEGER NOT NULL,
        dst INTEGER NOT NULL,
        at  INTEGER NOT NULL,
        PRIMARY KEY (src, dst)
      );
      CREATE INDEX IF NOT EXISTS friend_requests_by_dst ON friend_requests (dst);
      CREATE TABLE IF NOT EXISTS presence (
        account INTEGER PRIMARY KEY,
        room    TEXT NOT NULL DEFAULT '',
        code    TEXT NOT NULL DEFAULT '',
        at      INTEGER NOT NULL
      );
    `);
  }

  inRoom(accounts: readonly number[], p: RoomPresence, now = Date.now()): void {
    if (!accounts.length) return;
    const put = this.db.prepare(`
      INSERT INTO presence (account, room, code, at) VALUES (?, ?, ?, ?)
      ON CONFLICT (account) DO UPDATE SET room = excluded.room, code = excluded.code, at = excluded.at
    `);
    for (const a of accounts) put.run(a, p.room, p.code, now);
  }

  leftRoom(account: number, room: string, now = Date.now()): void {
    this.db.prepare(
      "UPDATE presence SET room = '', code = '', at = ? WHERE account = ? AND room = ?",
    ).run(now, account, room);
  }

  private touch(account: number, now: number): void {
    this.db.prepare(`
      INSERT INTO presence (account, room, code, at) VALUES (?, '', '', ?)
      ON CONFLICT (account) DO UPDATE SET
        room = CASE WHEN at < ? THEN '' ELSE room END,
        code = CASE WHEN at < ? THEN '' ELSE code END,
        at = ?
    `).run(account, now, now - ONLINE_MS, now - ONLINE_MS, now);
  }

  list(account: number, now = Date.now()): FriendsReply {
    this.touch(account, now);
    const friends = this.db.prepare(`
      SELECT a.name, p.room, p.code, p.at FROM friends f
      JOIN accounts a ON a.id = f.b
      LEFT JOIN presence p ON p.account = f.b
      WHERE f.a = ? ORDER BY a.name COLLATE NOCASE
    `).all(account) as unknown as
      { name: string; room: string | null; code: string | null; at: number | null }[];
    const rows: FriendRow[] = friends.map((f) => {
      const online = f.at !== null && Number(f.at) >= now - ONLINE_MS;
      return {
        name: f.name,
        online,
        room: online ? f.room ?? "" : "",
        code: online ? f.code ?? "" : "",
      };
    });
    rows.sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
    const names = (sql: string): string[] =>
      (this.db.prepare(sql).all(account) as unknown as { name: string }[]).map((r) => r.name);
    return {
      ok: true,
      friends: rows,
      incoming: names(`SELECT a.name FROM friend_requests r JOIN accounts a ON a.id = r.src
                       WHERE r.dst = ? ORDER BY r.at DESC`),
      outgoing: names(`SELECT a.name FROM friend_requests r JOIN accounts a ON a.id = r.dst
                       WHERE r.src = ? ORDER BY r.at DESC`),
    };
  }

  add(account: number, rawName: unknown): FriendsReply {
    const other = this.idOf(rawName);
    if (other === account) throw new AccountError(400, "That is you");
    this.tx(() => {
      if (this.isFriend(account, other)) throw new AccountError(409, "Already friends");
      const theirs = this.db.prepare("SELECT 1 FROM friend_requests WHERE src = ? AND dst = ?")
        .get(other, account);
      if (theirs) {
        this.befriend(account, other);
        return;
      }
      const out = this.db.prepare("SELECT COUNT(*) AS n FROM friend_requests WHERE src = ?")
        .get(account) as { n: number };
      if (Number(out.n) >= MAX_OUTGOING) throw new AccountError(429, "Too many requests waiting");
      this.checkRoom(account);
      this.db.prepare("INSERT OR IGNORE INTO friend_requests (src, dst, at) VALUES (?, ?, ?)")
        .run(account, other, Date.now());
    });
    return this.list(account);
  }

  accept(account: number, rawName: unknown): FriendsReply {
    const other = this.idOf(rawName);
    this.tx(() => {
      const theirs = this.db.prepare("SELECT 1 FROM friend_requests WHERE src = ? AND dst = ?")
        .get(other, account);
      if (!theirs) throw new AccountError(404, "No request from them");
      this.befriend(account, other);
    });
    return this.list(account);
  }

  decline(account: number, rawName: unknown): FriendsReply {
    const other = this.idOf(rawName);
    this.db.prepare(
      "DELETE FROM friend_requests WHERE (src = ? AND dst = ?) OR (src = ? AND dst = ?)",
    ).run(other, account, account, other);
    return this.list(account);
  }

  remove(account: number, rawName: unknown): FriendsReply {
    const other = this.idOf(rawName);
    this.db.prepare("DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)")
      .run(account, other, other, account);
    return this.list(account);
  }

  private befriend(me: number, other: number): void {
    this.checkRoom(me);
    this.checkRoom(other);
    const now = Date.now();
    const put = this.db.prepare("INSERT OR IGNORE INTO friends (a, b, since) VALUES (?, ?, ?)");
    put.run(me, other, now);
    put.run(other, me, now);
    this.db.prepare(
      "DELETE FROM friend_requests WHERE (src = ? AND dst = ?) OR (src = ? AND dst = ?)",
    ).run(me, other, other, me);
  }

  private checkRoom(account: number): void {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM friends WHERE a = ?").get(account) as
      { n: number };
    if (Number(r.n) >= MAX_FRIENDS) throw new AccountError(409, `Friend lists hold ${MAX_FRIENDS}`);
  }

  private isFriend(a: number, b: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM friends WHERE a = ? AND b = ?").get(a, b);
  }

  private idOf(rawName: unknown): number {
    const name = String(rawName ?? "").trim().slice(0, 32);
    const row = name
      ? this.db.prepare("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE").get(name) as
        { id: number } | undefined
      : undefined;
    if (!row) throw new AccountError(404, "No player by that name");
    return Number(row.id);
  }

  private tx(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
