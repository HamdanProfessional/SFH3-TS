import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { Room, defaultConfig, ROOM_KINDS, SERVER_MODES } from "./Room";
import type { Conn } from "./Room";
import { SERVER_MAP_IDS } from "./mapLoad";
import { AccountStore } from "./accounts";
import { AccountApi, MAX_BODY, clientIp } from "./accountApi";
import { MapStore } from "./mapStore";
import { MapApi } from "./mapApi";
import { StatusTracker, type ServerStatus } from "./status";
import { getGameMode } from "../src/game/MatchSettings";
import {
  PROTOCOL_VERSION, TICK_HZ,
  type ClientMsg, type RoomKind, type ServerInfo, type ServerMsg,
} from "../src/net/protocol";

interface Args {
  port: number;
  name: string;
  assets: string;
  max: number;
  bots: number;
  botLevel: number;
  mode: string;
  map: string;
  score: number;
  mod: string;
  timeLimit: number;
  rotation: string[];
  modes: string[];
  db: string | null;
  kind: RoomKind;
  spectators: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (flag: string, fallback: number): number => {
    const v = Number(get(flag));
    return Number.isFinite(v) ? v : fallback;
  };
  const d = defaultConfig();
  const mode = get("mode") ?? d.mode;
  if (!SERVER_MODES.includes(mode)) {
    throw new Error(`--mode ${mode} is not one of: ${SERVER_MODES.join(" ")}`);
  }
  const map = get("map") ?? d.map;
  if (!SERVER_MAP_IDS.includes(map)) {
    throw new Error(`--map ${map} is not one of: ${SERVER_MAP_IDS.join(" ")}`);
  }
  return {
    port: num("port", 7801),
    name: get("name") ?? "sfh3 server",
    assets: get("assets") ?? "public/assets",
    max: Math.max(2, Math.min(16, num("max", 12))),
    bots: Math.max(0, Math.min(15, num("bots", d.bots))),
    botLevel: Math.max(1, Math.min(50, num("botLevel", d.botLevel))),
    mode,
    map,
    score: Math.max(1, num("score", getGameMode(mode).startscore || d.score)),
    mod: get("mod") ?? "none",
    timeLimit: Math.max(0, num("timeLimit", d.timeLimit)),
    rotation: (get("rotation") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    modes: (get("modes") ?? "").split(",").map((s) => s.trim()).filter((m) => SERVER_MODES.includes(m)),
    db: get("db") ?? null,
    kind: kindOf(get("kind"), get("coop")),
    spectators: Math.max(0, Math.min(32, num("spectators", 8))),
  };
}

function kindOf(kind: string | undefined, coop: string | undefined): RoomKind {
  const k = String(kind ?? "").toLowerCase();
  if ((ROOM_KINDS as readonly string[]).includes(k)) return k as RoomKind;
  return ["1", "true", "yes"].includes(String(coop ?? "").toLowerCase()) ? "coop" : "normal";
}

const args = parseArgs(process.argv.slice(2));

const accounts = args.db ? new AccountStore(args.db) : null;
const api = accounts ? new AccountApi(accounts) : null;
const mapStore = accounts && args.db ? new MapStore(args.db) : null;
const maps = mapStore && accounts ? new MapApi(mapStore, accounts) : null;

const room = new Room({
  name: args.name,
  maxPlayers: args.max,
  assetDir: args.assets,
  rotation: args.rotation,
  modes: args.modes,
  accounts,
  clans: api?.clans ?? null,
  kind: args.kind,
  progress: api?.progress ?? null,
  ratings: api?.ratings ?? null,
  friends: api?.friends ?? null,
  maps: mapStore,
  history: api?.history ?? null,
  maxSpectators: args.spectators,
  cfg: {
    map: args.map,
    mode: args.mode,
    score: args.score,
    mod: args.mod,
    bots: args.bots,
    botLevel: args.botLevel,
    timeLimit: args.timeLimit,
  },
});

const status = new StatusTracker(TICK_HZ);
status.hookConsole();

function countError(where: string, e: unknown): void {
  console.error(`[sfh3] ${where}:`, e instanceof Error ? e.message : e);
}

function statusReport(): ServerStatus {
  const v = room.view();
  return status.snapshot({
    ok: true,
    protocol: PROTOCOL_VERSION,
    name: v.name,
    kind: room.kind,
    phase: room.phase,
    map: v.cfg.map,
    mode: v.cfg.mode,
    players: room.playerCount,
    maxPlayers: v.maxPlayers,
    spectators: room.spectatorCount,
    bots: v.cfg.bots,
    connections: live.size,
  });
}

function info(): ServerInfo {
  const v = room.view();
  return {
    ok: true,
    protocol: PROTOCOL_VERSION,
    name: v.name,
    phase: v.phase,
    map: v.cfg.map,
    mode: v.cfg.mode,
    players: room.playerCount,
    maxPlayers: v.maxPlayers,
    bots: v.cfg.bots,
    spectators: room.spectatorCount,
    coop: room.coop,
    kind: room.kind,
    private: room.isPrivate,
    ...(room.averageRating !== undefined ? { rating: room.averageRating } : {}),
    ...(room.customName ? { custom: room.customName } : {}),
  };
}

const http = createServer((req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const [path, qs] = (req.url ?? "/").split("?");
  if (path === "/account" || path.startsWith("/account/")) {
    serveAccount(req, res, path, new URLSearchParams(qs ?? ""));
    return;
  }
  if (path === "/maps" || path.startsWith("/maps/")) {
    if (maps) maps.serve(req, res);
    else res.writeHead(503, { "Content-Type": "application/json" }).end('{"ok":false,"error":"Maps are off here"}');
    return;
  }
  if (path === "/info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info()));
    return;
  }
  if (path === "/status") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(statusReport()));
    return;
  }
  if (path === "/health") { res.writeHead(200).end("ok"); return; }
  res.writeHead(404).end("sfh3 server");
});

function serveAccount(req: IncomingMessage, res: ServerResponse, path: string,
  query: URLSearchParams): void {
  const send = (status: number, body: unknown): void => {
    if (res.headersSent) return;
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  if (!api) { send(503, { ok: false, error: "Accounts are off on this server" }); return; }

  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) {
      send(413, { ok: false, error: "Too big" });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (size > MAX_BODY) return;
    let body: unknown = {};
    if (size) {
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { send(400, { ok: false, error: "Bad JSON" }); return; }
    }
    void api.handle({
      method: req.method ?? "GET",
      path,
      auth: req.headers.authorization,
      ip: clientIp(req.headers["x-forwarded-for"], req.socket.remoteAddress),
      body,
      query,
    }).then((r) => send(r.status, r.body), (e: unknown) => {
      countError("account request", e);
      send(500, { ok: false, error: "Server error" });
    });
  });
}

const wss = new WebSocketServer({ server: http });

const PING_EVERY = TICK_HZ / 2;

interface Live {
  conn: Conn;
  sentAt: Map<number, number>;
  pingSeq: number;
  budget: number;
}

const live = new Map<WebSocket, Live>();

wss.on("connection", (ws: WebSocket) => {
  const id = randomUUID();
  let joined = false;
  let pid: string = id;

  const conn: Conn = {
    id,
    send(msg: ServerMsg) {
      conn.sendRaw(JSON.stringify(msg));
    },
    sendRaw(json: string) {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(json);
    },
    close(why: string) {
      conn.send({ t: "bye", why });
      ws.close();
    },
  };
  const state: Live = { conn, sentAt: new Map(), pingSeq: 0, budget: 0 };
  live.set(ws, state);

  ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const text = raw.toString();
    state.budget += text.length;
    if (state.budget > 65536) { conn.close("flooding"); return; }

    let msg: ClientMsg;
    try {
      msg = JSON.parse(text) as ClientMsg;
    } catch {
      conn.close("bad json");
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (!joined) {
      if (msg.t !== "hello") { conn.close("say hello first"); return; }
      if (msg.protocol !== PROTOCOL_VERSION) {
        conn.close(`this server speaks protocol ${PROTOCOL_VERSION}`);
        return;
      }
      const r = room.join(conn, {
        name: msg.name, token: msg.token, squad: msg.squad,
        spectate: msg.spectate === true, resume: msg.resume, code: msg.code,
      });
      if ("error" in r) { conn.close(r.error); return; }
      pid = r.id;
      joined = true;
      return;
    }

    switch (msg.t) {
      case "input": room.input(pid, msg.k, msg.e, msg.ax, msg.ay, msg.q); break;
      case "team": room.setTeam(pid, msg.n); break;
      case "ready": room.setReady(pid, msg.v); break;
      case "chat": room.chat(pid, String(msg.m ?? "")); break;
      case "hero": room.chooseHero(pid, msg.n); break;
      case "spectate": room.setSpectate(pid, msg.v === true); break;
      case "mission": room.chooseMission(pid, msg.n, msg.d); break;
      case "cmap": room.chooseCustomMap(pid, String(msg.id ?? ""), String(msg.mode ?? "")); break;
      case "private": room.setPrivate(pid, msg.v === true); break;
      case "vote": room.castVote(pid, Number(msg.n)); break;
      case "leave":
        room.leave(pid);
        joined = false;
        ws.close();
        break;
      case "pong": {
        const at = state.sentAt.get(msg.n);
        if (at !== undefined) {
          room.setPing(pid, Date.now() - at);
          state.sentAt.delete(msg.n);
        }
        break;
      }
      default: break;
    }
  });

  const drop = (): void => {
    live.delete(ws);
    if (joined) room.drop(pid, conn);
    joined = false;
  };
  ws.on("close", drop);
  ws.on("error", drop);
});

let next = Date.now();
let pingTick = 0;

function loop(): void {
  const step = 1000 / TICK_HZ;
  const now = Date.now();
  let steps = 0;
  while (now >= next && steps < 5) {
    status.tick(() => room.update());
    next += step;
    steps++;
  }
  if (steps >= 5) { next = now + step; status.stall(); }
  status.observe(room.phase, () => room.playerCount);

  if (++pingTick >= PING_EVERY) {
    pingTick = 0;
    for (const [ws, st] of live) {
      if (ws.readyState !== ws.OPEN) continue;
      st.budget = 0;
      const n = ++st.pingSeq;
      st.sentAt.set(n, Date.now());
      if (st.sentAt.size > 8) {
        for (const k of [...st.sentAt.keys()].slice(0, 4)) st.sentAt.delete(k);
      }
      st.conn.send({ t: "ping", n });
    }
  }
  setTimeout(loop, Math.max(0, next - Date.now()));
}

http.listen(args.port, "127.0.0.1", () => {
  console.log(
    `[sfh3] "${args.name}" on 127.0.0.1:${args.port} — `
      + (args.kind === "coop" ? "co-op campaign" : `${args.kind}: ${args.mode} / ${args.map}, ${args.bots} bots`)
    + `, up to ${args.max} players + ${args.spectators} watching`,
  );
  console.log(`[sfh3] assets: ${args.assets}`);
  console.log(`[sfh3] accounts: ${args.db ?? "off (guests only)"}`);
  loop();
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    for (const [, st] of live) st.conn.close("server shutting down");
    http.close(() => { maps?.close(); accounts?.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
