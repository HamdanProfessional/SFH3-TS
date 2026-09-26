import type { GunStats } from "../data/StatsGuns";
import type { Unit, SpawnNodeLike } from "./Unit";
import type { NodePickup, NodeHoldpoint, NodeCtfFlag } from "./Arena";
import type { Bullet } from "./bullets/Bullet";

export interface WallMask {
  readonly width: number;
  readonly height: number;
  getPixel32(x: number, y: number): number;
}

export function emptyWall(width = 4000, height = 2000): WallMask {
  return { width, height, getPixel32: () => 0 };
}

export interface ArenaLike {
  x: number;
  y: number;
  readonly wall: WallMask;
  readonly pickups?: readonly NodePickup[];
  readonly holdpoints?: readonly NodeHoldpoint[];
  readonly ctfflags?: readonly NodeCtfFlag[];
  spawnsFor?(team: number): readonly SpawnNodeLike[];
  setShake(mag: number, time: number): void;
  setFocus?(unit: unknown, intensity: number): void;
}

export interface BitScreenLike {
  paint(
    x: number,
    y: number,
    over: boolean,
    name: string,
    frameLabel?: string,
    frame?: number,
  ): void;
}

export interface LineSink {
  lineStyle(thickness: number, color: number, alpha: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  curveTo(cx: number, cy: number, x: number, y: number): void;
}

export interface HudLike {
  setHealth(cur: number, max: number): void;
  setArmor(cur: number, max: number): void;
  setBloodyScreen(alpha: number): void;
  resetBloodyScreen(scaleX: number, scaleY: number, frame: number): void;
  addKillFeed(killer: Unit | null, victim: Unit, weaponId: string, extra: HitExtra): void;
  addCustomFeed(unit: Unit, text: string): void;
  setDebug(slot: number, text: string): void;
  setKillstreakNum?(amt: number, streakVal: number): void;
  setStreakReady?(name: string): void;
  clearStreak?(): void;
  setStreakInProgress?(label?: boolean): void;
  addKillstreakFeed?(user: Unit, streakName: string): void;
  setAmmoCount?(gun: GunStats): void;
  setGuns?(cur: GunStats, next?: GunStats): void;
  setRespawnText?(text: string, color?: number): void;
  setPlayerInfo?(displayName: string, level: number): void;
}

export interface CorpseLike {
  readonly x: number;
  readonly y: number;
}

export interface PhysWorldLike {
  readonly actors: CorpseLike[];
  createCorpse(
    unit: Unit, shooter: Unit | null, weapon: GunLike, extra: HitExtra,
  ): CorpseLike | null;
  hitCorpse(corpse: CorpseLike, shooter: Unit, weapon: GunLike, extra: HitExtra): void;
}

export interface GunHolderLike {
  makeBullet(stats: GunLike): void;
  readonly curFrame: string;
  EnterFrame(): void;
  reloadOther?(): void;
  addAmmo?(n: number): void;
}

export interface KillstreakLike {
  x: number;
  y: number;
  shootable: boolean;
  readonly unit: Unit;
  damage(amt: number, shooter: Unit, weapon: GunLike, extra: HitExtra): void;
  EnterFrame(): void;
}

export interface HitExtra {
  headMult?: number;
  critMult?: boolean;
  splashMult?: number;
  teamkill?: boolean;
  rot?: number;
  x?: number;
  y?: number;
}

export interface GunLike {
  id: string;
  type: number;
  dmg: number;
  range: number;
  yOff: number;
  effShoot: string;
  force: number;
  bodBreak: number;
  splash: number;
  splashMult: number;
  crit: number;
  critDmg: number;
  headDmg: number;
  noHead: boolean;
  noCrit: boolean;
  noBlood: boolean;
  selfDmg: number;
  isExplosive: boolean;
  isMelee: boolean;
  isTurret: boolean;
  fire: number;
  ice: number;
  acid: number;
  zap: number;
  crap: number;
  reflectFrames: number;
  effHit: string;
  hitSound: string | null;
  cls: string | null;
  params: readonly unknown[] | null;
  extra: Readonly<Record<string, unknown>>;
}

export interface AimerLike {
  x: number;
  y: number;
}

export type FilterSpec =
  | {
      kind: "glow";
      color: number;
      alpha: number;
      blurX: number;
      blurY: number;
      strength: number;
      quality?: number;
      inner?: boolean;
      knockout?: boolean;
    }
  | { kind: "blur"; blurX: number; blurY: number; quality: number };

export interface GameLike {
  gameStarted: boolean;
  gameEnded: boolean;
  beamDelay: number;
  readonly arena: ArenaLike;
  readonly hud: HudLike;
  readonly bitscreen: BitScreenLike;
  readonly lineCont: LineSink;
  readonly physWorld: PhysWorldLike;
  readonly aimer: AimerLike;
  readonly units: Unit[];
  readonly bullets: Bullet[];
  readonly killstreaks: KillstreakLike[];
  player: Unit | null;
  readonly enemyAmt?: number;
  readonly enemyLvlAvg?: number;
  createEffect(x: number, y: number, name: string, rot?: number, scale?: number): void;
  createEffectAtFrame(
    x: number, y: number, name: string, sub: string, frame: number,
  ): void;
  createParticle(
    x: number,
    y: number,
    type: string,
    rot?: number,
    data?: Record<string, number> | null,
    style?: string,
    text?: string,
    frame?: number,
  ): void;
  playScreenSound(name: string, x: number, y: number): void;
  addBullet(b: Bullet): void;
}

export const MatchInfo: {
  matchType: number;
  useMode: string;
  useScore: number;
  useMod: string;
  useExtra: Record<string, number | boolean>;
  updateScores: () => void;
} = {
  matchType: 0,
  useMode: "dm",
  useScore: 0,
  useMod: "",
  useExtra: {},
  updateScores: () => {},
};

export function createHeadlessGame(wall: WallMask = emptyWall()): GameLike {
  const noop = (): void => {};
  return {
    gameStarted: true,
    gameEnded: false,
    beamDelay: 0,
    arena: { x: 0, y: 0, wall, setShake: noop },
    hud: {
      setHealth: noop,
      setArmor: noop,
      setBloodyScreen: noop,
      resetBloodyScreen: noop,
      addKillFeed: noop,
      addCustomFeed: noop,
      setDebug: noop,
    },
    bitscreen: { paint: noop },
    lineCont: { lineStyle: noop, moveTo: noop, lineTo: noop, curveTo: noop },
    physWorld: { actors: [], createCorpse: () => null, hitCorpse: noop },
    aimer: { x: 0, y: 0 },
    units: [],
    bullets: [],
    killstreaks: [],
    player: null,
    createEffect: noop,
    createEffectAtFrame: noop,
    createParticle: noop,
    playScreenSound: noop,
    addBullet(b) {
      this.bullets.push(b);
    },
  };
}

export const assertGunStatsCompatible = (g: GunStats): GunLike => g;
