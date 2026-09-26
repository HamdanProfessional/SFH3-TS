import { PROTOCOL_VERSION, type ServerInfo } from "./protocol";

export interface ServerEntry {
  name: string;
  url: string;
  region?: string;
}

export interface ServerRow {
  entry: ServerEntry;
  info: ServerInfo | null;
  ping: number;
  error: string;
}

const LIST_URL = "servers.json";

const DEV_FALLBACK: ServerEntry[] = [
  { name: "Local server", url: "ws://127.0.0.1:7801", region: "dev" },
];

function servedLocally(): boolean {
  const h = typeof location === "undefined" ? "" : location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "";
}

function withLocalRow(list: ServerEntry[]): ServerEntry[] {
  if (!servedLocally()) return list;
  const dev = DEV_FALLBACK[0];
  return list.some((e) => e.url === dev.url) ? list : [dev, ...list];
}

function isEntry(v: unknown): v is ServerEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.name === "string" && typeof e.url === "string"
    && /^wss?:\/\//.test(e.url);
}

export async function loadServers(): Promise<ServerEntry[]> {
  try {
    const res = await fetch(LIST_URL, { cache: "no-store" });
    if (!res.ok) return DEV_FALLBACK;
    const raw: unknown = await res.json();
    const list = Array.isArray(raw) ? raw
      : Array.isArray((raw as { servers?: unknown })?.servers)
        ? (raw as { servers: unknown[] }).servers : [];
    const ok = list.filter(isEntry);
    return ok.length ? withLocalRow(ok) : DEV_FALLBACK;
  } catch {
    return DEV_FALLBACK;
  }
}

export function infoUrl(wsUrl: string): string {
  const http = wsUrl.replace(/^ws/, "http");
  return `${http.replace(/\/+$/, "")}/info`;
}

export async function probeServer(
  entry: ServerEntry, timeoutMs = 4000,
): Promise<ServerRow> {
  const first = await probeOnce(entry, timeoutMs);
  if (!first.info || first.error) return first;
  const second = await probeOnce(entry, timeoutMs);
  if (!second.info) return first;
  return { ...second, ping: Math.min(first.ping, second.ping) };
}

async function probeOnce(
  entry: ServerEntry, timeoutMs: number,
): Promise<ServerRow> {
  const started = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(infoUrl(entry.url), {
      cache: "no-store", signal: ctl.signal,
    });
    if (!res.ok) {
      return { entry, info: null, ping: -1, error: `HTTP ${res.status}` };
    }
    const info = await res.json() as ServerInfo;
    const ping = Math.round(performance.now() - started);
    if (info?.protocol !== PROTOCOL_VERSION) {
      return {
        entry, info, ping,
        error: `protocol ${info?.protocol ?? "?"}, need ${PROTOCOL_VERSION}`,
      };
    }
    return { entry, info, ping, error: "" };
  } catch (e) {
    const why = (e as { name?: string })?.name === "AbortError"
      ? "timed out" : "offline";
    return { entry, info: null, ping: -1, error: why };
  } finally {
    clearTimeout(timer);
  }
}
