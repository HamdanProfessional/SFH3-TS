import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import {
  MATERIALS, decodeCells, toWire, type CustomMap, type MapWire,
} from "../src/editor/format";

export const MAX_PER_ACCOUNT = 50;

export const MAX_PAGE = 24;

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const WEEK_VOTE_WEIGHT = 5;

export type MapSort = "new" | "top" | "week";

export interface MapStats {
  plays: number;
  up: number;
  down: number;
}

export interface MapThumb {
  w: number;
  h: number;
  cells: string;
}

export interface MapRow extends MapStats {
  id: string;
  name: string;
  author: string;
  created: number;
  w: number;
  h: number;
  mine: number;
  thumb: MapThumb;
}

const THUMB_W = 60;
const THUMB_H = 34;

export interface StoredMap {
  id: string;
  author: string;
  name: string;
  created: number;
  map: MapWire;
}

export class MapStore {
  private readonly db: DatabaseSync;
  private readonly thumbs = new Map<string, { w: number; h: number; thumb: MapThumb }>();

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY,
        owner INTEGER NOT NULL,
        author TEXT NOT NULL,
        name TEXT NOT NULL,
        created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS maps_owner ON maps (owner, created);
      CREATE INDEX IF NOT EXISTS maps_created ON maps (created);
      CREATE TABLE IF NOT EXISTS map_plays (
        map TEXT NOT NULL,
        day INTEGER NOT NULL,
        n INTEGER NOT NULL,
        PRIMARY KEY (map, day)
      );
      CREATE INDEX IF NOT EXISTS map_plays_day ON map_plays (day);
      CREATE TABLE IF NOT EXISTS map_votes (
        map TEXT NOT NULL,
        account INTEGER NOT NULL,
        vote INTEGER NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (map, account)
      );
      CREATE INDEX IF NOT EXISTS map_votes_at ON map_votes (at);
    `);
  }

  close(): void {
    this.db.close();
  }

  countFor(owner: number): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM maps WHERE owner = ?").get(owner) as
      { n: number } | undefined;
    return Number(r?.n ?? 0);
  }

  add(owner: number, author: string, map: CustomMap): string {
    const data = JSON.stringify(toWire(map));
    for (let tries = 0; tries < 5; tries++) {
      const id = randomBytes(9).toString("base64url");
      try {
        this.db.prepare(
          "INSERT INTO maps (id, owner, author, name, created, data) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, owner, author, map.name, Date.now(), data);
        return id;
      } catch (e) {
        if (!String(e).includes("UNIQUE")) throw e;
      }
    }
    throw new Error("could not allocate a map id");
  }

  get(id: string): StoredMap | null {
    const r = this.db.prepare(
      "SELECT id, author, name, created, data FROM maps WHERE id = ?",
    ).get(id) as { id: string; author: string; name: string; created: number; data: string } |
      undefined;
    if (!r) return null;
    try {
      return { id: r.id, author: r.author, name: r.name, created: r.created, map: JSON.parse(r.data) };
    } catch {
      return null;
    }
  }

  ownerOf(id: string): number | null {
    const r = this.db.prepare("SELECT owner FROM maps WHERE id = ?").get(id) as
      { owner: number } | undefined;
    return r ? Number(r.owner) : null;
  }

  played(id: string, now = Date.now()): boolean {
    if (this.ownerOf(id) === null) return false;
    this.db.prepare(
      "INSERT INTO map_plays (map, day, n) VALUES (?, ?, 1) "
      + "ON CONFLICT (map, day) DO UPDATE SET n = n + 1",
    ).run(id, Math.floor(now / DAY_MS));
    return true;
  }

  vote(id: string, account: number, vote: number, now = Date.now()): void {
    if (vote === 0) {
      this.db.prepare("DELETE FROM map_votes WHERE map = ? AND account = ?").run(id, account);
      return;
    }
    this.db.prepare(
      "INSERT INTO map_votes (map, account, vote, at) VALUES (?, ?, ?, ?) "
      + "ON CONFLICT (map, account) DO UPDATE SET vote = excluded.vote, at = excluded.at",
    ).run(id, account, vote > 0 ? 1 : -1, now);
  }

  stats(id: string, account: number | null): MapStats & { mine: number } {
    const p = this.db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM map_plays WHERE map = ?")
      .get(id) as { n: number } | undefined;
    const v = this.db.prepare(
      "SELECT COALESCE(SUM(vote > 0), 0) AS up, COALESCE(SUM(vote < 0), 0) AS down "
      + "FROM map_votes WHERE map = ?",
    ).get(id) as { up: number; down: number } | undefined;
    const mine = account === null ? undefined : this.db.prepare(
      "SELECT vote FROM map_votes WHERE map = ? AND account = ?",
    ).get(id, account) as { vote: number } | undefined;
    return {
      plays: Number(p?.n ?? 0), up: Number(v?.up ?? 0), down: Number(v?.down ?? 0),
      mine: Number(mine?.vote ?? 0),
    };
  }

  list(o: { sort: MapSort; q: string; page: number; per: number; account: number | null },
    now = Date.now()): { rows: MapRow[]; more: boolean } {
    const per = Math.max(1, Math.min(MAX_PAGE, Math.trunc(o.per) || MAX_PAGE));
    const page = Math.max(0, Math.trunc(o.page) || 0);
    const since = Math.floor(now / DAY_MS) - (WEEK_DAYS - 1);
    const args: (string | number)[] = [since * DAY_MS, since, o.account ?? -1];
    const where: string[] = [];
    if (o.q) {
      const like = `%${o.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push("(m.name LIKE ? ESCAPE '\\' OR m.author LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    if (o.sort === "week") where.push("(COALESCE(pw.n, 0) > 0 OR vw.map IS NOT NULL)");
    const net = (t: string): string => `(COALESCE(${t}.up, 0) - COALESCE(${t}.down, 0))`;
    const order = o.sort === "top"
      ? `${net("v")} DESC, COALESCE(p.n, 0) DESC, m.created DESC`
      : o.sort === "week"
        ? `(COALESCE(pw.n, 0) + ${WEEK_VOTE_WEIGHT} * ${net("vw")}) DESC, `
          + "COALESCE(pw.n, 0) DESC, m.created DESC"
        : "m.created DESC";
    args.push(per + 1, page * per);
    const raw = this.db.prepare(`
      SELECT m.id, m.name, m.author, m.created, m.data,
        COALESCE(p.n, 0) AS plays, COALESCE(v.up, 0) AS up, COALESCE(v.down, 0) AS down,
        COALESCE(me.vote, 0) AS mine
      FROM maps m
      LEFT JOIN (SELECT map, SUM(n) AS n FROM map_plays GROUP BY map) p ON p.map = m.id
      LEFT JOIN (SELECT map, SUM(vote > 0) AS up, SUM(vote < 0) AS down
                 FROM map_votes GROUP BY map) v ON v.map = m.id
      LEFT JOIN (SELECT map, SUM(vote > 0) AS up, SUM(vote < 0) AS down
                 FROM map_votes WHERE at >= ? GROUP BY map) vw ON vw.map = m.id
      LEFT JOIN (SELECT map, SUM(n) AS n FROM map_plays WHERE day >= ? GROUP BY map) pw
        ON pw.map = m.id
      LEFT JOIN map_votes me ON me.map = m.id AND me.account = ?
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`).all(...args) as {
      id: string; name: string; author: string; created: number; data: string;
      plays: number; up: number; down: number; mine: number;
    }[];
    const rows: MapRow[] = [];
    for (const r of raw.slice(0, per)) {
      const t = this.thumbOf(r.id, r.data);
      if (!t) continue;
      rows.push({
        id: r.id, name: r.name, author: r.author, created: Number(r.created),
        w: t.w, h: t.h, plays: Number(r.plays), up: Number(r.up), down: Number(r.down),
        mine: Number(r.mine), thumb: t.thumb,
      });
    }
    return { rows, more: raw.length > per };
  }

  private thumbOf(id: string, data: string): { w: number; h: number; thumb: MapThumb } | null {
    const hit = this.thumbs.get(id);
    if (hit) return hit;
    let wire: MapWire;
    try { wire = JSON.parse(data) as MapWire; } catch { return null; }
    const w = Math.trunc(Number(wire.w));
    const h = Math.trunc(Number(wire.h));
    const cells = w > 0 && h > 0 ? decodeCells(String(wire.rle ?? ""), w * h) : null;
    if (!cells) return null;
    const out = { w, h, thumb: shrink(cells, w, h) };
    if (this.thumbs.size >= 2000) this.thumbs.clear();
    this.thumbs.set(id, out);
    return out;
  }

  listFor(owner: number): { id: string; name: string; created: number }[] {
    return this.db.prepare(
      "SELECT id, name, created FROM maps WHERE owner = ? ORDER BY created DESC LIMIT 100",
    ).all(owner) as { id: string; name: string; created: number }[];
  }

  remove(owner: number, id: string): boolean {
    const r = this.db.prepare("DELETE FROM maps WHERE id = ? AND owner = ?").run(id, owner);
    if (!Number(r.changes)) return false;
    this.db.prepare("DELETE FROM map_plays WHERE map = ?").run(id);
    this.db.prepare("DELETE FROM map_votes WHERE map = ?").run(id);
    this.thumbs.delete(id);
    return true;
  }
}

function shrink(cells: Uint8Array, w: number, h: number): MapThumb {
  const f = Math.max(1, Math.ceil(w / THUMB_W), Math.ceil(h / THUMB_H));
  const tw = Math.ceil(w / f);
  const th = Math.ceil(h / f);
  const count = new Array<number>(MATERIALS.length).fill(0);
  const out: string[] = [];
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      count.fill(0);
      let n = 0;
      for (let y = ty * f; y < Math.min(h, ty * f + f); y++) {
        for (let x = tx * f; x < Math.min(w, tx * f + f); x++) {
          count[cells[y * w + x]]++;
          n++;
        }
      }
      let pick = 0;
      for (const solid of [true, false]) {
        let best = 0;
        let mat = 0;
        for (const m of MATERIALS) {
          if (m.id === 0 || m.solid !== solid || count[m.id] <= best) continue;
          best = count[m.id];
          mat = m.id;
        }
        if (best * 4 >= n && best > 0) { pick = mat; break; }
      }
      out.push(pick.toString(36));
    }
  }
  return { w: tw, h: th, cells: out.join("") };
}
