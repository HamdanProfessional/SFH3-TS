import { account } from "../net/account";
import { loadServers } from "../net/servers";
import { sanitiseMap, toWire, type CustomMap, type MapWire } from "./format";

const KEY = "sfh3.maps";
export const MAX_LOCAL = 40;

export interface LocalEntry {
  id: string;
  name: string;
  updated: number;
  shared?: string;
  map: MapWire;
}

function readAll(): LocalEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is LocalEntry =>
      !!e && typeof e === "object" && typeof (e as LocalEntry).id === "string"
      && !!(e as LocalEntry).map);
  } catch {
    return [];
  }
}

function writeAll(list: LocalEntry[]): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return null;
  } catch {
    return "Could not save: browser storage is full or disabled.";
  }
}

export function listLocal(): LocalEntry[] {
  return readAll().sort((a, b) => b.updated - a.updated);
}

export function loadLocal(id: string): { entry: LocalEntry; map: CustomMap } | null {
  const entry = readAll().find((e) => e.id === id);
  const map = entry ? sanitiseMap(entry.map) : null;
  return entry && map ? { entry, map } : null;
}

export function saveLocal(id: string | null, m: CustomMap, shared?: string):
  { id: string } | { error: string } {
  const list = readAll();
  let entry = id ? list.find((e) => e.id === id) : undefined;
  if (!entry) {
    if (list.length >= MAX_LOCAL) return { error: `At most ${MAX_LOCAL} maps: delete one first.` };
    entry = { id: `l${Date.now().toString(36)}`, name: m.name, updated: 0, map: toWire(m) };
    list.push(entry);
  }
  entry.name = m.name;
  entry.updated = Date.now();
  entry.map = toWire(m);
  if (shared) entry.shared = shared;
  const err = writeAll(list);
  return err ? { error: err } : { id: entry.id };
}

export function deleteLocal(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id));
}

async function mapsBase(): Promise<string> {
  const a = account();
  if (a) return a.base.replace(/\/account$/, "/maps");
  const list = await loadServers();
  const first = list[0];
  if (!first) throw new Error("No server to fetch maps from");
  return `${first.url.replace(/^ws/, "http").replace(/\/+$/, "")}/maps`;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const base = await mapsBase();
  const a = account();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (a) headers.Authorization = `Bearer ${a.token}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach the server");
  }
  let json: { ok?: boolean; error?: string } = {};
  try { json = await res.json(); } catch {}
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

export function shareLink(id: string): string {
  const here = typeof location === "undefined" ? "" : `${location.origin}${location.pathname}`;
  return `${here}#cmap=${encodeURIComponent(id)}`;
}

export async function uploadMap(m: CustomMap): Promise<string> {
  if (!account()) throw new Error("Sign in (Multiplayer page) to share maps");
  const r = await call<{ id: string }>("", { map: toWire(m) });
  return r.id;
}

export interface SharedMap { id: string; author: string; map: CustomMap }

export async function fetchShared(id: string): Promise<SharedMap> {
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(id)) throw new Error("That is not a map link");
  const r = await call<{ id: string; author: string; map: unknown }>(`/${id}`);
  const map = sanitiseMap(r.map);
  if (!map) throw new Error("The server sent a map this version cannot read");
  return { id: r.id, author: String(r.author ?? ""), map };
}

export interface SharedRow { id: string; name: string; created: number }

export async function myShared(): Promise<SharedRow[]> {
  if (!account()) return [];
  const r = await call<{ maps: SharedRow[] }>("?mine=1");
  return Array.isArray(r.maps) ? r.maps : [];
}

export type BrowseSort = "new" | "top" | "week";

export interface MapThumb { w: number; h: number; cells: string }

export interface BrowseRow {
  id: string;
  name: string;
  author: string;
  created: number;
  w: number;
  h: number;
  plays: number;
  up: number;
  down: number;
  mine: number;
  thumb: MapThumb;
}

export interface MapVotes { plays: number; up: number; down: number; mine: number }

export async function browseShared(sort: BrowseSort, q: string, page: number, per: number):
  Promise<{ rows: BrowseRow[]; more: boolean }> {
  const qs = new URLSearchParams({ sort, page: String(page), n: String(per) });
  if (q) qs.set("q", q);
  const r = await call<{ maps?: BrowseRow[]; more?: boolean }>(`?${qs.toString()}`);
  const rows = (Array.isArray(r.maps) ? r.maps : []).filter((m) =>
    !!m && typeof m.id === "string" && !!m.thumb && typeof m.thumb.cells === "string");
  return { rows, more: !!r.more };
}

export function reportPlay(id: string): void {
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(id)) return;
  void call(`/${id}/play`, {}).catch(() => undefined);
}

export async function rateShared(id: string, vote: 1 | -1 | 0): Promise<MapVotes> {
  if (!account()) throw new Error("Sign in (Multiplayer page) to rate maps");
  const r = await call<Partial<MapVotes>>(`/${id}/rate`, { vote });
  return {
    plays: Number(r.plays) || 0, up: Number(r.up) || 0,
    down: Number(r.down) || 0, mine: Number(r.mine) || 0,
  };
}
