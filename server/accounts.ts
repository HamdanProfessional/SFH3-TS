import { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { sanitiseHero } from "../src/net/hero";
import { commitExp } from "../src/game/progression";
import {
  MAX_SQUAD, ONLINE_MAX_HEROES,
  type AccountProfile, type AccountStats, type EarnedRow,
} from "../src/net/protocol";

export const TOKEN_DAYS = 30;

const SCRYPT = { N: 1 << 14, r: 8, p: 1, keylen: 32 } as const;

const NAME_RE = /^[A-Za-z0-9_-]{3,16}$/;

const RESERVED = new Set(["server", "admin", "guest", "system", "moderator"]);

export class AccountError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Row {
  id: number;
  name: string;
  salt: Uint8Array;
  hash: Uint8Array;
  token_ver: number;
  profile: string;
}

export interface Account {
  id: number;
  name: string;
  profile: AccountProfile;
}

function emptyStats(): AccountStats {
  return { rounds: 0, wins: 0, kills: 0, deaths: 0 };
}

function emptyProfile(): AccountProfile {
  return { heroes: [], squad: [], seeded: false, stats: emptyStats() };
}

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function checkName(name: unknown): string {
  const n = String(name ?? "").trim();
  if (!NAME_RE.test(n)) {
    throw new AccountError(400,
      "Names are 3-16 letters, numbers, _ or -");
  }
  if (RESERVED.has(n.toLowerCase())) throw new AccountError(400, "That name is reserved");
  return n;
}

export function checkPassword(password: unknown, name: string): string {
  const p = String(password ?? "");
  if (p.length < 8) throw new AccountError(400, "Passwords need at least 8 characters");
  if (p.length > 128) throw new AccountError(400, "That password is too long");
  if (p.toLowerCase() === name.toLowerCase()) {
    throw new AccountError(400, "Your password can't be your name");
  }
  return p;
}

export function cleanSquad(raw: unknown, count: number): number[] {
  const out: number[] = [];
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    if (typeof v !== "number" && !(typeof v === "string" && /^\d+$/.test(v))) continue;
    const i = Number(v);
    if (!Number.isInteger(i) || i < 0 || i >= count || out.includes(i)) continue;
    out.push(i);
    if (out.length >= MAX_SQUAD) break;
  }
  return out;
}

export class AccountStore {
  private readonly db: DatabaseSync;
  private readonly secret: Buffer;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id        INTEGER PRIMARY KEY,
        name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        salt      BLOB NOT NULL,
        hash      BLOB NOT NULL,
        token_ver INTEGER NOT NULL DEFAULT 1,
        created   INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        profile   TEXT NOT NULL
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('secret', ?)")
      .run(randomBytes(32).toString("hex"));
    const row = this.db.prepare("SELECT v FROM meta WHERE k = 'secret'").get() as
      { v: string } | undefined;
    this.secret = Buffer.from(row?.v ?? "", "hex");
    if (this.secret.length !== 32) throw new Error("accounts: bad signing secret");
  }

  close(): void {
    this.db.close();
  }

  get database(): DatabaseSync {
    return this.db;
  }

  async register(rawName: unknown, rawPassword: unknown): Promise<Account> {
    const name = checkName(rawName);
    const password = checkPassword(rawPassword, name);
    if (this.byName(name)) throw new AccountError(409, "That name is taken");
    const salt = randomBytes(16);
    const hash = await hashPassword(password, salt);
    const now = Date.now();
    try {
      this.db.prepare(`
        INSERT INTO accounts (name, salt, hash, created, last_seen, profile)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, salt, hash, now, now, JSON.stringify(emptyProfile()));
    } catch (e) {
      if (String((e as Error).message).includes("UNIQUE")) {
        throw new AccountError(409, "That name is taken");
      }
      throw e;
    }
    const row = this.byName(name);
    if (!row) throw new AccountError(500, "Could not create the account");
    return this.toAccount(row);
  }

  async login(rawName: unknown, rawPassword: unknown): Promise<Account> {
    const name = String(rawName ?? "").trim();
    const password = String(rawPassword ?? "");
    const row = NAME_RE.test(name) ? this.byName(name) : undefined;
    const salt = row ? Buffer.from(row.salt) : randomBytes(16);
    const got = await hashPassword(password.slice(0, 128), salt);
    const want = row ? Buffer.from(row.hash) : randomBytes(SCRYPT.keylen);
    if (!row || !timingSafeEqual(got, want)) {
      throw new AccountError(401, "Wrong name or password");
    }
    this.db.prepare("UPDATE accounts SET last_seen = ? WHERE id = ?").run(Date.now(), row.id);
    return this.toAccount(row);
  }

  signOutEverywhere(id: number): void {
    this.db.prepare("UPDATE accounts SET token_ver = token_ver + 1 WHERE id = ?").run(id);
  }

  issueToken(id: number, now = Date.now()): string {
    const row = this.byId(id);
    if (!row) throw new AccountError(404, "No such account");
    const body = b64url(JSON.stringify({
      i: id, v: row.token_ver, e: Math.floor(now / 1000) + TOKEN_DAYS * 86400,
    }));
    return `v1.${body}.${this.sign(body)}`;
  }

  verify(token: unknown, now = Date.now()): Account | null {
    if (typeof token !== "string" || token.length > 512) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const [, body, sig] = parts;
    const want = Buffer.from(this.sign(body));
    const got = Buffer.from(sig);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    let claims: { i?: unknown; v?: unknown; e?: unknown };
    try {
      claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof claims.e !== "number" || claims.e * 1000 <= now) return null;
    const row = typeof claims.i === "number" ? this.byId(claims.i) : undefined;
    if (!row || row.token_ver !== claims.v) return null;
    return this.toAccount(row);
  }

  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(`v1.${body}`).digest("base64url");
  }

  get(id: number): Account | null {
    const row = this.byId(id);
    return row ? this.toAccount(row) : null;
  }

  nameTaken(name: string): boolean {
    return NAME_RE.test(name) && !!this.byName(name);
  }

  seed(id: number, rawHeroes: unknown, rawSquad: unknown): Account {
    return this.update(id, (p) => {
      if (p.seeded) throw new AccountError(409, "Your heroes are already online");
      if (!Array.isArray(rawHeroes) || !rawHeroes.length) {
        throw new AccountError(400, "There were no heroes to bring online");
      }
      p.heroes = rawHeroes.slice(0, ONLINE_MAX_HEROES).map((h) => sanitiseHero(h));
      const squad = cleanSquad(rawSquad, p.heroes.length);
      p.squad = squad.length
        ? squad
        : p.heroes.slice(0, MAX_SQUAD).map((_, i) => i);
      p.seeded = true;
    });
  }

  setSquad(id: number, rawSquad: unknown): Account {
    return this.update(id, (p) => {
      const squad = cleanSquad(rawSquad, p.heroes.length);
      if (!squad.length) throw new AccountError(400, "A squad needs at least one hero");
      p.squad = squad;
    });
  }

  credit(
    id: number,
    earned: readonly { hero: number; exp: number }[],
    delta: AccountStats,
  ): { account: Account; rows: EarnedRow[] } {
    const rows: EarnedRow[] = [];
    const account = this.update(id, (p) => {
      for (const { hero, exp } of earned) {
        const h = p.heroes[hero];
        if (!h) continue;
        const u = {
          name: String(h.name ?? ""),
          level: Number(h.level) || 1,
          exp: Number(h.exp) || 0,
          earnedExp: exp > 0 ? exp : 0,
        };
        const from = u.level;
        commitExp(u);
        h.level = u.level;
        h.exp = Math.round(u.exp);
        rows.push({ name: u.name, exp: Math.round(u.earnedExp), from, to: u.level });
      }
      p.stats.rounds += delta.rounds;
      p.stats.wins += delta.wins;
      p.stats.kills += delta.kills;
      p.stats.deaths += delta.deaths;
    });
    return { account, rows };
  }

  private update(id: number, fn: (p: AccountProfile) => void): Account {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.byId(id);
      if (!row) throw new AccountError(404, "No such account");
      const p = parseProfile(row.profile);
      fn(p);
      this.db.prepare("UPDATE accounts SET profile = ? WHERE id = ?")
        .run(JSON.stringify(p), id);
      this.db.exec("COMMIT");
      return { id, name: row.name, profile: p };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private byName(name: string): Row | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE name = ?").get(name) as
      Row | undefined;
  }

  private byId(id: number): Row | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
      Row | undefined;
  }

  private toAccount(row: Row): Account {
    return { id: row.id, name: row.name, profile: parseProfile(row.profile) };
  }
}

function parseProfile(json: string): AccountProfile {
  let raw: Partial<AccountProfile> = {};
  try { raw = JSON.parse(json) as Partial<AccountProfile>; } catch {}
  const heroes = Array.isArray(raw.heroes) ? raw.heroes : [];
  return {
    heroes,
    squad: cleanSquad(raw.squad, heroes.length),
    seeded: !!raw.seeded,
    stats: { ...emptyStats(), ...(raw.stats ?? {}) },
  };
}

export class Limiter {
  private readonly hits = new Map<string, { n: number; until: number }>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  hit(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10000) this.prune(now);
    const h = this.hits.get(key);
    if (!h || h.until <= now) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const [k, h] of this.hits) if (h.until <= now) this.hits.delete(k);
  }
}
