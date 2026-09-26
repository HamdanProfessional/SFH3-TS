import { AccountError, Limiter, type Account, type AccountStore } from "./accounts";
import { ClanStore } from "./clans";
import { FriendStore } from "./friends";
import { RatingStore } from "./ranked";
import { CoopProgress } from "./progress";
import { HistoryStore } from "./history";
import { seasonOf } from "../src/net/ranks";
import type {
  AccountReply, ClanReply, ClanTopReply, ClanView, ProfileReply, RankedTopReply,
} from "../src/net/protocol";

export interface ApiRequest {
  method: string;
  path: string;
  auth: string | undefined;
  ip: string;
  body: unknown;
  query?: URLSearchParams;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export const MAX_BODY = 256 * 1024;

export class AccountApi {
  private readonly failIp = new Limiter(20, 15 * 60_000);
  private readonly failName = new Limiter(10, 15 * 60_000);
  private readonly regIp = new Limiter(5, 60 * 60_000);

  private readonly clanIp = new Limiter(5, 60 * 60_000);
  readonly clans: ClanStore;
  private readonly friendIp = new Limiter(40, 60 * 60_000);
  readonly friends: FriendStore;
  readonly ratings: RatingStore;
  readonly progress: CoopProgress;
  readonly history: HistoryStore;
  private readonly profileIp = new Limiter(240, 60 * 60_000);

  constructor(private readonly store: AccountStore) {
    this.clans = new ClanStore(store.database);
    this.friends = new FriendStore(store.database);
    this.ratings = new RatingStore(store.database);
    this.progress = new CoopProgress(store.database);
    this.history = new HistoryStore(store.database);
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      return await this.route(req);
    } catch (e) {
      if (e instanceof AccountError) return { status: e.status, body: { ok: false, error: e.message } };
      console.error("[sfh3] account api:", e instanceof Error ? e.message : e);
      return { status: 500, body: { ok: false, error: "Something went wrong" } };
    }
  }

  private async route(req: ApiRequest): Promise<ApiResponse> {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as
      Record<string, unknown>;
    const at = `${req.method} ${req.path.replace(/\/+$/, "")}`;
    switch (at) {
      case "POST /account/register": {
        if (!this.regIp.hit(req.ip)) {
          throw new AccountError(429, "Too many new accounts from here; try later");
        }
        const acct = await this.store.register(body.name, body.password);
        return this.reply(acct, true);
      }
      case "POST /account/login": {
        const key = String(body.name ?? "").toLowerCase().slice(0, 32);
        const okIp = this.failIp.hit(req.ip);
        const okName = this.failName.hit(key);
        if (!okIp || !okName) {
          throw new AccountError(429, "Too many tries; wait a few minutes");
        }
        const acct = await this.store.login(body.name, body.password);
        this.failName.clear(key);
        return this.reply(acct, true);
      }
      case "GET /account":
        return this.reply(this.who(req), false);
      case "POST /account/seed": {
        const me = this.who(req);
        return this.reply(this.store.seed(me.id, body.heroes, body.squad), false);
      }
      case "POST /account/squad": {
        const me = this.who(req);
        return this.reply(this.store.setSquad(me.id, body.squad), false);
      }
      case "POST /account/logout-all": {
        const me = this.who(req);
        this.store.signOutEverywhere(me.id);
        return { status: 200, body: { ok: true } };
      }
      case "GET /account/clan":
        return this.clan(this.clans.view(this.who(req).id));
      case "POST /account/clan/create": {
        const me = this.who(req);
        if (!this.clanIp.hit(req.ip)) throw new AccountError(429, "Too many new clans; try later");
        return this.clan(this.clans.create(me.id, body.tag, body.name));
      }
      case "POST /account/clan/join":
        return this.clan(this.clans.join(this.who(req).id, body.code));
      case "POST /account/clan/leave":
        this.clans.leave(this.who(req).id);
        return this.clan(null);
      case "POST /account/clan/kick":
        return this.clan(this.clans.kick(this.who(req).id, body.name));
      case "POST /account/clan/code":
        return this.clan(this.clans.newCode(this.who(req).id));
      case "GET /account/clans/top": {
        const out: ClanTopReply = { ok: true, clans: this.clans.top() };
        return { status: 200, body: out };
      }
      case "GET /account/ranked":
        return { status: 200, body: this.ratings.me(this.who(req).id) };
      case "GET /account/ranked/top": {
        const want = req.query?.get("season") ?? "";
        const season = /^\d{4}-Q[1-4]$/.test(want) ? want : seasonOf();
        const out: RankedTopReply = { ok: true, season, rows: this.ratings.top(season) };
        return { status: 200, body: out };
      }
      case "GET /account/friends":
        return { status: 200, body: this.friends.list(this.who(req).id) };
      case "POST /account/friends/add": {
        const me = this.who(req);
        if (!this.friendIp.hit(req.ip)) throw new AccountError(429, "Too many requests; try later");
        return { status: 200, body: this.friends.add(me.id, body.name) };
      }
      case "POST /account/friends/accept":
        return { status: 200, body: this.friends.accept(this.who(req).id, body.name) };
      case "POST /account/friends/decline":
        return { status: 200, body: this.friends.decline(this.who(req).id, body.name) };
      case "POST /account/friends/remove":
        return { status: 200, body: this.friends.remove(this.who(req).id, body.name) };
      case "GET /account/profile": {
        if (!this.profileIp.hit(req.ip)) throw new AccountError(429, "Too many look-ups; try later");
        return { status: 200, body: this.profile(req.query?.get("name")) };
      }
      default:
        return { status: 404, body: { ok: false, error: "No such thing" } };
    }
  }

  private profile(rawName: unknown): ProfileReply {
    const who = this.history.lookup(rawName);
    const acct = this.store.get(who.id);
    const prof = acct?.profile;
    const heroes = (prof?.squad ?? []).map((i) => prof?.heroes[i]).filter(Boolean).map((h) => ({
      name: String(h?.name ?? "?"), cls: String(h?.cls ?? ""), level: Math.trunc(Number(h?.level) || 1),
    }));
    const r = this.ratings.me(who.id);
    let clan = "";
    try {
      clan = this.clans.tagOf(who.id) ?? "";
    } catch {
      clan = "";
    }
    return {
      ok: true,
      name: who.name,
      since: who.since,
      clan,
      stats: prof?.stats ?? { rounds: 0, wins: 0, kills: 0, deaths: 0 },
      ranked: r.games > 0
        ? { season: r.season, rating: r.rating, games: r.games, wins: r.wins, peak: r.peak,
          rank: r.rank, tier: r.tier }
        : null,
      weapons: this.history.weapons(who.id),
      heroes,
      history: this.history.recent(who.id),
    };
  }

  private who(req: ApiRequest): Account {
    const m = /^Bearer\s+(\S+)$/.exec(req.auth ?? "");
    const acct = m ? this.store.verify(m[1]) : null;
    if (!acct) throw new AccountError(401, "Please sign in again");
    return acct;
  }

  private clan(clan: ClanView | null): ApiResponse {
    const body: ClanReply = { ok: true, clan };
    return { status: 200, body };
  }

  private reply(acct: Account, withToken: boolean): ApiResponse {
    const body: AccountReply = { ok: true, name: acct.name, profile: acct.profile };
    if (withToken) body.token = this.store.issueToken(acct.id);
    return { status: 200, body };
  }
}

export function clientIp(xff: string | string[] | undefined, peer: string | undefined): string {
  const raw = Array.isArray(xff) ? xff.join(",") : xff ?? "";
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? peer ?? "?";
}
