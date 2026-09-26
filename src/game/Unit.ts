import { UT } from "../core/UT";
import * as Classes from "../data/StatsClasses";
import * as Perks from "../data/StatsPerks";
import { getDamageAtLevel, itemOb as gunOb } from "../data/StatsGuns";
import { getGunGameWeapon, getMod } from "../data/StatsMisc";
import { NodeCtfFlag, NodeHoldpoint, NodePickup, type NodeWaypoint } from "./Arena";
import { Guns } from "./Guns";
import { GunInfo } from "./GunInfo";
import { MatchSettings } from "./MatchSettings";
import { SD } from "../state/SD";
import { fixRotation, getRotation, inBox } from "./Geom";
import { Movement } from "./Movement";
import { Score } from "./Score";
import { Status } from "./Status";
import { UnitAnim, armRotationOf, headRotationOf } from "./UnitAnim";
import { MatchInfo } from "./types";
import { combatHooks } from "./combatHooks";
import type { UnitInfo } from "./UnitInfo";
import type {
  CorpseLike,
  FilterSpec,
  GameLike,
  GunLike,
  HitExtra,
  KillstreakLike,
} from "./types";

export type { CorpseLike } from "./types";

export interface SpawnNodeLike {
  x: number;
  y: number;
  initialSpawned: boolean;
  waypoint?: NodeWaypoint | null;
}

export interface UnitBrain {
  spawn(x?: number, y?: number, node?: string, showRope?: boolean): void;
  setAiSpawnNode(node: SpawnNodeLike): void;
  setSpawnWaypointId(id: string): void;
}

export type KillstreakFactory = (
  game: GameLike,
  owner: Unit,
  frames: number,
  kind: "turret" | "sentry",
) => KillstreakLike | null;

let killstreakFactory: KillstreakFactory = () => null;
export function setKillstreakFactory(fn: KillstreakFactory): void {
  killstreakFactory = fn;
}

export interface GunGameTeams {
  readonly team1: readonly Unit[];
  readonly team2: readonly Unit[];
  readonly team1score: number;
  readonly team2score: number;
}

let gunGameTeams: () => GunGameTeams | null = () => null;
export function setGunGameTeams(fn: () => GunGameTeams | null): void {
  gunGameTeams = fn;
}

const achHook = (id: string, amt: number): void => combatHooks.unit(id, amt);

const DEV_STREAKS = [
  "armor", "rockettur", "dualtur", "heal", "critboost", "rofboost",
  "akimbo", "aimbot", "wallhack", "mirror", "element",
] as const;
export function setUnitAchHook(fn: (id: string, amt: number) => void): void {
  combatHooks.unit = fn;
}

export class Unit {
  readonly UP = 1;
  readonly DOWN = 2;
  readonly LEFT = 4;
  readonly RIGHT = 8;
  keys = 0;
  mDown = false;

  x = 0;
  y = 0;
  alpha = 1;
  mcAlpha = 1;
  visible = true;

  readonly game: GameLike;
  unitInfo: UnitInfo;

  human = false;
  focused = false;
  charSelect = false;
  team = 0;
  diff = 0;
  odiff = 0;
  pscore = 0;

  plateColor = 0xffffff;

  canRotate = false;
  dead: CorpseLike | null = null;
  private firstSpawn = true;
  respawnTimer = 0;
  streakInProgress = 0;
  loudness = 100;
  hasFlag: NodeCtfFlag | null = null;
  isJug = false;
  onPoint = false;
  capturing = false;
  defendingFlag = false;

  flip = false;
  aimX = 0;
  aimY = 0;
  aimRoation = 0;
  rotArm = 0;
  rotReload = 0;

  readonly mov: Movement;
  readonly status: Status;
  readonly score: Score;
  readonly MC: UnitAnim;
  gun: Guns;
  target: Unit | null = null;

  MCfilters: FilterSpec[] = [];
  MCfiltersApplied: FilterSpec[] = [];
  scale = 1;
  oscale = 1;
  nextAnim = "idle";
  surface = "";
  constAnim = "";
  streak: Perks.Perk;
  private fc = 0;

  constructor(game: GameLike, unitInfo: UnitInfo) {
    this.game = game;
    this.unitInfo = unitInfo;
    this.streak = Perks.itemOb[unitInfo.streak] ?? Perks.itemOb["none"] ?? EMPTY_PERK;

    this.loudness = 100;
    if (unitInfo.skills.detect1) this.loudness *= unitInfo.skills.detect1;
    if (unitInfo.skills.detect0) this.loudness *= unitInfo.skills.detect0;

    this.MC = new UnitAnim(this);
    this.oscale = Classes.itemOb[unitInfo.cls]?.size ?? 1;
    if (unitInfo.extra.scale) this.oscale += Number(unitInfo.extra.scale);
    this.scale = this.oscale;

    this.mov = new Movement(this);
    this.status = new Status(this);
    this.score = new Score(this);
    const guns = new Guns(this);
    guns.setGuns(unitInfo.primary as GunInfo | null, unitInfo.secondary as GunInfo | null);
    guns.reset();
    this.gun = guns;
    this.team = unitInfo.team;
    if (unitInfo.extra.kills) this.score.setKills(Number(unitInfo.extra.kills));
    this.MCfilters = [];
    this.setBarColour();
    if (MatchInfo.useMode === "gg" || MatchInfo.useMode === "tgg") {
      this.setGunGameWeapon(true);
    }
    if (MatchInfo.useMode === "one" && !this.isJug) this.changeTeam(1);
  }

  adoptHero(info: UnitInfo): void {
    if (this.streakInProgress) {
      this.streakInProgress = 0;
      this.endKillstreak();
    }
    this.unitInfo = info;
    this.streak = Perks.itemOb[info.streak] ?? Perks.itemOb["none"] ?? EMPTY_PERK;
    this.loudness = 100;
    if (info.skills.detect1) this.loudness *= info.skills.detect1;
    if (info.skills.detect0) this.loudness *= info.skills.detect0;
    this.oscale = Classes.itemOb[info.cls]?.size ?? 1;
    if (info.extra.scale) this.oscale += Number(info.extra.scale);
    this.scale = this.oscale;
    const guns = this.gun as Guns;
    guns.setGuns(info.primary as GunInfo | null, info.secondary as GunInfo | null);
    guns.reset();
    if (MatchInfo.useMode === "gg" || MatchInfo.useMode === "tgg") {
      this.setGunGameWeapon(true);
    }
    this.setBarColour();
  }

  changeTeam(teamNum: number): void {
    this.team = teamNum;
    this.setBarColour();
  }

  setBarColour(): void {
    switch (this.team) {
      case 0:
        this.status.healthColor = this.human ? 0xffcc00 : 0xffffff;
        this.plateColor = this.status.healthColor;
        break;
      case 1:
        this.status.healthColor = this.human ? 0x0099ff : 0x00ffff;
        this.plateColor = 0x00ffff;
        break;
      case 2:
        this.status.healthColor = 0xff9900;
        this.plateColor = this.status.healthColor;
        break;
      default:
        break;
    }
  }

  spawn(x = 0, y = 0, node = "", showRope = true): void {
    if (this.human) this.game.hud.setRespawnText?.("");
    if (this.brain) this.brain.spawn(x, y, node, showRope);
    else this.unitSpawn(x, y, node, showRope);
  }

  brain: UnitBrain | null = null;

  unitSpawn(x: number, y: number, node: string, showRope: boolean): void {
    const extra = this.unitInfo.extra;
    if (extra.noSpawn) extra.noSpawn = false;
    if (extra.noRope) {
      showRope = false;
      extra.noRope = false;
    }
    this.mov.reset();
    this.status.reset();
    this.MC.prepareSpawn(showRope);
    const g = this.gun as Guns | null;
    g?.reset();
    this.dead = null;
    this.visible = true;
    if (x && y && node) {
      if (!this.human) this.brain?.setSpawnWaypointId(node);
      this.x = x;
      this.y = y;
    } else {
      const curSpawn = this.getSpawnNode();
      if (curSpawn) {
        this.brain?.setAiSpawnNode(curSpawn);
        this.x = curSpawn.x + UT.rand(-5, 5);
        this.y = curSpawn.y;
      }
    }
    this.MC.rotation = 0;
    if (extra.permaStreak) this.useKillstreak(String(extra.permaStreak));
  }

  private spawnNodes: SpawnNodeLike[] = [];
  private teamSpawnNodes: Record<number, SpawnNodeLike[]> = {};

  setSpawnNodes(all: SpawnNodeLike[], perTeam: Record<number, SpawnNodeLike[]> = {}): void {
    this.spawnNodes = all;
    this.teamSpawnNodes = perTeam;
  }

  protected getSpawnNode(): SpawnNodeLike | null {
    const useTeam =
      (MatchInfo.useMode === "ctf" && this.team) || this.unitInfo.extra.teamSpawn;
    const ar = useTeam
      ? (this.teamSpawnNodes[this.team] ?? this.game.arena.spawnsFor?.(this.team) ?? [])
      : (this.spawnNodes.length ? this.spawnNodes : (this.game.arena.spawnsFor?.(0) ?? []));
    if (!ar.length) return null;
    if (this.firstSpawn) {
      let node: SpawnNodeLike = UT.randEl(ar);
      for (let tries = 0; node.initialSpawned && tries < ar.length * 4; tries++) {
        node = UT.randEl(ar);
      }
      node.initialSpawned = true;
      this.firstSpawn = false;
      return node;
    }
    return UT.randEl(ar);
  }

  die(killer: Unit, weapon: GunLike, extra: HitExtra): void {
    this.dead = this.game.physWorld.createCorpse(this, killer, weapon, extra);
    if (!this.dead) this.dead = { x: this.x, y: this.y };

    if (!this.game.gameEnded) {
      this.game.hud.addKillFeed(killer, this, weapon.id, extra);
      this.score.addDeath();
      if (this === killer) {
        this.score.addSuicide();
        if (this.isJug) this.passJugTo(null);
      } else if (extra.teamkill) {
        this.score.addBetrayal();
      } else {
        if (killer.human) {
          achHook("enemies", 1);
          if (killer.unitInfo.cls === "sni" && extra.headMult) achHook("sni", 1);
          if (killer.unitInfo.cls === "eng" && weapon.isTurret) achHook("eng", 1);
          if (killer.unitInfo.cls === "mer" && killer.streakInProgress) achHook("mer", 1);
          if (
            killer.unitInfo.cls === "eli" &&
            (this.status.sIce || this.status.sZap || this.status.sFire ||
              this.status.sAcid || this.status.sFrozen)
          ) {
            achHook("eli", 1);
          }
          if (killer.unitInfo.cls === "nin" && this.target !== killer) achHook("nin", 1);
        }
        if (killer.unitInfo.skills.gunplay) {
          this.game.createParticle(
            killer.x + UT.rand(-5, 5), killer.y - UT.rand(50, 55),
            "text", 0, null, "bigText", "gunplay",
          );
          killer.gun?.reloadOther?.();
        }
        if (killer.unitInfo.skills.theif) {
          this.game.createParticle(
            killer.x + UT.rand(-5, 5), killer.y - UT.rand(50, 55),
            "text", 0, null, "bigText", "ammo",
          );
          killer.gun?.addAmmo?.(killer.unitInfo.skills.theif);
        }
        killer.score.addKill();
        if (extra.headMult) ++killer.score.headshots;
        if (this.isJug) {
          (extra as Record<string, unknown>).jugKill = true;
          killer.setJug();
        }
        if (this.hasFlag) (extra as Record<string, unknown>).hasFlag = true;
        if (MatchInfo.useExtra.vampire) killer.status.heal(killer.status.hpMax * 0.6, true);

        let useExp = Math.min(
          Classes.getUnitExp(killer.unitInfo.level + 3),
          Classes.getUnitExp(this.unitInfo.level),
        );
        const expMod = MatchInfo.useExtra.expMod;
        if (typeof expMod === "number" && expMod) useExp *= expMod;
        if (MatchInfo.useMod) useExp *= getMod(MatchInfo.useMod).expmod;
        const banked = killer.unitInfo.addExp(useExp);
        if (killer.human) this.displayExp(banked);
        SD.payMatchFunds(killer.unitInfo);
        this.unitInfo.addDeath();
      }
      if (this.constAnim) {
        this.game.createParticle(
          this.x, this.y - 110,
          "move", 0, { xspd: -50, yspd: 0 }, this.constAnim, "animate",
        );
      }
    }
    if (this.hasFlag) {
      this.hasFlag.reset();
      this.hasFlag = null;
    }
    this.visible = false;
    this.respawnTimer = 30 * 5;
    if (this.unitInfo.skills.spawn0) this.respawnTimer += this.unitInfo.skills.spawn0 * 30;
    if (this.unitInfo.skills.spawn1) this.respawnTimer += this.unitInfo.skills.spawn1 * 30;
    if (this.human) {
      this.endKillstreak();
      this.game.aimer.x = -5000;
      this.game.aimer.y = -5000;
    }
  }

  private checkArenaNodes(): void {
    const arena = this.game.arena;

    for (const p of arena.pickups ?? []) {
      if (p.taken) continue;
      if (inBox(this.x, this.y, p.boxX, p.boxY, NodePickup.BOX_W, NodePickup.BOX_H)) {
        this.takePickup(p);
      }
    }

    this.onPoint = false;
    this.capturing = false;
    if (this.game.gameStarted) {
      for (const hp of arena.holdpoints ?? []) {
        if (!inBox(this.x, this.y, hp.boxX, hp.boxY,
          NodeHoldpoint.BOX_W, NodeHoldpoint.BOX_H)) continue;
        this.onPoint = true;
        this.capturing = hp.curTeam !== this.team;
        if (!hp.capture(this.team, this)) continue;
        this.game.hud.addCustomFeed(this, "holdpoint");
        if (this.human) {
          ++this.score.domCap;
          this.payObjectiveExp(0.4);
        }
      }
    }

    for (const flag of arena.ctfflags ?? []) {
      if (!inBox(this.x, this.y, flag.boxX, flag.boxY,
        NodeCtfFlag.BOX_W, NodeCtfFlag.BOX_H)) continue;
      switch (flag.capture(this)) {
        case "taken":
          this.game.playScreenSound("S_Equip", this.x, this.y);
          break;
        case "scored":
          if (this.human) {
            ++this.score.flagCap;
            this.payObjectiveExp(0.7);
          }
          this.game.hud.addCustomFeed(this, "flag");
          ++this.pscore;
          MatchInfo.updateScores();
          this.game.playScreenSound("S_Skill", this.x, this.y);
          break;
        default:
          break;
      }
    }

    if (this.hasFlag) {
      const period = (this.keys & this.LEFT) || (this.keys & this.RIGHT) ? 7 : 20;
      if (this.fc % period === 0) {
        this.game.createEffectAtFrame(
          this.x + UT.rand(-7, 7), this.y - UT.rand(10, 20),
          "paper", "idle" + UT.irand(1, 2), 1,
        );
      }
    }
  }

  private enemyStats(): { amt: number; lvlAvg: number } {
    if (typeof this.game.enemyAmt === "number" &&
        typeof this.game.enemyLvlAvg === "number") {
      return { amt: this.game.enemyAmt, lvlAvg: this.game.enemyLvlAvg };
    }
    let amt = 0;
    let sum = 0;
    for (const u of this.game.units) {
      if (u === this.game.player) continue;
      if (u.team === 0 || u.team === 2) {
        sum += u.unitInfo.level;
        ++amt;
      }
    }
    return { amt, lvlAvg: amt ? Math.floor(sum / amt) : 0 };
  }

  private payObjectiveExp(mult: number): void {
    const { amt, lvlAvg } = this.enemyStats();
    let useExp = Math.min(
      Classes.getUnitExp(this.unitInfo.level + 3),
      Classes.getUnitExp(lvlAvg),
    );
    useExp *= amt * mult;
    const banked = this.unitInfo.addExp(Math.trunc(useExp));
    SD.payMatchFunds(this.unitInfo);
    this.displayExp(banked);
  }

  displayExp(amt: number): void {
    const n = Math.trunc(amt);
    const px = this.x + UT.rand(-5, 5) - 8;
    const py = this.y - UT.rand(55, 60);
    const put = (x: number, frame: number): void =>
      this.game.createParticle(x, py, "slowText", 0, null, "expText", "idle", frame);
    put(px, 11);
    if (n < 10) {
      put(px + 8, n + 1);
    } else {
      put(px + 8, Math.trunc(n * 0.1) + 1);
      put(px + 16, (n % 10) + 1);
    }
  }

  private takePickup(p: NodePickup): void {
    const sk = this.unitInfo.skills;
    const scaled = (amt: number): number => {
      if (sk.pickup1) amt *= sk.pickup1;
      if (sk.pickup0) amt *= sk.pickup0;
      return amt;
    };
    const st = this.status;
    switch (p.id) {
      case "health":
      case "healthbig":
        if (this.human) {
          this.game.playScreenSound("S_Heal", this.x, this.y);
          if (st.hpCur / st.hpMax <= 0.25) achHook("health", 1);
        }
        st.heal(scaled(st.hpMax * (p.id === "health" ? 0.5 : 1)));
        break;
      case "armor":
      case "armorbig":
        if (this.human) {
          this.game.playScreenSound("S_Equip", this.x, this.y);
          if (st.arCur === 0) achHook("armor", 1);
        }
        st.repair(scaled(st.arMax * (p.id === "armor" ? 0.5 : 1)));
        break;
      case "ammo":
      case "ammobig": {
        if (sk.energy) return;
        const g = this.gun.curGun;
        if (this.human) {
          this.game.playScreenSound("S_Ammo", this.x, this.y);
          if (g && g.spareMax && g.spareAmmo / g.spareMax <= 0.25) {
            achHook("ammo", 1);
          }
        }
        this.gun.addAmmo(scaled(p.id === "ammo" ? 0.5 : 1));
        break;
      }
      default:
        break;
    }
    p.markTaken();
  }

  private passJugTo(_hint: Unit | null): void {
    const pool = this.game.units.filter(
      (u) => u !== this && !u.dead && !u.status.sSpawn,
    );
    if (!pool.length) return;
    UT.randEl(pool).setJug();
  }

  setJug(): void {
    for (let i = 0; i < this.game.units.length; i++) {
      const u = this.game.units[i];
      u.changeTeam(1);
      u.isJug = false;
      u.scale = u.oscale;
    }
    this.changeTeam(2);
    this.status.heal(999, false);
    this.game.arena.setShake(10, 10);
    for (let i = 0; i < 20; i++) {
      this.game.createParticle(
        this.x + UT.rand(-10, 10), this.y + UT.rand(-40, 0),
        "spark", 20, { xSpd: UT.rand(-5, 5), ySpd: UT.rand(-8, -3) }, "ember",
      );
    }
    this.game.createEffect(this.x, this.y - 100, "oneManArmy");
    this.isJug = true;
    this.game.hud.addCustomFeed(this, "jug");
    this.scale += 0.3;
  }

  stopFrames(): void {
    this.MC.stop();
    this.MC.arm1.stop();
    this.MC.armPlaying = false;
  }

  playFrames(): void {
    this.MC.play();
    if (this.gun && this.gun.curFrame !== "idle") {
      this.MC.arm1.play();
      this.MC.armPlaying = true;
    }
  }

  simpleTick(): void {
    if (this.unitInfo.extra.noSpawn) return;
    if (this.dead) {
      this.tickDead();
      return;
    }
    this.MCfilters = [];
    if (this.status.sFrozen) {
      this.status.EnterFrame();
      return;
    }
    this.UnitEnterFrame();
  }

  tickDead(): void {
    if (this.respawnTimer <= 0) {
      this.spawn();
      return;
    }
    if (this.human && this.respawnTimer < 3 * 30) {
      this.game.hud.setRespawnText?.(
        `Respawn in ${Math.ceil(this.respawnTimer / 30)}`,
      );
    }
    --this.respawnTimer;
    const corpse = this.dead;
    if (!corpse) return;
    for (let i = 0; i < this.game.units.length; i++) {
      const u = this.game.units[i];
      if (!u.unitInfo.skills.love) continue;
      if (u === this) continue;
      if (u.dead) continue;
      if (!u.team || u.team !== this.team) continue;
      if (UT.getDist(corpse.x, corpse.y, u.x, u.y) < 200) this.respawnTimer += 2;
    }
  }

  unitEnterFrame(): void {
    this.UnitEnterFrame();
  }

  tickArmClips(): void {
    this.MC.tickArms();
  }

  get name(): string {
    return this.unitInfo.name;
  }

  get scaleX(): number {
    return this.flip ? -1 : 1;
  }

  set scaleX(v: number) {
    this.flip = v < 0;
  }

  UnitEnterFrame(): void {
    ++this.fc;
    this.MC.tick();
    if (this.streakInProgress) {
      --this.streakInProgress;
      if (this.streakInProgress === 0) this.endKillstreak();
    }
    const wall = this.game.arena.wall;
    if (this.x < 0 || this.y < 0 || this.x > wall.width || this.y > wall.height) {
      this.status.damage(9999, this, gunOb["env"], {}, true);
    }
    this.status.EnterFrame();
    this.gun?.EnterFrame();
    this.MC.EnterFrame();
    this.mov.resetMods();
    this.applySurface();
    this.mov.EnterFrame();
    this.checkArenaNodes();
    this.MC.goto(this.nextAnim);

    this.flip = this.mov.jumping
      ? this.aimX < this.x
      : fixRotation(this.aimRoation - this.MC.rotation) < 0;

    this.rotArm =
      getRotation(
        this.x + this.MC.armX + this.MC.rotation * 1.2,
        this.y + this.MC.armY,
        this.aimX, this.aimY,
      ) - 90;
    this.aimRoation = fixRotation(this.rotArm + 90);
    if (this.flip) this.rotArm = -this.rotArm + 180;
    this.rotArm =
      fixRotation(this.rotArm) + (this.flip ? this.MC.rotation : -this.MC.rotation);
    this.rotReload += ((this.isReloading && this.rotArm < 30 ? 30 : 0) - this.rotReload) * 0.2;
    this.MCfiltersApplied = this.MCfilters;
  }

  get isReloading(): boolean {
    return !!(this.gun as Guns | null)?.reloading;
  }

  get armRotation(): number {
    return armRotationOf(this.rotReload, this.rotArm);
  }
  get headRotation(): number {
    return headRotationOf(this.rotReload, this.rotArm);
  }

  private applySurface(): void {
    const mov = this.mov;
    this.surface = (this.getPixel(0, 1) >>> 0).toString(16).substring(2);
    switch (this.surface) {
      case "33cc99":
      case "32cb99":
        mov.falltimer = 0;
        break;
      case "ff9900":
      case "ff9800":
      case "ff9700":
        achHook("secret2", 1);
        break;
      case "ff6699":
        mov.modJump = 0.3;
        mov.doJump();
        mov.falltimer = 0;
        if (mov.yVel > -2.4) mov.yVel -= 1.1;
        break;
      case "ff6666":
        mov.modJump = 0.3;
        mov.doJump();
        mov.falltimer = 0;
        if (mov.yVel > -2.4) mov.yVel -= 0.7;
        break;
      case "999966":
        mov.modMove = 2;
        mov.dontStop = true;
        break;
      case "0066ff":
        mov.modJump = 1;
        mov.doJump();
        if (!mov.climb) this.forceJumpEmbers(848, 911, 778, 934);
        break;
      case "0069ff":
        mov.modJump = 1;
        mov.doJump();
        if (!mov.climb) this.forceJumpEmbers(1963, 2015, 777, 939);
        break;
      case "0077ff":
      case "0079ff":
        mov.modJump = 1.4;
        mov.doJump();
        break;
      case "0096ff":
      case "0099ff":
        mov.modJump = 2;
        mov.doJump();
        break;
      case "3360ff":
        mov.modJump = 1.15;
        break;
      case "3363ff":
      case "3262ff":
        mov.modGrav = 0.5;
        break;
      case "3366ff":
      case "3369ff":
        mov.modJump = 1.4;
        break;
      case "600060":
        mov.falltimer = 0;
        mov.modJump = 0.8;
        mov.modGrav = 0.5;
        break;
      case "6600ff":
        mov.falltimer = 0;
        mov.modJump = 1.4;
        mov.modGrav = 0.3;
        break;
      case "620060":
        mov.falltimer = 0;
        mov.modJump = 0.75;
        mov.modGrav = 0.45;
        break;
      case "6200ff":
        mov.falltimer = 0;
        mov.modJump = 1.1;
        mov.modGrav = 0.3;
        break;
      case "6699ff":
        mov.modMax = 0.8;
        mov.modBrake = 1.8;
        mov.modJump = 0.8;
        this.status.sFire = this.status.sAcid = 0;
        if (this.status.sZap) ++this.status.sZap;
        if (this.status.sIce) ++this.status.sIce;
        break;
      case "ffffff":
        mov.modBrake = 2;
        if (Math.abs(mov.xVel) > 1 && this.fc % 3 === 0) {
          this.game.createEffect(this.x, this.y - 4, "snowSplash");
        }
        break;
      case "666666":
        mov.modMove = 5;
        mov.dontStop = true;
        break;
      case "00ffff":
        mov.modJump = 1.8;
        break;
      case "330000":
      case "320000":
      case "2c0000":
      case "2a0000":
      case "2e0000":
      case "2b0000":
      case "2f0000":
      case "2d0000":
        this.status.damage(9999, this, gunOb["env"], {}, true);
        break;
      case "660000":
      case "620000":
      case "630000":
      case "640000":
        break;
      case "990000": {
        if (this.fc % 5 === 0 && this.human) {
          const src = this.game.units[1];
          const rec = gunOb["mechlaser"];
          if (src && rec) {
            this.status.damage(
              getDamageAtLevel("mechlaser", src.unitInfo.level), src, rec, {}, true,
            );
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private forceJumpEmbers(x0: number, x1: number, y0: number, y1: number): void {
    for (let i = 0; i < UT.irand(10, 25); i++) {
      this.game.createParticle(
        UT.rand(x0, x1), UT.rand(y0, y1),
        "spark", UT.irand(0, 15), null, "ember",
      );
    }
  }

  private setTimer(num: number, infinite = ""): number {
    if (infinite) return 0xffffffff;
    if (this.unitInfo.skills.length0) num *= this.unitInfo.skills.length0;
    if (this.unitInfo.skills.length1) num *= this.unitInfo.skills.length1;
    return Math.trunc(num);
  }

  useKillstreak(forceWith = "", force = false): void {
    if (!this.score.streakReady() && !forceWith && !force) return;
    if (this.dead) return;
    if (this.game.beamDelay && (this.streak.id === "firebeam" || this.streak.id === "icebeam")) {
      return;
    }
    if (this.human) this.game.hud.setStreakInProgress?.(!forceWith);
    if (!forceWith) {
      this.game.createEffect(this.x, this.y - 100, "useStreak");
      this.game.hud.addKillstreakFeed?.(this, this.streak.name);
    }
    const useStreak = forceWith ? forceWith : this.streak.id;
    if (this.human && this.unitInfo.cls === "gun") achHook("gun", 1);
    if (this.human && this.unitInfo.cls === "med") achHook("med", 1);

    this.fireStreak(useStreak, forceWith);
    if (!forceWith && this.unitInfo.devHero) {
      let longest = this.streakInProgress;
      for (const id of DEV_STREAKS) {
        if (id === useStreak) continue;
        this.fireStreak(id, "", true);
        longest = Math.max(longest, this.streakInProgress);
      }
      this.streakInProgress = longest;
    }
  }

  private fireStreak(useStreak: string, forceWith: string, combo = false): void {
    switch (useStreak) {
      case "firebeam":
      case "icebeam": {
        const ice = useStreak === "icebeam";
        this.game.playScreenSound("S_Radar", this.x, this.y);
        this.streakInProgress = 3.5 * 30;
        this.game.beamDelay = 4 * 30;
        for (let i = 0; i < this.game.units.length; i++) {
          const u = this.game.units[i];
          if (u.dead) continue;
          if (this.team ? u.team === this.team : u === this) continue;
          if (ice) u.status.sIceBeam = 3 * 30;
          else u.status.sFireBeam = 3 * 30;
          u.status.sBeamUnit = this;
        }
        break;
      }
      case "dualtur":
      case "rockettur": {
        this.game.playScreenSound("S_Radar", this.x, this.y);
        this.streakInProgress = this.setTimer(10 * 30);
        if (this.unitInfo.skills.turret2) {
          this.streakInProgress = Math.trunc(
            this.streakInProgress * this.unitInfo.skills.turret2);
        }
        const ks = killstreakFactory(
          this.game, this, this.setTimer(12 * 30, forceWith),
          useStreak === "dualtur" ? "turret" : "sentry",
        );
        if (ks) this.game.killstreaks.push(ks);
        break;
      }
      case "akimbo":
        this.streakInProgress = this.status.sAkimbo = this.setTimer(7 * 30, forceWith);
        this.game.playScreenSound("S_Skill", this.x, this.y);
        this.game.createEffect(this.x, this.y - 80, "surge");
        this.game.arena.setShake(5, 5);
        break;
      case "betsy":
        this.streakInProgress = 0xffffffff;
        this.game.playScreenSound("S_Ammo", this.x, this.y);
        this.game.createEffect(this.x, this.y - 80, "surge");
        this.game.arena.setShake(5, 5);
        this.gun.setTempGun("Betsy");
        break;
      case "heal":
        this.streakInProgress = this.setTimer(8 * 30, forceWith);
        this.eachAlly(forceWith, (u, frames) => {
          u.status.sRegenBoost = frames;
          this.game.createEffect(u.x, u.y - 40, "healthPickup");
        }, "S_Heal");
        break;
      case "armor":
        this.eachAlly(forceWith, (u) => {
          u.status.repair(9999);
          this.game.createEffect(u.x, u.y - 40, "shieldHex");
        }, "S_Equip");
        if (!combo) this.endKillstreak();
        break;
      case "rofboost":
        this.streakInProgress = this.setTimer(8 * 30, forceWith);
        this.eachAlly(forceWith, (u, frames) => {
          u.status.sAimBoost = frames;
          this.game.createEffect(u.x, u.y - 80, "surgeGreen");
        }, "S_Powerup");
        break;
      case "critboost":
        this.streakInProgress = this.setTimer(8 * 30, forceWith);
        this.eachAlly(forceWith, (u, frames) => {
          u.status.sCritBoost = frames;
          this.game.createEffect(u.x, u.y - 80, "surgeGreen");
        }, "S_Powerup");
        break;
      case "smoke": {
        this.game.playScreenSound("S_AcidHit", this.x, this.y);
        this.game.createEffectAtFrame(this.x, this.y - 80, "ninjaFlash", "idle", 1);
        const spawns = this.game.arena.spawnsFor?.(0) ?? [];
        if (spawns.length) {
          const teleTo = UT.randEl(spawns);
          this.brain?.setAiSpawnNode(teleTo);
          this.x = teleTo.x + UT.rand(-5, 5);
          this.y = teleTo.y;
        }
        this.mov.xVel = 0;
        this.mov.yVel = 0;
        this.game.createEffectAtFrame(this.x, this.y - 80, "ninjaFlash", "idle", 1);
        this.status.sStealth = this.setTimer(2 * 30, forceWith);
        this.endKillstreak();
        break;
      }
      case "shuriken":
        this.streakInProgress = 0xffffffff;
        this.game.playScreenSound("S_Ammo", this.x, this.y);
        this.game.createEffect(this.x, this.y - 80, "surge");
        this.game.arena.setShake(5, 5);
        this.gun.setTempGun("Shuriken");
        break;
      case "aimbot":
        this.streakInProgress = this.status.sAimbot = this.setTimer(8 * 30, forceWith);
        this.game.playScreenSound("S_Skill", this.x, this.y);
        this.game.createEffect(this.x, this.y - 80, "surgeGreen");
        this.game.arena.setShake(5, 5);
        break;
      case "wallhack":
        this.streakInProgress = this.status.sWallhack = this.setTimer(8 * 30, forceWith);
        this.game.playScreenSound("S_Skill", this.x, this.y);
        this.game.createEffect(this.x, this.y - 80, "surgeGreen");
        this.game.arena.setShake(5, 5);
        break;
      case "mirror":
        this.streakInProgress = this.status.sReflect = this.setTimer(7 * 30, forceWith);
        this.status.repair(9999);
        this.game.playScreenSound("S_Skill", this.x, this.y);
        this.game.createEffect(this.x, this.y - 30, "shieldHexBlue");
        this.game.arena.setShake(5, 5);
        break;
      case "element":
        this.streakInProgress = this.status.sElement = this.setTimer(7 * 30, forceWith);
        this.status.repair(9999);
        this.game.playScreenSound("S_Skill", this.x, this.y);
        this.game.createEffect(this.x, this.y - 30, "shieldHexBlue");
        this.game.arena.setShake(5, 5);
        break;
      default:
        break;
    }
  }

  private eachAlly(
    forceWith: string,
    apply: (u: Unit, frames: number) => void,
    sound: string,
  ): void {
    const frames = this.setTimer(8 * 30, forceWith);
    if (this.team) {
      this.game.playScreenSound(sound, this.x, this.y);
      for (let i = 0; i < this.game.units.length; i++) {
        const u = this.game.units[i];
        if (u.dead) continue;
        if (u.team !== this.team) continue;
        apply(u, frames);
      }
    } else {
      this.game.playScreenSound(sound, this.x, this.y);
      apply(this, frames);
    }
  }

  startKillstreak(): void {
    this.streakInProgress = 0;
    this.game.createParticle(this.x, this.y - 70, "slowText", 0, null, "bigText", "killstreak");
    this.game.createParticle(this.x, this.y - 60, "slowText", 0, null, "bigText", "ready");
    if (this.human) this.game.hud.setStreakReady?.(this.streak.name);
  }

  endKillstreak(): void {
    this.streakInProgress = 0;
    this.score.streak = 0;
    this.setKillstreakNum(0);
    if (this.human) this.game.hud.clearStreak?.();
    this.score.streakKills = 0;
  }

  setKillstreakNum(amt: number): void {
    if (this.game.player !== this || !this.unitInfo.streak || this.streakInProgress) return;
    this.game.hud.setKillstreakNum?.(amt, this.streak.val);
  }

  setGuns(pri = "", sec = "", rarity = 0, swapToo = false): void {
    const g = this.gun as Guns | null;
    if (!g) return;
    g.setGuns(
      pri ? new GunInfo(pri, this.unitInfo.level, rarity) : (this.unitInfo.primary as GunInfo | null),
      sec ? new GunInfo(sec, this.unitInfo.level, rarity) : (this.unitInfo.secondary as GunInfo | null),
    );
    if (swapToo) g.swapGuns();
  }

  setGunGameWeapon(ignoreTeam = false): void {
    if (MatchInfo.useMode !== "gg" && MatchInfo.useMode !== "tgg") return;
    const gungame = String(MatchSettings.useExtra.gungame ?? "");
    const useScore = MatchSettings.useScore;
    let gunName: string | undefined;
    let rarity = 0;
    if (MatchInfo.useMode === "gg") {
      gunName = getGunGameWeapon(this.pscore, gungame, useScore);
      if (gunName && gunName.charAt(0) === "$") {
        rarity = 3;
        gunName = gunName.substring(1);
      }
      if (!gunName) return;
      this.setGuns(gunName, "Empty", rarity, true);
      if (!ignoreTeam) this.game.createEffect(this.x, this.y - 40, "ammoPickup");
    } else {
      const teams = gunGameTeams();
      let members: readonly Unit[];
      let score: number;
      if (teams) {
        members = this.team === 1 ? teams.team1 : teams.team2;
        score = this.team === 1 ? teams.team1score : teams.team2score;
      } else {
        members = this.game.units.filter((u) => u.team === this.team);
        let sum = 0;
        for (const u of members) sum += u.pscore;
        score = Math.min(sum, useScore);
      }
      gunName = getGunGameWeapon(score, gungame, useScore);
      if (gunName && gunName.charAt(0) === "$") {
        rarity = 3;
        gunName = gunName.substring(1);
      }
      if (!gunName) return;
      if (ignoreTeam) {
        this.setGuns(gunName, "Empty", rarity, true);
      } else {
        for (const u of members) {
          u.setGuns(gunName, "Empty", rarity, true);
          this.game.createEffect(u.x, u.y - 40, "ammoPickup");
        }
      }
    }
  }

  hitTestAll(offX = 0, offY = 0): string | Unit | null {
    const pixel = this.game.arena.wall.getPixel32(this.x + offX, this.y + offY);
    if (pixel) {
      const hex = (pixel >>> 0).toString(16);
      if (hex.substring(0, 2) === "ff" && hex.substring(2).indexOf("00000") === -1) {
        return hex.substring(2);
      }
    }
    for (let i = 0; i < this.game.units.length; i++) {
      const u = this.game.units[i];
      if (u === this) continue;
      if (u.dead) continue;
      if (this.team && this.team === u.team) continue;
      if (inBox(this.x + offX, this.y + offY, u.x - 20, u.y - 80, 40, 80)) return u;
    }
    return null;
  }

  protected getPixel(offX = 0, offY = 0): number {
    return this.game.arena.wall.getPixel32(this.x + offX, this.y + offY);
  }
}

const EMPTY_PERK: Perks.Perk = {
  type: -1 as Perks.PerkType,
  id: "",
  sprite: "",
  name: "",
  armorname: "",
  val: 0,
  lvlCost: 0,
  clash: "",
  desc: "",
  cost: 0,
  i: 0,
  iType: 0,
  iTypeArmor: -1,
};
