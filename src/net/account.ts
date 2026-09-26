import type {
  AccountProfile, AccountReply, ClanReply, ClanRow, ClanTopReply, ClanView,
  FriendsReply, ProfileReply, RankedMe, RankedTopReply,
} from "./protocol";

const KEY = "sfh3.account";

export interface SignedIn {
  name: string;
  token: string;
  base: string;
  profile: AccountProfile | null;
}

let current: SignedIn | null = load();
let version = 0;

function load(): SignedIn | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as
      Partial<SignedIn> | null;
    if (!raw || typeof raw.token !== "string" || typeof raw.base !== "string") return null;
    return { name: String(raw.name ?? ""), token: raw.token, base: raw.base, profile: null };
  } catch {
    return null;
  }
}

function save(): void {
  version++;
  try {
    if (typeof localStorage === "undefined") return;
    if (!current) localStorage.removeItem(KEY);
    else {
      localStorage.setItem(KEY, JSON.stringify({
        name: current.name, token: current.token, base: current.base,
      }));
    }
  } catch {}
}

export function account(): SignedIn | null {
  return current;
}

export function accountVersion(): number {
  return version;
}

export function accountBase(wsUrl: string): string {
  return `${wsUrl.replace(/^ws/, "http").replace(/\/+$/, "")}/account`;
}

export class AccountFailure extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T = AccountReply>(
  base: string, path: string, body?: unknown, token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new AccountFailure(0, "Could not reach the server");
  }
  let json: { ok?: boolean; error?: string } = {};
  try { json = await res.json(); } catch {}
  if (!res.ok || !json.ok) {
    throw new AccountFailure(res.status, json.error || `HTTP ${res.status}`);
  }
  return json as T;
}

function adopt(base: string, r: AccountReply): SignedIn {
  current = {
    name: r.name,
    token: r.token ?? current?.token ?? "",
    base,
    profile: r.profile,
  };
  save();
  return current;
}

export async function register(base: string, name: string, password: string): Promise<SignedIn> {
  return adopt(base, await call(base, "/register", { name, password }));
}

export async function signIn(base: string, name: string, password: string): Promise<SignedIn> {
  return adopt(base, await call(base, "/login", { name, password }));
}

export async function signOut(everywhere = false): Promise<void> {
  const was = current;
  current = null;
  myClan = undefined;
  myFriends = null;
  save();
  if (everywhere && was) {
    try { await call(was.base, "/logout-all", {}, was.token); } catch {}
  }
}

export async function refresh(): Promise<SignedIn | null> {
  const a = current;
  if (!a) return null;
  try {
    return adopt(a.base, await call(a.base, "", undefined, a.token));
  } catch (e) {
    if (e instanceof AccountFailure && e.status === 401) await signOut();
    throw e;
  }
}

export async function seed(
  heroes: Record<string, unknown>[], squad: number[],
): Promise<SignedIn> {
  const a = current;
  if (!a) throw new AccountFailure(401, "Not signed in");
  return adopt(a.base, await call(a.base, "/seed", { heroes, squad }, a.token));
}

export async function setSquad(squad: number[]): Promise<SignedIn> {
  const a = current;
  if (!a) throw new AccountFailure(401, "Not signed in");
  return adopt(a.base, await call(a.base, "/squad", { squad }, a.token));
}

let myClan: ClanView | null | undefined;

export function clan(): ClanView | null | undefined {
  return current ? myClan : null;
}

async function clanCall(path: string, body?: unknown): Promise<ClanView | null> {
  const a = current;
  if (!a) throw new AccountFailure(401, "Not signed in");
  const r = await call<ClanReply>(a.base, path, body, a.token);
  myClan = r.clan;
  version++;
  return myClan;
}

export function refreshClan(): Promise<ClanView | null> { return clanCall("/clan"); }
export function createClan(tag: string, name: string): Promise<ClanView | null> {
  return clanCall("/clan/create", { tag, name });
}
export function joinClan(code: string): Promise<ClanView | null> {
  return clanCall("/clan/join", { code });
}
export function leaveClan(): Promise<ClanView | null> { return clanCall("/clan/leave", {}); }
export function kickFromClan(name: string): Promise<ClanView | null> {
  return clanCall("/clan/kick", { name });
}
export function newClanCode(): Promise<ClanView | null> { return clanCall("/clan/code", {}); }

export async function topClans(base: string): Promise<ClanRow[]> {
  return (await call<ClanTopReply>(base, "/clans/top")).clans;
}

export async function myRanked(): Promise<RankedMe> {
  const a = current;
  if (!a) throw new AccountFailure(401, "Not signed in");
  return call<RankedMe>(a.base, "/ranked", undefined, a.token);
}

export async function topRanked(base: string, season = ""): Promise<RankedTopReply> {
  return call<RankedTopReply>(base, `/ranked/top${season ? `?season=${encodeURIComponent(season)}` : ""}`);
}

export async function profileOf(base: string, name: string): Promise<ProfileReply> {
  return call<ProfileReply>(base, `/profile?name=${encodeURIComponent(name)}`);
}

let myFriends: FriendsReply | null = null;

export function friends(): FriendsReply | null {
  return current ? myFriends : null;
}

async function friendCall(path: string, body?: unknown): Promise<FriendsReply> {
  const a = current;
  if (!a) throw new AccountFailure(401, "Not signed in");
  myFriends = await call<FriendsReply>(a.base, path, body, a.token);
  version++;
  return myFriends;
}

export function refreshFriends(): Promise<FriendsReply> { return friendCall("/friends"); }
export function addFriend(name: string): Promise<FriendsReply> {
  return friendCall("/friends/add", { name });
}
export function acceptFriend(name: string): Promise<FriendsReply> {
  return friendCall("/friends/accept", { name });
}
export function declineFriend(name: string): Promise<FriendsReply> {
  return friendCall("/friends/decline", { name });
}
export function removeFriend(name: string): Promise<FriendsReply> {
  return friendCall("/friends/remove", { name });
}
