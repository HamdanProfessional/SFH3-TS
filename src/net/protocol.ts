import { LABELS } from "../game/unitLabels";

export const PROTOCOL_VERSION = 6;

export const TICK_HZ = 30;

export const EDGE = {
  JUMP: 1 << 0,
  RELOAD: 1 << 1,
  SWAP: 1 << 2,
  STREAK: 1 << 3,
  MDOWN: 1 << 4,
  MUP: 1 << 5,
} as const;

export interface NetInput {
  keys: number;
  edges: number;
  aimX: number;
  aimY: number;
  seq: number;
}

export const YF = {
  JUMPING: 1 << 0,
  CROUCHING: 1 << 1,
  LAND_HARD: 1 << 2,
  JUMP_CLIMB: 1 << 3,
  PARACHUTE: 1 << 4,
  NO_SIM: 1 << 5,
  SPAWN: 1 << 6,
} as const;

export interface YouState {
  t: number;
  q: number;
  x: number;
  y: number;
  xVel: number;
  yVel: number;
  fl: number;
  ft: number;
  cl: number;
  cs: number;
}

export const UF = {
  VISIBLE: 1 << 0,
  DEAD: 1 << 1,
  HUMAN: 1 << 2,
  JUG: 1 << 3,
  FLAG: 1 << 4,
  FACE_LEFT: 1 << 5,
  STREAK_ON: 1 << 6,
  GUNS_VIS: 1 << 7,
} as const;

export const UR = {
  X: 0, Y: 1, FLAGS: 2, ANIM: 3, FRAME: 4, ALPHA: 5,
  HP: 6, HP_MAX: 7, AR: 8, AR_MAX: 9,
  AIM_X: 10, AIM_Y: 11,
  TEAM: 12, PSCORE: 13, KILLS: 14, DEATHS: 15,
  ROT_ARM: 16, ROT_RELOAD: 17,
  ARM1: 18, ARM2: 19,
  AMMO: 20, SPARE: 21,
  STREAK: 22,
  RESPAWN: 23,
} as const;

export const ANIM_IDS: readonly string[] = Object.keys(LABELS);

export const EV = {
  FX: 0,
  FX_FRAME: 1,
  PARTICLE: 2,
  SOUND: 3,
  PAINT: 4,
  KILL: 5,
  FEED: 6,
  GUN: 7,
  HERO: 8,
  SAY: 9,
  SCALE: 10,
} as const;

export const OBJ_STRIDE = { HOLD: 2, FLAG: 2, PICKUP: 1 } as const;

export const LINE_OP = { STYLE: 0, MOVE: 1, LINE: 2, CURVE: 3 } as const;

export interface DeviceRow {
  kind: string;
  x: number;
  y: number;
  frame: number;
  headFrame: number;
  rot: number;
  healthBar: { min: number; max: number; cur: number };
  hpBarDist: number;
  ownerName: string;
  ownerLevel: number;
  healthColor: number;
}

export interface Snapshot {
  t: number;
  started: boolean;
  ended: boolean;
  units: number[][];
  devices: DeviceRow[];
  ev: unknown[][];
  lines: number[];
  obj: number[];
  s1: number;
  s2: number;
}

export interface MatchConfig {
  map: string;
  mode: string;
  score: number;
  mod: string;
  bots: number;
  botLevel: number;
  timeLimit: number;
  mission?: number;
  extra?: Record<string, unknown>;
  cmap?: string;
}

export type RoomKind = "normal" | "coop" | "ranked" | "clanwar" | "custom";

export type RoomPhase = "lobby" | "loading" | "live" | "over";

export interface PlayerView {
  id: string;
  name: string;
  team: number;
  ready: boolean;
  slot: number;
  ping: number;
  kills: number;
  deaths: number;
  acct: boolean;
  spec: boolean;
  clan: string;
  away: boolean;
  rank?: string;
  tier?: string;
  vote?: number;
}

export interface MapVote {
  maps: string[];
  modes?: string[];
  votes: number[];
}

export interface CoopView {
  mission: number;
  title: string;
  desc: string;
  diff: number;
  host: string;
  count: number;
  open: number[];
  cleared: boolean;
  bonus: number;
}

export interface CustomView {
  host: string;
  id: string;
  name: string;
  author: string;
  private: boolean;
  code: string;
}

export interface RoomView {
  name: string;
  phase: RoomPhase;
  cfg: MatchConfig;
  players: PlayerView[];
  maxPlayers: number;
  countdown: number;
  maxSpectators: number;
  coop?: CoopView;
  kind: RoomKind;
  wait?: string;
  war?: { a: string; b: string };
  season?: string;
  custom?: CustomView;
  vote?: MapVote;
}

export interface UnitSlot {
  i: number;
  owner: string | null;
  name: string;
  team: number;
  info: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface ServerInfo {
  ok: true;
  protocol: number;
  name: string;
  phase: RoomPhase;
  map: string;
  mode: string;
  players: number;
  maxPlayers: number;
  bots: number;
  spectators: number;
  coop: boolean;
  kind: RoomKind;
  private: boolean;
  rating?: number;
  custom?: string;
}

export const MAX_SQUAD = 5;

export const ONLINE_MAX_HEROES = 15;

export interface AccountStats {
  rounds: number;
  wins: number;
  kills: number;
  deaths: number;
}

export interface AccountProfile {
  heroes: Record<string, unknown>[];
  squad: number[];
  seeded: boolean;
  stats: AccountStats;
}

export interface AccountReply {
  ok: true;
  name: string;
  token?: string;
  profile: AccountProfile;
}

export interface ClanMember extends AccountStats {
  name: string;
  owner: boolean;
}

export interface ClanView {
  tag: string;
  name: string;
  owner: string;
  code: string;
  created: number;
  members: ClanMember[];
  totals: AccountStats;
  warWins: number;
  warLosses: number;
  warDraws: number;
}

export interface ClanRow extends AccountStats {
  tag: string;
  name: string;
  members: number;
  warWins: number;
  warLosses: number;
  warDraws: number;
}

export interface ClanReply {
  ok: true;
  clan: ClanView | null;
}

export interface ClanTopReply {
  ok: true;
  clans: ClanRow[];
}

export interface RankedRow {
  name: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
  tier: string;
}

export interface RankedMe {
  ok: true;
  season: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
  rank: string;
  tier: string;
  history: (Omit<RankedRow, "name"> & { season: string })[];
}

export interface RankedTopReply {
  ok: true;
  season: string;
  rows: RankedRow[];
}

export interface FriendRow {
  name: string;
  online: boolean;
  room: string;
  code: string;
}

export interface FriendsReply {
  ok: true;
  friends: FriendRow[];
  incoming: string[];
  outgoing: string[];
}

export interface ProfileMatch {
  at: number;
  room: string;
  kind: RoomKind;
  mode: string;
  map: string;
  won: number;
  kills: number;
  deaths: number;
  exp: number;
  rating?: number;
}

export interface ProfileReply {
  ok: true;
  name: string;
  since: number;
  clan: string;
  stats: AccountStats;
  ranked: { season: string; rating: number; games: number; wins: number; peak: number;
    rank: string; tier: string } | null;
  weapons: { id: string; kills: number }[];
  heroes: { name: string; cls: string; level: number }[];
  history: ProfileMatch[];
}

export interface EarnedRow {
  name: string;
  exp: number;
  from: number;
  to: number;
}

export type ClientMsg =
  | { t: "hello"; protocol: number; name: string; token?: string;
      squad: Record<string, unknown>[]; spectate?: boolean;
      resume?: string;
      code?: string }
  | { t: "input"; k: number; e: number; ax: number; ay: number; q: number }
  | { t: "team"; n: number }
  | { t: "ready"; v: boolean }
  | { t: "chat"; m: string }
  | { t: "pong"; n: number }
  | { t: "hero"; n: number }
  | { t: "spectate"; v: boolean }
  | { t: "mission"; n: number; d: number }
  | { t: "leave" }
  | { t: "cmap"; id: string; mode: string }
  | { t: "private"; v: boolean }
  | { t: "vote"; n: number };

export type ServerMsg
  = { t: "welcome"; you: string; room: RoomView;
      resume: string }
  | { t: "room"; room: RoomView }
  | { t: "start"; cfg: MatchConfig; slots: UnitSlot[]; you: number;
      resume?: boolean }
  | { t: "snap"; s: Snapshot }
  | { t: "you"; y: YouState }
  | { t: "end"; winner: number; s1: number; s2: number; ranOut: boolean }
  | { t: "chat"; from: string; m: string }
  | { t: "ping"; n: number }
  | { t: "bye"; why: string }
  | { t: "squad"; heroes: Record<string, unknown>[]; active: number; next: number }
  | { t: "earned"; rows: EarnedRow[]; stats: AccountStats;
      bonus?: number; first?: boolean }
  | { t: "rating"; from: number; to: number; rank: string; season: string };
