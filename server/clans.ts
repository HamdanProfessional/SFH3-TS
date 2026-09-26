import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { AccountError } from "./accounts";
import type {
  AccountStats, ClanMember, ClanRow, ClanView,
} from "../src/net/protocol";

export const CLAN_MAX_MEMBERS = 20;
const TAG_RE = /^[A-Z0-9]{2,4}$/;
const NAME_RE = /^[A-Za-z0-9 _.'!-]{3,24}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface ClanRowDb {
  id: number;
  tag: string;
  name: string;
  owner: number;
  code: string;
  created: number;
}

interface MemberRowDb {
  account: number;
  name: string;
  joined: number;
  profile: string;
}

function newCode(): string {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}

function statsOf(profile: string): AccountStats {
  try {
    const s = (JSON.parse(profile) as { stats?: Partial<AccountStats> }).stats ?? {};
    return {
      rounds: Number(s.rounds) || 0, wins: Number(s.wins) || 0,
      kills: Number(s.kills) || 0, deaths: Number(s.deaths) || 0,
    };
  } catch {
    return { rounds: 0, wins: 0, kills: 0, deaths: 0 };
  }
}

export class ClanStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS clans (
        id      INTEGER PRIMARY KEY,
        tag     TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name    TEXT NOT NULL,
        owner   INTEGER NOT NULL,
        code    TEXT NOT NULL UNIQUE,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS clan_members (
        account INTEGER PRIMARY KEY,
        clan    INTEGER NOT NULL,
        joined  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS clan_members_by_clan ON clan_members (clan);
      CREATE TABLE IF NOT EXISTS clan_wars (
        id     INTEGER PRIMARY KEY,
        a      INTEGER NOT NULL,
        b      INTEGER NOT NULL,
        winner INTEGER NOT NULL,
        sa     INTEGER NOT NULL,
        sb     INTEGER NOT NULL,
        at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS clan_wars_a ON clan_wars (a);
      CREATE INDEX IF NOT EXISTS clan_wars_b ON clan_wars (b);
    `);
  }

  tagOf(account: number): string {
    const row = this.db.prepare(`
      SELECT c.tag FROM clan_members m JOIN clans c ON c.id = m.clan
      WHERE m.account = ?
    `).get(account) as { tag: string } | undefined;
    return row?.tag ?? "";
  }

  view(account: number): ClanView | null {
    const clan = this.clanOf(account);
    return clan ? this.describe(clan) : null;
  }

  create(account: number, rawTag: unknown, rawName: unknown): ClanView {
    const tag = String(rawTag ?? "").trim().toUpperCase();
    const name = String(rawName ?? "").trim().replace(/\s+/g, " ");
    if (!TAG_RE.test(tag)) throw new AccountError(400, "Tags are 2-4 letters or numbers");
    if (!NAME_RE.test(name)) throw new AccountError(400, "Clan names are 3-24 characters");
    return this.tx(() => {
      if (this.clanOf(account)) throw new AccountError(409, "Leave your clan first");
      const now = Date.now();
      try {
        this.db.prepare(`
          INSERT INTO clans (tag, name, owner, code, created) VALUES (?, ?, ?, ?, ?)
        `).run(tag, name, account, newCode(), now);
      } catch (e) {
        if (String((e as Error).message).includes("UNIQUE")) {
          throw new AccountError(409, "That tag is taken");
        }
        throw e;
      }
      const clan = this.byTag(tag);
      if (!clan) throw new AccountError(500, "Could not create the clan");
      this.db.prepare("INSERT INTO clan_members (account, clan, joined) VALUES (?, ?, ?)")
        .run(account, clan.id, now);
      return this.describe(clan);
    });
  }

  join(account: number, rawCode: unknown): ClanView {
    const code = String(rawCode ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return this.tx(() => {
      if (this.clanOf(account)) throw new AccountError(409, "Leave your clan first");
      const clan = code.length === 8
        ? this.db.prepare("SELECT * FROM clans WHERE code = ?").get(code) as ClanRowDb | undefined
        : undefined;
      if (!clan) throw new AccountError(404, "No clan has that invite code");
      if (this.count(clan.id) >= CLAN_MAX_MEMBERS) {
        throw new AccountError(409, `That clan is full (${CLAN_MAX_MEMBERS})`);
      }
      this.db.prepare("INSERT INTO clan_members (account, clan, joined) VALUES (?, ?, ?)")
        .run(account, clan.id, Date.now());
      return this.describe(clan);
    });
  }

  leave(account: number): void {
    this.tx(() => {
      const clan = this.clanOf(account);
      if (!clan) throw new AccountError(409, "You are not in a clan");
      this.db.prepare("DELETE FROM clan_members WHERE account = ?").run(account);
      this.afterRemoval(clan, account);
    });
  }

  kick(account: number, rawName: unknown): ClanView {
    const name = String(rawName ?? "").trim();
    return this.tx(() => {
      const clan = this.ownedBy(account);
      const target = this.db.prepare(`
        SELECT m.account FROM clan_members m JOIN accounts a ON a.id = m.account
        WHERE m.clan = ? AND a.name = ? COLLATE NOCASE
      `).get(clan.id, name) as { account: number } | undefined;
      if (!target) throw new AccountError(404, "They are not in your clan");
      if (target.account === account) throw new AccountError(400, "Use Leave instead");
      this.db.prepare("DELETE FROM clan_members WHERE account = ?").run(target.account);
      return this.describe(clan);
    });
  }

  newCode(account: number): ClanView {
    return this.tx(() => {
      const clan = this.ownedBy(account);
      clan.code = newCode();
      this.db.prepare("UPDATE clans SET code = ? WHERE id = ?").run(clan.code, clan.id);
      return this.describe(clan);
    });
  }

  recordWar(tagA: string, tagB: string, winner: string, sa: number, sb: number): void {
    const a = this.byTag(tagA);
    const b = this.byTag(tagB);
    if (!a || !b || a.id === b.id) return;
    const w = winner === a.tag ? a.id : winner === b.tag ? b.id : 0;
    this.db.prepare("INSERT INTO clan_wars (a, b, winner, sa, sb, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(a.id, b.id, w, Math.round(sa), Math.round(sb), Date.now());
  }

  private warsOf(id: number): { warWins: number; warLosses: number; warDraws: number } {
    const r = this.db.prepare(`
      SELECT
        SUM(CASE WHEN winner = ? THEN 1 ELSE 0 END) AS w,
        SUM(CASE WHEN winner = 0 THEN 1 ELSE 0 END) AS d,
        COUNT(*) AS n
      FROM clan_wars WHERE a = ? OR b = ?
    `).get(id, id, id) as { w: number | null; d: number | null; n: number };
    const w = Number(r.w) || 0;
    const d = Number(r.d) || 0;
    return { warWins: w, warDraws: d, warLosses: Math.max(0, Number(r.n) - w - d) };
  }

  top(limit = 25): ClanRow[] {
    const clans = this.db.prepare("SELECT * FROM clans").all() as unknown as ClanRowDb[];
    const rows: ClanRow[] = clans.map((c) => {
      const members = this.members(c.id);
      const t = sum(members.map((m) => statsOf(m.profile)));
      return { tag: c.tag, name: c.name, members: members.length, ...t, ...this.warsOf(c.id) };
    });
    rows.sort((a, b) => b.warWins - a.warWins || b.wins - a.wins || b.kills - a.kills
      || a.tag.localeCompare(b.tag));
    return rows.slice(0, Math.max(1, Math.min(100, limit)));
  }

  private afterRemoval(clan: ClanRowDb, gone: number): void {
    const left = this.members(clan.id);
    if (!left.length) {
      this.db.prepare("DELETE FROM clans WHERE id = ?").run(clan.id);
      return;
    }
    if (clan.owner === gone) {
      this.db.prepare("UPDATE clans SET owner = ? WHERE id = ?").run(left[0].account, clan.id);
    }
  }

  private describe(clan: ClanRowDb): ClanView {
    const rows = this.members(clan.id);
    const members: ClanMember[] = rows.map((m) => ({
      name: m.name, owner: m.account === clan.owner, ...statsOf(m.profile),
    }));
    return {
      tag: clan.tag,
      name: clan.name,
      owner: members.find((m) => m.owner)?.name ?? "",
      code: clan.code,
      created: clan.created,
      members,
      totals: sum(members),
      ...this.warsOf(clan.id),
    };
  }

  private members(clan: number): MemberRowDb[] {
    return this.db.prepare(`
      SELECT m.account, a.name, m.joined, a.profile
      FROM clan_members m JOIN accounts a ON a.id = m.account
      WHERE m.clan = ? ORDER BY m.joined, m.account
    `).all(clan) as unknown as MemberRowDb[];
  }

  private count(clan: number): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM clan_members WHERE clan = ?")
      .get(clan) as { n: number };
    return Number(r.n);
  }

  private clanOf(account: number): ClanRowDb | undefined {
    return this.db.prepare(`
      SELECT c.* FROM clan_members m JOIN clans c ON c.id = m.clan WHERE m.account = ?
    `).get(account) as ClanRowDb | undefined;
  }

  private byTag(tag: string): ClanRowDb | undefined {
    return this.db.prepare("SELECT * FROM clans WHERE tag = ?").get(tag) as ClanRowDb | undefined;
  }

  private ownedBy(account: number): ClanRowDb {
    const clan = this.clanOf(account);
    if (!clan) throw new AccountError(409, "You are not in a clan");
    if (clan.owner !== account) throw new AccountError(403, "Only the clan owner can do that");
    return clan;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

function sum(list: readonly AccountStats[]): AccountStats {
  const t: AccountStats = { rounds: 0, wins: 0, kills: 0, deaths: 0 };
  for (const s of list) {
    t.rounds += s.rounds; t.wins += s.wins; t.kills += s.kills; t.deaths += s.deaths;
  }
  return t;
}
