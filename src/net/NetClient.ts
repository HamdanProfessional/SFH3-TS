import {
  PROTOCOL_VERSION,
  type AccountStats, type EarnedRow,
  type ClientMsg, type MatchConfig, type RoomView, type ServerMsg,
  type Snapshot, type UnitSlot, type YouState,
} from "./protocol";

export type NetState = "idle" | "connecting" | "lobby" | "playing" | "closed";

export interface RoundStart {
  cfg: MatchConfig;
  slots: UnitSlot[];
  you: number;
}

export interface NetSquad {
  heroes: Record<string, unknown>[];
  active: number;
  next: number;
}

export interface NetHandlers {
  onRoom?(room: RoomView): void;
  onStart?(start: RoundStart): void;
  onSnapshot?(s: Snapshot): void;
  onEnd?(winner: number, s1: number, s2: number, ranOut: boolean): void;
  onChat?(from: string, text: string): void;
  onClosed?(why: string): void;
  onSquad?(squad: NetSquad): void;
  onEarned?(): void;
  onRating?(): void;
}

const RECONNECT_MS = 55_000;
const RECONNECT_EVERY_MS = 2_000;

export class NetClient {
  state: NetState = "idle";
  error = "";
  room: RoomView | null = null;
  round: RoundStart | null = null;
  id = "";
  ping = 0;
  you: YouState | null = null;
  readonly chat: { from: string; text: string }[] = [];
  readonly url: string;
  squad: NetSquad | null = null;
  squadVersion = 0;
  earned: { rows: EarnedRow[]; stats: AccountStats; bonus?: number; first?: boolean } | null = null;
  rating: { from: number; to: number; rank: string; season: string } | null = null;
  resume = "";
  reconnecting = false;

  private ws: WebSocket | null = null;
  private handlers: NetHandlers = {};
  private pingSentAt = 0;
  private readonly buf: Snapshot[] = [];
  private retryUntil = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, private readonly name: string,
    private readonly token: string | null,
    private readonly guestSquad: readonly Record<string, unknown>[],
    readonly watch = false,
    private readonly code = "") {
    this.url = url;
  }

  on(h: NetHandlers): this {
    this.handlers = { ...this.handlers, ...h };
    return this;
  }

  connect(): void {
    if (this.ws) return;
    this.state = "connecting";
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.fail(`cannot open ${this.url}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({
        t: "hello", protocol: PROTOCOL_VERSION, name: this.name,
        ...(this.token ? { token: this.token } : {}),
        squad: [...this.guestSquad],
        ...(this.watch ? { spectate: true } : {}),
        ...(this.resume ? { resume: this.resume } : {}),
        ...(this.code ? { code: this.code } : {}),
      });
    };
    ws.onmessage = (ev: MessageEvent) => this.receive(String(ev.data));
    ws.onerror = () => { if (this.state !== "closed") this.error = "connection failed"; };
    ws.onclose = () => this.lost();
  }

  private lost(): void {
    this.ws = null;
    if (this.state === "closed") return;
    if (!this.resume || this.state === "connecting" && !this.reconnecting) {
      this.fail(this.error || "disconnected");
      return;
    }
    const now = Date.now();
    if (!this.reconnecting) {
      this.reconnecting = true;
      this.retryUntil = now + RECONNECT_MS;
    }
    if (now >= this.retryUntil) {
      this.reconnecting = false;
      this.fail("connection lost");
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.state === "closed") return;
      this.error = "";
      this.redial();
    }, RECONNECT_EVERY_MS);
  }

  private redial(): void {
    const keep = this.state;
    this.connect();
    if (this.state === "connecting") this.state = keep;
  }

  leave(): void {
    this.send({ t: "leave" });
    this.close();
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.state = "closed";
    this.reconnecting = false;
    this.resume = "";
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try { ws.close(); } catch {}
    }
  }

  private fail(why: string): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.reconnecting = false;
    this.resume = "";
    this.error = why;
    this.ws = null;
    this.handlers.onClosed?.(why);
  }

  private send(msg: ClientMsg): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendInput(keys: number, edges: number, aimX: number, aimY: number,
    seq: number): void {
    this.send({
      t: "input", k: keys, e: edges,
      ax: Math.round(aimX), ay: Math.round(aimY), q: seq,
    });
  }

  setTeam(n: number): void { this.send({ t: "team", n }); }
  setReady(v: boolean): void { this.send({ t: "ready", v }); }
  say(text: string): void { this.send({ t: "chat", m: text }); }
  chooseHero(n: number): void { this.send({ t: "hero", n }); }
  setSpectate(v: boolean): void { this.send({ t: "spectate", v }); }
  chooseMission(n: number, d: number): void { this.send({ t: "mission", n, d }); }
  chooseCustomMap(id: string, mode: string): void { this.send({ t: "cmap", id, mode }); }
  setPrivate(v: boolean): void { this.send({ t: "private", v }); }
  vote(n: number): void { this.send({ t: "vote", n }); }

  private receive(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.t) {
      case "welcome": {
        const wasPlaying = this.reconnecting && this.state === "playing";
        this.id = msg.you;
        this.room = msg.room;
        this.resume = msg.resume ?? "";
        this.reconnecting = false;
        const live = msg.room.phase === "live" || msg.room.phase === "loading";
        this.state = wasPlaying && live ? "playing" : "lobby";
        this.handlers.onRoom?.(msg.room);
        break;
      }
      case "room":
        this.room = msg.room;
        if (this.state !== "playing") this.state = "lobby";
        this.handlers.onRoom?.(msg.room);
        break;
      case "start": {
        const same = msg.resume && this.round && this.state === "playing"
          && this.round.slots.length === msg.slots.length && this.round.you === msg.you;
        this.round = { cfg: msg.cfg, slots: msg.slots, you: msg.you };
        this.you = null;
        this.state = "playing";
        if (same) break;
        this.buf.length = 0;
        this.handlers.onStart?.(this.round);
        break;
      }
      case "snap":
        this.push(msg.s);
        this.handlers.onSnapshot?.(msg.s);
        break;
      case "you":
        if (!this.you || msg.y.t > this.you.t) this.you = msg.y;
        break;
      case "end":
        this.state = "lobby";
        this.handlers.onEnd?.(msg.winner, msg.s1, msg.s2, msg.ranOut);
        break;
      case "chat":
        this.chat.push({ from: msg.from, text: msg.m });
        if (this.chat.length > 40) this.chat.shift();
        this.handlers.onChat?.(msg.from, msg.m);
        break;
      case "ping":
        if (this.pingSentAt) this.ping = Date.now() - this.pingSentAt;
        this.pingSentAt = Date.now();
        this.send({ t: "pong", n: msg.n });
        break;
      case "bye":
        this.fail(msg.why);
        break;
      case "squad":
        this.squad = { heroes: msg.heroes, active: msg.active, next: msg.next };
        this.squadVersion++;
        this.handlers.onSquad?.(this.squad);
        break;
      case "earned":
        this.earned = { rows: msg.rows, stats: msg.stats, bonus: msg.bonus, first: msg.first };
        this.handlers.onEarned?.();
        break;
      case "rating":
        this.rating = { from: msg.from, to: msg.to, rank: msg.rank, season: msg.season };
        this.handlers.onRating?.();
        break;
      default:
        break;
    }
  }

  get me(): RoomView["players"][number] | null {
    return this.room?.players.find((p) => p.id === this.id) ?? null;
  }

  get snaps(): readonly Snapshot[] {
    return this.buf;
  }

  get snapshot(): Snapshot | null {
    return this.buf.length ? this.buf[this.buf.length - 1] : null;
  }

  private static readonly KEEP = 32;

  private push(s: Snapshot): void {
    const buf = this.buf;
    let at = buf.length;
    while (at > 0 && buf[at - 1].t > s.t) at--;
    if (at > 0 && buf[at - 1].t === s.t) return;
    buf.splice(at, 0, s);
    if (buf.length > NetClient.KEEP) buf.splice(0, buf.length - NetClient.KEEP);
  }
}

let session: NetClient | null = null;

export function netSession(): NetClient | null {
  return session;
}

export function setNetSession(c: NetClient | null): void {
  if (session && session !== c) session.leave();
  session = c;
}
