import { randomBytes } from "node:crypto";
import { ServerMatch, type RosterEntry } from "./ServerMatch";
import { buildRoster, type JoiningPlayer } from "./roster";
import { SERVER_MAP_IDS } from "./mapLoad";
import { getGameMode } from "../src/game/MatchSettings";
import { ALL_GAME_MODE_IDS } from "../src/data/StatsMisc";
import { cleanName, cleanText, heroToWire, sanitiseHero } from "../src/net/hero";
import { poolExp } from "../src/game/progression";
import type { UnitInfo } from "../src/game/UnitInfo";
import type { ArenaDef } from "../src/game/Arena";
import { getMap, type MapInfo } from "../src/data/StatsMaps";
import type { AccountStore } from "./accounts";
import type { ClanStore } from "./clans";
import type { FriendStore } from "./friends";
import type { RatingStore, RankedEntry } from "./ranked";
import type { MapStore } from "./mapStore";
import type { HistoryRow, HistoryStore } from "./history";
import { clearBonus, unlocked, type CoopProgress, type Cleared } from "./progress";
import { buildCoopRoster, coopConfig, coopMissions, describeMission, nextMission } from "./coop";
import { sanitiseMap, type CustomMap } from "../src/editor/format";
import { buildArena, checkMap } from "../src/editor/build";
import { CUSTOM_MODES, customMapInfo } from "../src/net/customMap";
import { rankLabel, seasonOf, tierOf } from "../src/net/ranks";
import {
  MAX_SQUAD, TICK_HZ, type AccountProfile, type CoopView, type CustomView, type MatchConfig,
  type PlayerView, type RoomKind, type RoomPhase, type RoomView, type ServerMsg, type Snapshot,
} from "../src/net/protocol";

const LOBBY_SECONDS = 8;
const OVER_SECONDS = 10;
const VOTE_OVER_SECONDS = 16;
const VOTE_OTHERS = 2;

const GRACE_MS = 60_000;
const PRESENCE_EVERY = 30 * TICK_HZ;
const RANKED_MIN = 2;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const SEND_EVERY = 2;

export interface RoomOptions {
  name: string;
  maxPlayers: number;
  cfg: MatchConfig;
  rotation?: string[];
  modes?: string[];
  assetDir: string;
  accounts?: AccountStore | null;
  clans?: ClanStore | null;
  kind?: RoomKind;
  maxSpectators?: number;
  progress?: CoopProgress | null;
  ratings?: RatingStore | null;
  friends?: FriendStore | null;
  maps?: MapStore | null;
  history?: HistoryStore | null;
}

export interface Conn {
  id: string;
  send(msg: ServerMsg): void;
  sendRaw(json: string): void;
  close(why: string): void;
}

export interface JoinRequest {
  name: string;
  token: unknown;
  squad: unknown;
  spectate?: boolean;
  resume?: unknown;
  code?: unknown;
}

export type JoinResult = { id: string } | { error: string };

interface Player {
  id: string;
  conn: Conn;
  name: string;
  account: number | null;
  squad: Record<string, unknown>[];
  heroIds: number[];
  active: number;
  next: number;
  roundSquad: UnitInfo[] | null;
  team: number;
  ready: boolean;
  slot: number;
  ping: number;
  kills: number;
  deaths: number;
  joinedRound: number;
  spectator: boolean;
  clan: string;
  away: number;
  resume: string;
  rating: number;
  games: number;
  cleared: Cleared | null;
  vote?: number;
}

export class Room {
  readonly name: string;
  readonly maxPlayers: number;
  readonly maxSpectators: number;
  readonly kind: RoomKind;
  cfg: MatchConfig;
  phase: RoomPhase = "lobby";

  private readonly players = new Map<string, Player>();
  private readonly rotation: string[];
  private rotIndex = 0;
  private readonly modes: string[];
  private modeIndex = 0;
  private match: ServerMatch | null = null;
  private round = 0;
  private timer = 0;
  private pending: Snapshot | null = null;
  private readonly coopList: number[] = [];
  private mission = 0;
  private diff = 1;
  private readonly baseCfg: MatchConfig;
  private custom: { id: string; name: string; author: string; map: CustomMap } | null = null;
  private code = "";
  private built: { key: string; def: ArenaDef; info: MapInfo } | null = null;
  private war: { a: string; b: string } | null = null;
  private quitters: RankedEntry[] = [];
  private presenceTick = 0;
  private secondTick = 0;
  private ballot: { map: string; mode: string }[] | null = null;

  constructor(private readonly opts: RoomOptions) {
    this.name = opts.name;
    this.maxPlayers = opts.maxPlayers;
    this.kind = opts.kind ?? "normal";
    this.cfg = opts.cfg;
    this.rotation = (opts.rotation?.length ? opts.rotation : [...SERVER_MAP_IDS])
      .filter((m) => SERVER_MAP_IDS.includes(m));
    if (!this.rotation.length) this.rotation.push(SERVER_MAP_IDS[0]);
    const at = this.rotation.indexOf(this.cfg.map);
    this.rotIndex = at >= 0 ? at : 0;
    this.cfg.map = this.rotation[this.rotIndex];
    this.baseCfg = { ...this.cfg };
    this.maxSpectators = Math.max(0, opts.maxSpectators ?? 8);
    if (this.kind === "coop") {
      this.coopList.push(...coopMissions(SERVER_MAP_IDS));
      this.mission = this.coopList[0] ?? 0;
      this.cfg = coopConfig(this.cfg, this.mission, 1);
    }
    if ((this.kind === "ranked" || this.kind === "clanwar") && !getGameMode(this.cfg.mode).teams) {
      this.cfg = { ...this.cfg, mode: "tdm", score: getGameMode("tdm").startscore };
      this.baseCfg.mode = this.cfg.mode;
      this.baseCfg.score = this.cfg.score;
    }
    const teamsOnly = this.kind === "ranked" || this.kind === "clanwar";
    const fixed = this.kind === "coop" || this.kind === "custom" || this.coop;
    this.modes = fixed ? [] : (opts.modes ?? []).filter((m) =>
      (ALL_GAME_MODE_IDS as readonly string[]).includes(m) && (!teamsOnly || getGameMode(m).teams));
    if (!this.modes.includes(this.cfg.mode)) this.modes.unshift(this.cfg.mode);
    this.modeIndex = this.modes.indexOf(this.cfg.mode);
    this.timer = LOBBY_SECONDS * TICK_HZ;
  }

  private withMode(cfg: MatchConfig, mode: string): MatchConfig {
    const score = mode === this.baseCfg.mode ? this.baseCfg.score : getGameMode(mode).startscore;
    return { ...cfg, mode, score };
  }

  get coop(): boolean {
    return this.coopList.length > 0;
  }

  get playerCount(): number {
    return [...this.players.values()].filter((p) => !p.spectator).length;
  }

  get spectatorCount(): number {
    return [...this.players.values()].filter((p) => p.spectator).length;
  }

  get isPrivate(): boolean {
    return !!this.code;
  }

  get averageRating(): number | undefined {
    if (this.kind !== "ranked") return undefined;
    const r = this.playing().filter((p) => p.account !== null);
    return r.length ? Math.round(r.reduce((s, p) => s + p.rating, 0) / r.length) : undefined;
  }

  get customName(): string | undefined {
    return this.custom?.name;
  }

  private playing(): Player[] {
    return [...this.players.values()].filter((p) => !p.spectator && !p.away);
  }

  join(conn: Conn, req: JoinRequest): JoinResult {
    const store = this.opts.accounts ?? null;
    const acct = store && req.token ? store.verify(req.token) : null;

    const key = typeof req.resume === "string" ? req.resume : "";
    const back = [...this.players.values()].find((q) =>
      (key && q.resume === key) || (acct && q.account === acct.id));
    if (back) {
      if (back.away || (key && back.resume === key)) {
        this.reattach(back, conn);
        return { id: back.id };
      }
      return { error: "you are already in this room" };
    }

    if (this.code && String(req.code ?? "").trim().toUpperCase() !== this.code) {
      return { error: "this room is private: ask for its code" };
    }

    const clanTag = acct ? this.clanTag(acct.id) : "";
    const barred = this.barredReason(acct !== null, clanTag);
    let spectate = !!req.spectate || !!barred;
    if (spectate) {
      if (this.spectatorCount >= this.maxSpectators) {
        return { error: barred ? `${barred}; no room to watch` : "no room to watch" };
      }
    } else if (this.playerCount >= this.maxPlayers) {
      if (this.spectatorCount >= this.maxSpectators) return { error: "server full" };
      spectate = true;
    }

    let display: string;
    let blobs: Record<string, unknown>[];
    let heroIds: number[] = [];
    if (acct) {
      display = acct.name;
      ({ blobs, heroIds } = squadOf(acct.profile));
    } else {
      display = cleanName(req.name, "Player");
      if (store?.nameTaken(display)) display = `${display.slice(0, 9)}(guest)`;
      blobs = Array.isArray(req.squad)
        ? req.squad.slice(0, MAX_SQUAD)
          .filter((h: unknown) => !!h && typeof h === "object")
          .map((h: unknown) => sanitiseHero(h))
        : [];
    }

    const rating = acct && this.kind === "ranked" ? this.opts.ratings?.get(acct.id) : undefined;
    const p: Player = {
      id: conn.id,
      conn,
      name: this.uniqueName(display),
      account: acct ? acct.id : null,
      squad: blobs,
      heroIds,
      active: 0,
      next: 0,
      roundSquad: null,
      team: 0,
      ready: false,
      slot: -1,
      ping: 0,
      kills: 0,
      deaths: 0,
      joinedRound: -1,
      spectator: spectate,
      clan: clanTag,
      away: 0,
      resume: randomBytes(12).toString("base64url"),
      rating: rating?.rating ?? 0,
      games: rating?.games ?? 0,
      cleared: acct && this.coop ? this.readCleared(acct.id) : null,
    };
    this.players.set(p.id, p);
    conn.send({ t: "welcome", you: p.id, room: this.view(), resume: p.resume });
    this.sendSquad(p);
    if (barred) this.tell(p, `${barred}. You are watching.`);
    if (this.coop) this.fixCoopPick();
    this.broadcastRoom();
    this.presence([p]);
    if (this.phase === "live" && this.match) {
      conn.send({
        t: "start", cfg: this.cfg, slots: this.match.slots(), you: -1,
      });
    }
    return { id: p.id };
  }

  private barredReason(signedIn: boolean, clan: string): string {
    if (this.kind === "ranked" && !signedIn) return "Ranked is for signed-in players";
    if (this.kind === "clanwar" && !clan) return "Clan war is for clan members";
    return "";
  }

  private reattach(p: Player, conn: Conn): void {
    const old = p.conn;
    p.conn = conn;
    p.away = 0;
    if (old !== conn) { try { old.close("reconnected elsewhere"); } catch {} }
    conn.send({ t: "welcome", you: p.id, room: this.view(), resume: p.resume });
    this.sendSquad(p);
    if (this.phase === "live" && this.match) {
      if (p.slot >= 0) this.match.claimSlot(p.slot);
      conn.send({
        t: "start", cfg: this.cfg, slots: this.match.slots(), you: p.slot, resume: true,
      });
    }
    this.say(`${p.name} reconnected.`);
    this.broadcastRoom();
    this.presence([p]);
  }

  drop(id: string, conn: Conn): void {
    const p = this.players.get(id);
    if (!p || p.conn !== conn) return;
    if (p.spectator) { this.remove(p); return; }
    p.away = Date.now() + GRACE_MS;
    p.ready = false;
    if (p.slot >= 0) this.match?.releaseSlot(p.slot);
    this.say(`${p.name} lost connection; holding their place for ${GRACE_MS / 1000}s.`);
    if (this.allReady()) this.timer = Math.min(this.timer, TICK_HZ);
    this.broadcastRoom();
  }

  leave(id: string): void {
    const p = this.players.get(id);
    if (p) this.remove(p);
  }

  private remove(p: Player): void {
    if (p.slot >= 0 && this.phase === "live") {
      if (!p.away) this.match?.releaseSlot(p.slot);
      if (this.kind === "ranked" && p.account !== null && this.match) {
        const u = this.match.combat.units[p.slot];
        if (u) this.quitters.push({ account: p.account, team: u.team, quit: true });
      }
    }
    this.players.delete(p.id);
    if (p.account !== null) {
      try { this.opts.friends?.leftRoom(p.account, this.name); } catch {}
    }
    if (!this.players.size) this.emptied();
    if (this.coop) this.fixCoopPick();
    this.broadcastRoom();
  }

  private emptied(): void {
    if (this.kind !== "custom") return;
    this.code = "";
    if (this.custom) {
      this.custom = null;
      this.built = null;
      this.cfg = { ...this.baseCfg, map: this.rotation[this.rotIndex] };
      this.modeIndex = this.modes.indexOf(this.baseCfg.mode);
    }
  }

  private uniqueName(want: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.name));
    if (!taken.has(want)) return want;
    for (let i = 2; i < 100; i++) {
      const tryIt = `${want.slice(0, 13)}(${i})`;
      if (!taken.has(tryIt)) return tryIt;
    }
    return want;
  }

  input(id: string, keys: number, edges: number, aimX: number, aimY: number,
    seq: number): void {
    const p = this.players.get(id);
    if (!p || p.slot < 0 || p.away || !this.match) return;
    this.match.setInput(p.slot, {
      keys: keys & 15,
      edges: edges & 63,
      aimX: finite(aimX),
      aimY: finite(aimY),
      seq: Math.max(0, Math.min(1e9, Math.floor(finite(seq)))),
    });
  }

  chooseHero(id: string, n: number): void {
    const p = this.players.get(id);
    if (!p) return;
    const count = p.roundSquad?.length ?? p.squad.length;
    const i = Math.floor(Number(n));
    if (!Number.isInteger(i) || i < 0 || i >= count) return;
    p.next = i;
    if (this.phase !== "live" || !p.roundSquad) p.active = i;
    else if (p.slot >= 0 && this.match) this.match.queueHero(p.slot, p.roundSquad[i]);
    this.sendSquad(p);
  }

  setTeam(id: string, team: number): void {
    const p = this.players.get(id);
    if (!p || this.phase !== "lobby") return;
    if (this.kind === "ranked" || this.kind === "clanwar") return;
    p.team = team === 1 || team === 2 ? team : 0;
    this.broadcastRoom();
  }

  setReady(id: string, ready: boolean): void {
    const p = this.players.get(id);
    if (!p || this.phase !== "lobby") return;
    p.ready = ready;
    if (this.allReady()) this.timer = Math.min(this.timer, TICK_HZ);
    this.broadcastRoom();
  }

  chat(id: string, msg: string): void {
    const p = this.players.get(id);
    if (!p) return;
    const m = cleanText(msg, 140);
    if (!m) return;
    this.broadcast({ t: "chat", from: p.clan ? `[${p.clan}] ${p.name}` : p.name, m });
  }

  setPing(id: string, ms: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.ping = Math.max(0, Math.min(9999, Math.round(ms)));
  }

  setSpectate(id: string, v: boolean): void {
    const p = this.players.get(id);
    if (!p || this.phase !== "lobby" || p.spectator === !!v) return;
    if (v && this.spectatorCount >= this.maxSpectators) return;
    if (!v) {
      const barred = this.barredReason(p.account !== null, p.clan);
      if (barred) { this.tell(p, `${barred}.`); return; }
      if (this.playerCount >= this.maxPlayers) {
        this.tell(p, "The room is full; keep watching.");
        return;
      }
    }
    p.spectator = !!v;
    p.ready = false;
    if (this.coop) {
      this.fixCoopPick();
      this.cfg = coopConfig(this.cfg, this.mission, this.playing().length);
    }
    if (this.allReady()) this.timer = Math.min(this.timer, TICK_HZ);
    this.broadcastRoom();
  }

  chooseMission(id: string, n: number, d: number): void {
    if (!this.coop || this.phase !== "lobby" || this.host() !== id) return;
    const want = Math.floor(Number(d));
    const diff = want >= 1 && want <= 3 ? want : this.diff;
    const open = this.openMissions(diff);
    if (!open.length) {
      const p = this.players.get(id);
      if (p) this.tell(p, `Nobody here has unlocked ${DIFF_NAMES[diff]} yet.`);
      return;
    }
    this.diff = diff;
    const i = Math.floor(Number(n));
    if (Number.isFinite(i) && i !== this.mission) {
      const up = i > this.mission;
      const hit = up ? open.find((k) => k >= i) : [...open].reverse().find((k) => k <= i);
      this.mission = hit ?? (up ? open[0] : open[open.length - 1]);
    } else if (!open.includes(this.mission)) {
      this.mission = nearestBelow(open, this.mission);
    }
    this.cfg = coopConfig(this.cfg, this.mission, this.playing().length);
    this.broadcastRoom();
  }

  chooseCustomMap(id: string, mapId: string, mode: string): void {
    const p = this.players.get(id);
    if (!p || this.kind !== "custom" || this.phase !== "lobby" || this.host() !== id) return;
    const want = String(mapId ?? "").trim();
    if (!want) {
      if (!this.custom) return;
      this.custom = null;
      this.built = null;
      this.cfg = { ...this.baseCfg, map: this.rotation[this.rotIndex] };
      this.modeIndex = this.modes.indexOf(this.baseCfg.mode);
      this.say("Back to the stock maps.");
      this.broadcastRoom();
      return;
    }
    const m = (CUSTOM_MODES as readonly string[]).includes(mode) ? mode : "tdm";
    if (!/^[A-Za-z0-9_-]{6,16}$/.test(want) || !this.opts.maps) {
      this.tell(p, "That is not a map link.");
      return;
    }
    let map: CustomMap | null = null;
    let row: ReturnType<MapStore["get"]> = null;
    try {
      row = this.opts.maps.get(want);
      map = row ? sanitiseMap(row.map) : null;
    } catch (e) {
      console.error("[sfh3] custom map load:", e instanceof Error ? e.message : e);
    }
    if (!row || !map) { this.tell(p, "No shared map with that link."); return; }
    const errors = checkMap(map, m).filter((x) => x.level === "error");
    if (errors.length) {
      this.tell(p, `Can't play ${row.name} as ${getGameMode(m).name}: ${errors[0].text}`);
      return;
    }
    this.custom = { id: row.id, name: row.name, author: row.author, map };
    this.built = null;
    const gm = getGameMode(m);
    this.cfg = {
      ...this.baseCfg, map: "custom", cmap: row.id, mode: m,
      score: gm.startscore || this.baseCfg.score,
    };
    this.say(`${p.name} loaded ${row.name} by ${row.author} (${gm.name}).`);
    this.broadcastRoom();
  }

  setPrivate(id: string, v: boolean): void {
    const p = this.players.get(id);
    if (!p || this.kind !== "custom" || this.host() !== id) return;
    if (!!v === this.isPrivate) return;
    this.code = v ? newCode() : "";
    this.say(v ? "The room is now private." : "The room is open to everybody.");
    this.broadcastRoom();
    this.presence([...this.players.values()]);
  }

  castVote(id: string, n: number): void {
    const p = this.players.get(id);
    const b = this.ballot;
    if (!p || !b || p.spectator || !Number.isInteger(n) || n < 0 || n >= b.length) return;
    if (p.vote === n) return;
    p.vote = n;
    this.broadcastRoom();
  }

  private openVote(): void {
    this.ballot = null;
    for (const p of this.players.values()) p.vote = undefined;
    if (this.coop || this.custom) return;
    const nextMode = this.modes[(this.modeIndex + 1) % this.modes.length];
    const next = { map: this.rotation[(this.rotIndex + 1) % this.rotation.length], mode: nextMode };
    const others = this.rotation.filter((m) => m !== next.map && m !== this.cfg.map);
    shuffle(others);
    const otherModes = this.modes.filter((m) => m !== nextMode);
    shuffle(otherModes);
    const entries = [next, ...others.slice(0, VOTE_OTHERS).map((map, i) => ({
      map, mode: otherModes.length ? otherModes[i % otherModes.length] : nextMode,
    }))];
    if (entries.length < 2 && this.cfg.map !== next.map) entries.push({ map: this.cfg.map, mode: nextMode });
    if (entries.length < 2 && otherModes.length) entries.push({ map: next.map, mode: otherModes[0] });
    if (entries.length >= 2) this.ballot = entries;
  }

  private closeVote(): { map: string; mode: string; votes: number } | null {
    const b = this.ballot;
    if (!b) return null;
    const count = this.tally(b);
    this.ballot = null;
    for (const p of this.players.values()) p.vote = undefined;
    let best = 0;
    for (let i = 1; i < b.length; i++) if (count[i] > count[best]) best = i;
    return { ...b[best], votes: count[best] };
  }

  private tally(b: readonly unknown[]): number[] {
    const count = b.map(() => 0);
    for (const p of this.players.values()) {
      if (p.vote !== undefined && !p.spectator && p.vote < b.length) count[p.vote]++;
    }
    return count;
  }

  private host(): string {
    return this.playing()[0]?.id ?? "";
  }

  private clanTag(account: number): string {
    try {
      return this.opts.clans?.tagOf(account) ?? "";
    } catch {
      return "";
    }
  }

  private allReady(): boolean {
    const here = this.playing();
    return here.length > 0 && here.every((p) => p.ready);
  }

  private readCleared(account: number): Cleared | null {
    try {
      return this.opts.progress?.cleared(account) ?? new Map();
    } catch {
      return new Map();
    }
  }

  private openMissions(diff: number): number[] {
    const here = this.playing();
    const who: (Cleared | null)[] = here.length ? here.map((p) => p.cleared) : [null];
    return this.coopList.filter((k) => who.some((c) => unlocked(this.coopList, c, k, diff)));
  }

  private fixCoopPick(): void {
    if (!this.coop || this.phase !== "lobby") return;
    let open = this.openMissions(this.diff);
    if (!open.length) {
      this.diff = 1;
      open = this.openMissions(1);
    }
    if (open.length && !open.includes(this.mission)) this.mission = nearestBelow(open, this.mission);
    this.cfg = coopConfig(this.cfg, this.mission, Math.max(1, this.playing().length));
  }

  update(): void {
    if (++this.secondTick >= TICK_HZ) {
      this.secondTick = 0;
      this.expireAway();
    }
    if (++this.presenceTick >= PRESENCE_EVERY) {
      this.presenceTick = 0;
      this.presence([...this.players.values()].filter((p) => !p.away));
    }
    switch (this.phase) {
      case "lobby":
        if (!this.playing().length || this.waitReason()) {
          this.timer = LOBBY_SECONDS * TICK_HZ;
          return;
        }
        if (--this.timer <= 0) this.startRound();
        else if (this.timer % TICK_HZ === 0) this.broadcastRoom();
        return;

      case "live":
        this.tickMatch();
        return;

      case "over":
        if (--this.timer <= 0) this.backToLobby();
        else if (this.timer % TICK_HZ === 0) this.broadcastRoom();
        return;

      default:
        return;
    }
  }

  private expireAway(): void {
    const now = Date.now();
    for (const p of [...this.players.values()]) {
      if (p.away && now >= p.away) {
        this.say(`${p.name} did not come back.`);
        this.remove(p);
      }
    }
  }

  private waitReason(): string {
    if (this.kind === "ranked") {
      const n = this.playing().filter((p) => p.account !== null).length;
      if (n < RANKED_MIN) return `Ranked needs ${RANKED_MIN} signed-in players (${n} here)`;
    }
    if (this.kind === "clanwar" && !this.warPair()) {
      return "Waiting for players from a second clan";
    }
    return "";
  }

  private warPair(): { a: string; b: string } | null {
    const count = new Map<string, number>();
    for (const p of this.playing()) if (p.clan) count.set(p.clan, (count.get(p.clan) ?? 0) + 1);
    const order = [...count.keys()];
    order.sort((x, y) => (count.get(y) ?? 0) - (count.get(x) ?? 0));
    return order.length >= 2 ? { a: order[0], b: order[1] } : null;
  }

  private startRound(): void {
    this.round++;
    this.quitters = [];
    for (const p of this.players.values()) {
      this.refreshSquad(p);
      if (p.account !== null) p.clan = this.clanTag(p.account);
    }
    let here = this.playing();
    let fixed = false;
    this.war = null;
    if (this.kind === "clanwar") {
      const pair = this.warPair();
      if (!pair) { this.backToLobby(); return; }
      this.war = pair;
      here = here.filter((p) => p.clan === pair.a || p.clan === pair.b);
      for (const p of here) p.team = p.clan === pair.a ? 1 : 2;
      fixed = true;
      const rest = this.playing().filter((p) => !here.includes(p));
      for (const p of rest) this.tell(p, `This round is [${pair.a}] vs [${pair.b}]; you sit this one out.`);
    } else if (this.kind === "ranked") {
      here = here.filter((p) => p.account !== null);
      this.balanceByRating(here);
      fixed = true;
    }
    const joining: JoiningPlayer[] = here.map((p) => ({
      id: p.id, name: p.name, squad: p.squad, active: p.active, team: p.team, clan: p.clan,
    }));
    let cfg: MatchConfig;
    let roster: RosterEntry[];
    let custom: { def: ArenaDef; info: MapInfo } | undefined;
    if (this.coop) {
      cfg = coopConfig(this.cfg, this.mission, joining.length);
      roster = buildCoopRoster(this.mission, this.diff, joining);
      cfg.bots = roster.filter((e) => !e.owner).length;
    } else if (fixed) {
      const t1 = joining.filter((j) => j.team === 1).length;
      cfg = { ...this.cfg, bots: Math.abs(joining.length - 2 * t1) };
      roster = buildRoster(cfg, joining, true);
    } else {
      const want = Math.max(0, Math.min(this.cfg.bots, this.maxPlayers - joining.length));
      cfg = { ...this.cfg, bots: want };
      roster = buildRoster(cfg, joining);
    }
    if (this.coop) this.cfg = cfg;
    try {
      if (this.custom) custom = this.customArena(cfg.mode);
      this.match = new ServerMatch(cfg, roster, this.opts.assetDir, custom);
    } catch (e) {
      const what = this.custom?.name ?? cfg.map;
      console.error(`[sfh3] round on "${what}" failed to start:`,
        e instanceof Error ? e.message : e);
      this.say(`Could not load ${what}; skipping it.`);
      if (this.custom) {
        this.custom = null;
        this.built = null;
        this.cfg = { ...this.baseCfg, map: this.rotation[this.rotIndex] };
        this.modeIndex = this.modes.indexOf(this.baseCfg.mode);
      } else {
        this.dropMap(cfg.map);
      }
      this.backToLobby();
      return;
    }
    this.phase = "live";
    this.pending = null;
    if (this.custom) {
      try {
        this.opts.maps?.played(this.custom.id);
      } catch (e) {
        console.error("[sfh3] counting a map play failed:", e instanceof Error ? e.message : e);
      }
    }

    roster.forEach((entry, i) => {
      if (!entry.owner) return;
      const p = this.players.get(entry.owner);
      if (!p) return;
      p.slot = i;
      p.roundSquad = entry.squad ?? [entry.info];
      p.active = p.next = entry.active ?? 0;
    });

    const slots = this.match.slots();
    for (const p of this.players.values()) {
      if (p.away) continue;
      p.conn.send({ t: "start", cfg, slots, you: p.slot });
      this.sendSquad(p);
      p.joinedRound = this.round;
    }
    this.broadcastRoom();
  }

  private balanceByRating(here: Player[]): void {
    const order = [...here].sort((a, b) => b.rating - a.rating);
    order.forEach((p, i) => { p.team = i % 4 === 0 || i % 4 === 3 ? 1 : 2; });
  }

  private customArena(mode: string): { def: ArenaDef; info: MapInfo } {
    const c = this.custom;
    if (!c) throw new Error("no custom map");
    const key = `${c.id}:${mode}`;
    if (this.built?.key !== key) {
      this.built = { key, def: buildArena(c.map, mode), info: customMapInfo(c.map) };
    }
    return { def: this.built.def, info: this.built.info };
  }

  private tickMatch(): void {
    const m = this.match;
    if (!m) { this.backToLobby(); return; }

    if (!this.playerCount) { this.backToLobby(); return; }

    m.update();
    this.trackHeroes(m);
    this.pending = merge(this.pending, m.snapshot());
    if (m.tick % SEND_EVERY === 0 || m.gameEnded) {
      const snap = this.pending;
      this.pending = null;
      if (snap) this.broadcast({ t: "snap", s: snap });
      this.sendYou(m);
    }

    if (!m.gameEnded) return;

    for (const p of this.players.values()) {
      const u = p.slot >= 0 ? m.combat.units[p.slot] : null;
      if (u) { p.kills = u.score.kills; p.deaths = u.score.deaths; }
    }
    const r = m.result;
    this.broadcast({
      t: "end",
      winner: r?.winner ?? 0,
      s1: r?.team1 ?? 0,
      s2: r?.team2 ?? 0,
      ranOut: r?.ranOut ?? false,
    });
    const coopWon = this.coop && !!r && r.winner === 1;
    const exp = this.settle(m, coopWon);
    const moved = this.kind === "ranked" ? this.settleRanked(m) : new Map<number, number>();
    if (this.kind === "clanwar") this.settleWar(m);
    this.recordHistory(m, exp, moved);
    if (this.coop) this.coopResult(coopWon);
    this.phase = "over";
    this.openVote();
    this.timer = (this.ballot ? VOTE_OVER_SECONDS : OVER_SECONDS) * TICK_HZ;
    this.broadcastRoom();
  }

  private coopResult(won: boolean): void {
    const { title } = describeMission(this.mission);
    if (!won) {
      this.say(`${title} failed. Go again, or the host can pick another.`);
      return;
    }
    const next = nextMission(this.coopList, this.mission);
    const open = this.openMissions(this.diff);
    if (open.includes(next)) this.mission = next;
    this.say(`${title} complete! Next up: ${describeMission(this.mission).title}.`);
  }

  private trackHeroes(m: ServerMatch): void {
    for (const p of this.players.values()) {
      if (p.slot < 0 || !p.roundSquad || p.active === p.next) continue;
      if (m.heroPending(p.slot)) continue;
      const u = m.combat.units[p.slot];
      const now = u ? p.roundSquad.indexOf(u.unitInfo) : -1;
      if (now < 0 || now === p.active) continue;
      p.active = now;
      this.sendSquad(p);
    }
  }

  private settle(m: ServerMatch, coopWon: boolean): Map<number, number> {
    const paid = new Map<number, number>();
    const store = this.opts.accounts;
    if (!store) return paid;
    const r = m.result;
    const teamed = getGameMode(this.cfg.mode).teams;
    for (const p of this.players.values()) {
      if (p.account === null || p.slot < 0 || !p.roundSquad || p.away) continue;
      const u = m.combat.units[p.slot];
      if (!u) continue;
      const won = !!r && (teamed ? r.winner !== 0 && r.winner === u.team : r.winner === p.slot);
      poolExp(p.roundSquad);
      let bonus = 0;
      let first = false;
      if (coopWon) {
        try {
          first = this.opts.progress?.record(p.account, this.mission, this.diff) ?? false;
        } catch (e) {
          console.error("[sfh3] recording a co-op clear failed:", e instanceof Error ? e.message : e);
        }
        bonus = clearBonus(this.diff, first);
        p.cleared = this.readCleared(p.account);
      }
      const earned = p.roundSquad.map((h, k) => ({
        hero: p.heroIds[k] ?? -1, exp: Math.round(h.earnedExp) + bonus,
      }));
      try {
        const { account, rows } = store.credit(p.account, earned, {
          rounds: 1, wins: won ? 1 : 0, kills: u.score.kills, deaths: u.score.deaths,
        });
        paid.set(p.account, earned.reduce((t, e) => t + e.exp, 0));
        p.conn.send({
          t: "earned", rows, stats: account.profile.stats,
          ...(coopWon ? { bonus, first } : {}),
        });
        this.refreshSquad(p, account.profile);
      } catch (e) {
        console.error(`[sfh3] crediting account ${p.account} failed:`,
          e instanceof Error ? e.message : e);
      }
    }
    return paid;
  }

  private recordHistory(m: ServerMatch, exp: ReadonlyMap<number, number>,
    moved: ReadonlyMap<number, number>): void {
    const h = this.opts.history;
    if (!h) return;
    const r = m.result;
    const teamed = getGameMode(this.cfg.mode).teams;
    const rows: HistoryRow[] = [];
    const guns = new Map<number, Map<string, number>>();
    for (const p of this.players.values()) {
      if (p.account === null || p.slot < 0 || p.away) continue;
      const u = m.combat.units[p.slot];
      if (!u) continue;
      const won = !r ? 0
        : teamed ? r.winner === 0 ? -1 : r.winner === u.team ? 1 : 0
          : r.winner === p.slot ? 1 : 0;
      const delta = moved.get(p.account);
      rows.push({
        account: p.account, room: this.name, kind: this.kind, mode: this.cfg.mode,
        map: this.custom ? `#${this.custom.name}` : this.cfg.map,
        won, kills: u.score.kills, deaths: u.score.deaths, exp: exp.get(p.account) ?? 0,
        ...(delta !== undefined ? { rating: delta } : {}),
      });
      const byGun = m.gunKills.get(p.slot);
      if (byGun) guns.set(p.account, byGun);
    }
    try {
      h.record(rows, guns);
    } catch (e) {
      console.error("[sfh3] recording history failed:", e instanceof Error ? e.message : e);
    }
  }

  private settleRanked(m: ServerMatch): Map<number, number> {
    const moved = new Map<number, number>();
    const ratings = this.opts.ratings;
    if (!ratings) return moved;
    const entries: RankedEntry[] = [...this.quitters];
    const byAccount = new Map<number, Player>();
    for (const p of this.players.values()) {
      if (p.account === null || p.slot < 0) continue;
      const u = m.combat.units[p.slot];
      if (!u) continue;
      entries.push({ account: p.account, team: u.team, quit: !!p.away });
      byAccount.set(p.account, p);
    }
    this.quitters = [];
    try {
      const season = seasonOf();
      const changes = ratings.settle(entries, m.result?.winner ?? 0, season);
      for (const c of changes) {
        moved.set(c.account, c.to - c.from);
        const p = byAccount.get(c.account);
        if (!p) continue;
        p.rating = c.to;
        p.games = c.games;
        if (!p.away) {
          p.conn.send({
            t: "rating", from: c.from, to: c.to, rank: rankLabel(c.to, c.games), season,
          });
        }
      }
    } catch (e) {
      console.error("[sfh3] ranked settle failed:", e instanceof Error ? e.message : e);
    }
    return moved;
  }

  private settleWar(m: ServerMatch): void {
    const w = this.war;
    const r = m.result;
    if (!w || !r) return;
    const winner = r.winner === 1 ? w.a : r.winner === 2 ? w.b : "";
    try {
      this.opts.clans?.recordWar(w.a, w.b, winner, r.team1, r.team2);
    } catch (e) {
      console.error("[sfh3] recording a clan war failed:", e instanceof Error ? e.message : e);
    }
    this.say(winner
      ? `[${winner}] wins the clan war against [${winner === w.a ? w.b : w.a}], ${Math.max(r.team1, r.team2)}-${Math.min(r.team1, r.team2)}.`
      : `[${w.a}] and [${w.b}] draw.`);
  }

  private refreshSquad(p: Player, profile?: AccountProfile): void {
    if (p.account === null) return;
    const prof = profile ?? this.opts.accounts?.get(p.account)?.profile;
    if (!prof) return;
    const { blobs, heroIds } = squadOf(prof);
    const was = p.heroIds[p.active];
    p.squad = blobs;
    p.heroIds = heroIds;
    const at = heroIds.indexOf(was);
    p.active = p.next = at >= 0 ? at : 0;
  }

  private sendSquad(p: Player): void {
    const heroes = p.roundSquad
      ? p.roundSquad.map((h, k) => ({ ...heroToWire(h), name: p.squad[k]?.name ?? h.name }))
      : p.squad;
    p.conn.send({ t: "squad", heroes, active: p.active, next: p.next });
  }

  private sendYou(m: ServerMatch): void {
    for (const p of this.players.values()) {
      if (p.slot < 0 || p.away) continue;
      const y = m.youState(p.slot);
      if (y) p.conn.send({ t: "you", y });
    }
  }

  private presence(list: Player[]): void {
    const f = this.opts.friends;
    if (!f) return;
    const ids = list.filter((p) => p.account !== null && !p.away).map((p) => p.account as number);
    try {
      f.inRoom(ids, { room: this.name, code: this.code });
    } catch (e) {
      console.error("[sfh3] presence:", e instanceof Error ? e.message : e);
    }
  }

  private say(m: string): void {
    this.broadcast({ t: "chat", from: "server", m });
  }

  private tell(p: Player, m: string): void {
    p.conn.send({ t: "chat", from: "server", m });
  }

  private dropMap(map: string): void {
    if (this.rotation.length <= 1) return;
    const at = this.rotation.indexOf(map);
    if (at < 0) return;
    this.rotation.splice(at, 1);
    if (this.rotIndex >= at) this.rotIndex--;
    console.error(`[sfh3] "${map}" dropped; ${this.rotation.length} map(s) left`);
  }

  private backToLobby(): void {
    this.match = null;
    this.pending = null;
    this.phase = "lobby";
    this.timer = LOBBY_SECONDS * TICK_HZ;
    this.war = null;
    this.quitters = [];
    const voted = this.closeVote();
    if (this.coop) {
      this.fixCoopPick();
    } else if (!this.custom) {
      const at = voted ? this.rotation.indexOf(voted.map) : -1;
      this.rotIndex = at >= 0 ? at : (this.rotIndex + 1) % this.rotation.length;
      const mi = voted ? this.modes.indexOf(voted.mode) : -1;
      this.modeIndex = mi >= 0 ? mi : (this.modeIndex + 1) % this.modes.length;
      this.cfg = this.withMode({ ...this.cfg, map: this.rotation[this.rotIndex] },
        this.modes[this.modeIndex]);
      if (voted?.votes) {
        const mode = this.modes.length > 1 ? `, ${getGameMode(voted.mode).name}` : "";
        this.say(`Next map: ${getMap(voted.map).name}${mode}.`);
      }
    }
    for (const p of this.players.values()) {
      p.slot = -1;
      p.ready = false;
      p.roundSquad = null;
      if (!p.away) this.sendSquad(p);
    }
    this.broadcastRoom();
  }

  view(): RoomView {
    const ranked = this.kind === "ranked";
    const players: PlayerView[] = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, ready: p.ready,
      slot: p.slot, ping: p.ping, kills: p.kills, deaths: p.deaths,
      acct: p.account !== null,
      spec: p.spectator, clan: p.clan, away: !!p.away,
      ...(this.ballot && p.vote !== undefined ? { vote: p.vote } : {}),
      ...(ranked && p.account !== null
        ? { rank: rankLabel(p.rating, p.games), tier: tierOf(p.rating, p.games) }
        : {}),
    }));
    let coop: CoopView | undefined;
    if (this.coop) {
      const d = describeMission(this.mission);
      const here = this.playing().filter((p) => p.cleared);
      const cleared = here.some((p) => (p.cleared?.get(this.mission) ?? 0) >= this.diff);
      const fresh = here.some((p) => (p.cleared?.get(this.mission) ?? 0) < this.diff);
      coop = {
        mission: this.mission, title: d.title, desc: d.desc, diff: this.diff,
        host: this.host(), count: this.coopList.length,
        open: this.openMissions(this.diff), cleared,
        bonus: clearBonus(this.diff, fresh || !here.length),
      };
    }
    let custom: CustomView | undefined;
    if (this.kind === "custom") {
      custom = {
        host: this.host(), id: this.custom?.id ?? "", name: this.custom?.name ?? "",
        author: this.custom?.author ?? "", private: this.isPrivate, code: this.code,
      };
    }
    const wait = this.phase === "lobby" ? this.waitReason() : "";
    return {
      name: this.name,
      phase: this.phase,
      cfg: this.cfg,
      players,
      maxPlayers: this.maxPlayers,
      countdown: Math.ceil(this.timer / TICK_HZ),
      maxSpectators: this.maxSpectators,
      coop,
      kind: this.kind,
      ...(wait ? { wait } : {}),
      ...(this.kind === "clanwar" ? { war: this.war ?? this.warPair() ?? undefined } : {}),
      ...(ranked ? { season: seasonOf() } : {}),
      custom,
      ...(this.ballot
        ? {
          vote: {
            maps: this.ballot.map((e) => e.map),
            ...(this.modes.length > 1 ? { modes: this.ballot.map((e) => e.mode) } : {}),
            votes: this.tally(this.ballot),
          },
        }
        : {}),
    };
  }

  private broadcastRoom(): void {
    this.broadcast({ t: "room", room: this.view() });
  }

  private broadcast(msg: ServerMsg): void {
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) if (!p.away) p.conn.sendRaw(raw);
  }
}

const DIFF_NAMES = ["", "NORMAL", "HARD", "INSANE"];

function nearestBelow(list: readonly number[], k: number): number {
  let best = list[0];
  for (const v of list) if (v <= k) best = v;
  return best;
}

function shuffle<T>(a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function newCode(): string {
  const b = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}

function merge(into: Snapshot | null, next: Snapshot): Snapshot {
  if (!into) return next;
  return {
    ...next,
    ev: [...into.ev, ...next.ev],
    lines: [...into.lines, ...next.lines],
  };
}

function squadOf(profile: AccountProfile): {
  blobs: Record<string, unknown>[]; heroIds: number[];
} {
  const heroIds = profile.squad.filter((i) => profile.heroes[i]).slice(0, MAX_SQUAD);
  return { blobs: heroIds.map((i) => profile.heroes[i]), heroIds };
}

function finite(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const SERVER_MODES: readonly string[] = ALL_GAME_MODE_IDS;

export const ROOM_KINDS: readonly RoomKind[] = ["normal", "coop", "ranked", "clanwar", "custom"];

export function defaultConfig(): MatchConfig {
  return {
    map: SERVER_MAP_IDS[0],
    mode: "tdm",
    score: getGameMode("tdm").startscore,
    mod: "none",
    bots: 8,
    botLevel: 12,
    timeLimit: 600,
  };
}
