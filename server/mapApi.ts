import type { IncomingMessage, ServerResponse } from "node:http";
import { Limiter, type Account, type AccountStore } from "./accounts";
import { clientIp } from "./accountApi";
import { MapStore, MAX_PAGE, MAX_PER_ACCOUNT, type MapSort } from "./mapStore";
import { MAX_RLE, sanitiseMap } from "../src/editor/format";

export const MAX_MAP_BODY = MAX_RLE + 16 * 1024;

const ID_RE = /^[A-Za-z0-9_-]{6,16}$/;

const PLAY_DEDUPE_MS = 30 * 60_000;
const SORTS: readonly MapSort[] = ["new", "top", "week"];
const MAX_QUERY = 40;

export interface MapRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | undefined;
  ip: string;
  body: unknown;
}

export interface MapResponse {
  status: number;
  body: unknown;
}

class MapError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class MapApi {
  private readonly upAcct = new Limiter(20, 60 * 60_000);
  private readonly upIp = new Limiter(40, 60 * 60_000);
  private readonly readIp = new Limiter(600, 15 * 60_000);
  private readonly playIp = new Limiter(120, 60 * 60_000);
  private readonly playOnce = new Limiter(1, PLAY_DEDUPE_MS);
  private readonly voteAcct = new Limiter(120, 60 * 60_000);
  private readonly voteIp = new Limiter(240, 60 * 60_000);

  constructor(private readonly store: MapStore, private readonly accounts: AccountStore) {}

  close(): void {
    this.store.close();
  }

  async handle(req: MapRequest): Promise<MapResponse> {
    try {
      return this.route(req);
    } catch (e) {
      if (e instanceof MapError) return { status: e.status, body: { ok: false, error: e.message } };
      console.error("[sfh3] map api:", e instanceof Error ? e.message : e);
      return { status: 500, body: { ok: false, error: "Something went wrong" } };
    }
  }

  private route(req: MapRequest): MapResponse {
    const parts = req.path.split("/").filter(Boolean);
    if (parts[0] !== "maps") throw new MapError(404, "Not found");

    if (req.method === "POST" && parts.length === 1) return this.upload(req);

    if (req.method === "GET" && parts.length === 1) {
      if (req.query.get("mine") !== "1") return this.browse(req);
      const acct = this.who(req);
      return { status: 200, body: { ok: true, maps: this.store.listFor(acct.id) } };
    }

    const id = parts[1] ?? "";
    if (!ID_RE.test(id)) throw new MapError(404, "No such map");

    if (req.method === "GET" && parts.length === 2) {
      if (!this.readIp.hit(req.ip)) throw new MapError(429, "Too many requests, try again later");
      const m = this.store.get(id);
      if (!m) throw new MapError(404, "No such map");
      const stats = this.store.stats(m.id, this.maybeWho(req)?.id ?? null);
      return { status: 200, body: { ok: true, id: m.id, author: m.author, map: m.map, ...stats } };
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "play") return this.play(req, id);
    if (req.method === "POST" && parts.length === 3 && parts[2] === "rate") return this.rate(req, id);

    if (req.method === "POST" && parts.length === 3 && parts[2] === "delete") {
      const acct = this.who(req);
      if (!this.store.remove(acct.id, id)) throw new MapError(404, "No such map of yours");
      return { status: 200, body: { ok: true } };
    }

    throw new MapError(404, "Not found");
  }

  private upload(req: MapRequest): MapResponse {
    const acct = this.who(req);
    if (!this.upIp.hit(req.ip) || !this.upAcct.hit(String(acct.id))) {
      throw new MapError(429, "Too many uploads, try again in an hour");
    }
    const raw = (req.body as { map?: unknown } | null)?.map;
    const map = sanitiseMap(raw);
    if (!map) throw new MapError(400, "That map is malformed or too big");
    if (!map.spawns.length) throw new MapError(400, "A map needs at least one spawn");
    if (this.store.countFor(acct.id) >= MAX_PER_ACCOUNT) {
      throw new MapError(409, `You already share ${MAX_PER_ACCOUNT} maps: delete one first`);
    }
    const id = this.store.add(acct.id, acct.name, map);
    return { status: 200, body: { ok: true, id } };
  }

  private browse(req: MapRequest): MapResponse {
    if (!this.readIp.hit(req.ip)) throw new MapError(429, "Too many requests, try again later");
    const want = req.query.get("sort") ?? "new";
    const sort = (SORTS as readonly string[]).includes(want) ? want as MapSort : "new";
    const q = (req.query.get("q") ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_QUERY);
    const page = Math.max(0, Math.min(10_000, Math.trunc(Number(req.query.get("page"))) || 0));
    const per = Math.max(1, Math.min(MAX_PAGE, Math.trunc(Number(req.query.get("n"))) || 10));
    const account = this.maybeWho(req)?.id ?? null;
    const { rows, more } = this.store.list({ sort, q, page, per, account });
    return { status: 200, body: { ok: true, maps: rows, page, more } };
  }

  private play(req: MapRequest, id: string): MapResponse {
    if (!this.playIp.hit(req.ip)) throw new MapError(429, "Too many requests, try again later");
    const owner = this.store.ownerOf(id);
    if (owner === null) throw new MapError(404, "No such map");
    const me = this.maybeWho(req);
    const counted = me?.id !== owner && this.playOnce.hit(`${req.ip}|${id}`)
      && this.store.played(id);
    return { status: 200, body: { ok: true, counted } };
  }

  private rate(req: MapRequest, id: string): MapResponse {
    const acct = this.who(req);
    if (!this.voteIp.hit(req.ip) || !this.voteAcct.hit(String(acct.id))) {
      throw new MapError(429, "Too many votes, try again later");
    }
    const vote = Number((req.body as { vote?: unknown } | null)?.vote);
    if (vote !== 1 && vote !== -1 && vote !== 0) throw new MapError(400, "Vote 1, -1 or 0");
    const owner = this.store.ownerOf(id);
    if (owner === null) throw new MapError(404, "No such map");
    if (owner === acct.id) throw new MapError(403, "You cannot rate your own map");
    this.store.vote(id, acct.id, vote);
    return { status: 200, body: { ok: true, ...this.store.stats(id, acct.id) } };
  }

  private maybeWho(req: MapRequest): Account | null {
    const m = /^Bearer\s+(\S+)$/.exec(req.auth ?? "");
    return m ? this.accounts.verify(m[1]) : null;
  }

  private who(req: MapRequest): Account {
    const m = /^Bearer\s+(\S+)$/.exec(req.auth ?? "");
    const acct = m ? this.accounts.verify(m[1]) : null;
    if (!acct) throw new MapError(401, "Please sign in again");
    return acct;
  }

  serve(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, body: unknown): void => {
      if (res.headersSent) return;
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_MAP_BODY) {
        send(413, { ok: false, error: "That map is too big to share" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_MAP_BODY) return;
      let body: unknown = {};
      if (size) {
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { send(400, { ok: false, error: "Bad JSON" }); return; }
      }
      void this.handle({
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        auth: req.headers.authorization,
        ip: clientIp(req.headers["x-forwarded-for"], req.socket.remoteAddress),
        body,
      }).then((r) => send(r.status, r.body));
    });
  }
}
