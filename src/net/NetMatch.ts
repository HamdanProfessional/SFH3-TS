import { Input } from "../core/Input";
import * as Config from "../core/Config";
import { SD } from "../state/SD";
import { SH } from "../audio/SH";
import type { Arena, NodeCtfFlag } from "../game/Arena";
import { fixRotation, getRotation } from "../game/Geom";
import type { Unit } from "../game/Unit";
import type { Fx } from "../game/fx/Fx";
import type { Hud } from "../ui/Hud";
import type { LineLayer } from "../ui/LineLayer";
import type { GunLike, HitExtra, PhysWorldLike } from "../game/types";
import { GunInfo } from "../game/GunInfo";
import { heroFromWire } from "./hero";
import {
  ANIM_IDS, EDGE, EV, LINE_OP, TICK_HZ, UF, UR,
  type DeviceRow, type Snapshot,
} from "./protocol";
import { PlaybackClock, angleLerp, playhead } from "./interp";
import { Predictor, type PendingInput } from "./Predictor";
import type { NetClient } from "./NetClient";

export interface NetMatchHost {
  readonly units: readonly Unit[];
  readonly player: Unit | null;
  readonly hud: Hud;
  readonly fx: Fx;
  readonly lineCont: LineLayer;
  readonly arena: Arena;
  readonly phys: PhysWorldLike | null;
  readonly paused: boolean;
  setScoreBar(t1: number, s1: number, t2: number, s2: number): void;
  follow(u: Unit): void;
  spectating(name: string | null, cam?: SpecCam): void;
  overview(on: boolean): void;
  notice(text: string | null): void;
  setStarted(started: boolean): void;
  endMatch(): void;
  heroChanged(u: Unit): void;
}

export type SpecCam = "follow" | "free" | "overview" | "killcam";

const KILLCAM_BEFORE = 2.5 * TICK_HZ;
const KILLCAM_AFTER = 0.6 * TICK_HZ;
const HISTORY_TICKS = 4 * TICK_HZ;

const FREE_SPEED = 14;
const FREE_FAST = 2.5;

interface InputExtra {
  noAim?: boolean;
  noShoot?: boolean;
}

const TELEPORT = 120;

export class NetMatch {
  private readonly clock = new PlaybackClock();
  private predict: Predictor | null = null;
  private ended = false;
  private streakReady = false;
  private shownGun = "";
  private showedRespawn = false;
  private aimTargetX = 0;
  private aimTargetY = 0;
  private showedLost = false;
  private readonly history: Snapshot[] = [];
  private pendingCam: { killer: number; at: number } | null = null;
  private cam: { killer: number; from: number; play: number; to: number; dead: (Unit["dead"])[] } | null = null;

  constructor(
    private readonly net: NetClient,
    private readonly host: NetMatchHost,
  ) {}

  get slot(): number {
    return this.net.round?.you ?? -1;
  }

  tick(): void {
    const lost = this.net.reconnecting;
    if (lost !== this.showedLost) {
      this.showedLost = lost;
      this.host.notice(lost ? ["CONNECTION LOST", "reconnecting..."].join("\n") : null);
    }
    if (this.net.state === "closed" && !this.ended) {
      this.ended = true;
      this.host.notice(null);
      this.host.endMatch();
      return;
    }
    const sent = this.sendInput();
    const snaps = this.net.snaps;
    if (!snaps.length) return;
    this.clock.advance(snaps[snaps.length - 1].t);
    this.remember(snaps);
    const { a, b, f } = this.clock.bracket(snaps);

    this.host.setStarted(a.started);
    if (this.pendingCam) this.startKillCam(a);
    if (this.cam && this.killCamDone(a)) this.endKillCam();
    if (this.cam) {
      this.restoreDead();
      this.applyObjectives(a.obj);
      this.fireEvents(snaps);
      this.cam.dead = this.host.units.map((u) => u.dead);
      const r = this.clock.bracket(this.history, this.cam.play);
      this.applyRows(r.a, r.b, r.f);
      this.replayLines(r.a.lines);
      const k = this.host.units[this.cam.killer];
      if (k) this.host.arena.setFocus(k, k.gun.curGun?.vision ?? 0.5);
      this.cam.play += 1;
      this.updateScoreBar(a);
      this.updateHud(a);
    } else {
      this.applyRows(a, b, f);
      if (this.slot < 0) this.spectate();
      this.applyObjectives(a.obj);
      this.fireEvents(snaps);
      this.replayLines(a.lines);
      this.updateScoreBar(a);
      this.updateHud(a);
      this.predictLocal(sent);
    }
    if (a.ended && !this.ended) {
      this.ended = true;
      this.host.endMatch();
    }
  }

  private remember(snaps: readonly Snapshot[]): void {
    const h = this.history;
    const last = h.length ? h[h.length - 1].t : -Infinity;
    for (const s of snaps) if (s.t > last) h.push(s);
    const newest = h.length ? h[h.length - 1].t : 0;
    let cut = 0;
    while (cut < h.length - 2 && h[cut].t < newest - HISTORY_TICKS) cut++;
    if (cut) h.splice(0, cut);
  }

  private startKillCam(live: Snapshot): void {
    const p = this.pendingCam;
    this.pendingCam = null;
    if (!p || this.ended || live.ended || this.history.length < 2) return;
    const from = Math.max(this.history[0].t, p.at - KILLCAM_BEFORE);
    if (p.at - from < TICK_HZ) return;
    this.cam = {
      killer: p.killer,
      from,
      play: from,
      to: p.at + KILLCAM_AFTER,
      dead: this.host.units.map((u) => u.dead),
    };
    const k = this.host.units[p.killer];
    this.host.spectating(k ? k.unitInfo.name : "", "killcam");
  }

  private killCamDone(live: Snapshot): boolean {
    const c = this.cam;
    if (!c) return true;
    const me = live.units[this.slot];
    const alive = !!me && !(me[UR.FLAGS] & UF.DEAD);
    const skip = !this.host.paused && c.play - c.from > TICK_HZ / 2 && (Input.mousePressed || Input.wasPressed("Space")
      || Input.wasPressed("KeyW"));
    return skip || alive || live.ended || c.play >= c.to
      || c.play > this.history[this.history.length - 1].t;
  }

  private endKillCam(): void {
    this.restoreDead();
    this.cam = null;
    this.host.spectating(null);
    const u = this.host.player;
    if (u) this.host.arena.setFocus(u, u.gun.curGun?.vision ?? 0.5);
  }

  private restoreDead(): void {
    const c = this.cam;
    if (!c) return;
    const units = this.host.units;
    for (let i = 0; i < units.length; i++) units[i].dead = c.dead[i] ?? null;
  }

  get devices(): readonly DeviceRow[] {
    const snaps = this.net.snaps;
    if (!snaps.length) return [];
    const { a, b, f } = this.clock.bracket(snaps);
    if (a === b || !b.devices.length) return a.devices;
    return a.devices.map((d, i) => {
      const n = b.devices[i];
      return n && n.kind === d.kind ? { ...d, rot: angleLerp(d.rot, n.rot, f) } : d;
    });
  }

  private fireEvents(snaps: readonly Snapshot[]): void {
    for (const s of snaps) {
      if (s.t <= this.clock.firedTo) continue;
      if (s.t > this.clock.play) break;
      this.replayEvents(s.ev);
      this.clock.firedTo = s.t;
    }
  }

  private sendInput(): PendingInput | null {
    if (this.slot < 0) return null;
    const u = this.host.player;
    if (!u) return null;
    const p = this.predict ?? (this.predict = new Predictor(u));
    if (this.host.paused) {
      const held: PendingInput = { seq: p.stamp(), keys: 0, edges: 0 };
      this.net.sendInput(0, 0, u.aimX, u.aimY, held.seq);
      return held;
    }
    const extra = u.unitInfo.extra as InputExtra;

    let keys = 0;
    let edges = 0;
    if (Input.isDown("KeyA") || Input.isDown("ArrowLeft")) keys |= 4;
    if (Input.isDown("KeyD") || Input.isDown("ArrowRight")) keys |= 8;
    if (Input.isDown("KeyS") || Input.isDown("ArrowDown")) keys |= 2;
    if (Input.isDown("KeyW") || Input.isDown("ArrowUp") || Input.isDown("Space")) {
      keys |= 1;
      if (Input.wasPressed("KeyW") || Input.wasPressed("ArrowUp")
        || Input.wasPressed("Space")) edges |= EDGE.JUMP;
    }
    if (Input.wasPressed("KeyR")) edges |= EDGE.RELOAD;
    if (Input.wasPressed("KeyQ") || Input.wasPressed("ShiftLeft")) edges |= EDGE.SWAP;
    if (Input.wasPressed("KeyE") || Input.wasPressed("ControlLeft")) edges |= EDGE.STREAK;
    if (Input.rightPressed) {
      if (SD.options.rightclick === 0) edges |= EDGE.RELOAD;
      else if (SD.options.rightclick === 1) edges |= EDGE.STREAK;
      else edges |= EDGE.SWAP;
    }
    if (Input.mousePressed && !extra.noShoot) edges |= EDGE.MDOWN;
    if (Input.mouseReleased) edges |= EDGE.MUP;

    const aimX = Input.mouseX - this.host.arena.x;
    const aimY = Input.mouseY - this.host.arena.y;
    const seq = p.stamp();
    this.net.sendInput(keys, edges, Math.round(aimX), Math.round(aimY), seq);
    this.aimTargetX = Math.round(aimX);
    this.aimTargetY = Math.round(aimY);
    return { seq, keys, edges };
  }

  private predictLocal(sent: PendingInput | null): void {
    const p = this.predict;
    const u = this.host.player;
    if (!p || !u || !sent || this.slot < 0) return;

    p.advance(this.net.you, sent, this.aimTargetX, this.aimTargetY);
    if (!p.live) {
      p.follow(u);
      return;
    }

    u.x = p.x + p.errX;
    u.y = p.y + p.errY;
    u.aimX = p.aimX;
    u.aimY = p.aimY;
    u.MC.rotation = p.rotation;

    const rot = p.rotation;
    let rotArm = getRotation(
      u.x + u.MC.armX + rot * 1.2, u.y + u.MC.armY, u.aimX, u.aimY,
    ) - 90;
    const aimRot = fixRotation(rotArm + 90);
    const flip = p.jumping ? u.aimX < u.x : fixRotation(aimRot - rot) < 0;
    if (flip) rotArm = -rotArm + 180;
    u.rotArm = fixRotation(rotArm) + (flip ? rot : -rot);
    u.aimRoation = aimRot;
    u.flip = flip;
  }

  private spectate(): void {
    const cur = this.host.player;
    const live = !this.host.paused;
    const alive = this.host.units.filter((u) => !u.dead && u.visible);
    if (live && Input.wasPressed("KeyO")) {
      this.overview = !this.overview;
      this.host.overview(this.overview);
    }
    if (live && Input.wasPressed("KeyF")) {
      this.free = !this.free;
      if (this.free) {
        const f = this.host.arena.camFocus;
        this.freeCam.x = f ? f.dead?.x ?? f.x : -this.host.arena.x + Config.GAME_WIDTH / 2;
        this.freeCam.y = f ? f.dead ? f.dead.y + 50 : f.y : -this.host.arena.y + Config.GAME_HEIGHT / 2;
      } else if (cur) {
        this.host.follow(cur);
      }
    }

    if (this.free) {
      if (live) {
        const k = (a: string, b: string): number => (Input.isDown(a) || Input.isDown(b) ? 1 : 0);
        const v = FREE_SPEED * (Input.isDown("ShiftLeft") || Input.isDown("ShiftRight") ? FREE_FAST : 1);
        const wall = this.host.arena.wall;
        this.freeCam.x = Math.max(0, Math.min(wall.width,
          this.freeCam.x + v * (k("KeyD", "ArrowRight") - k("KeyA", "ArrowLeft"))));
        this.freeCam.y = Math.max(0, Math.min(wall.height,
          this.freeCam.y + v * (k("KeyS", "ArrowDown") - k("KeyW", "ArrowUp"))));
        if (Input.mousePressed && alive.length && !this.overview) {
          const wx = Input.mouseX - this.host.arena.x;
          const wy = Input.mouseY - this.host.arena.y;
          let best = alive[0];
          let bestD = Infinity;
          for (const u of alive) {
            const d = (u.x - wx) ** 2 + (u.y - 30 - wy) ** 2;
            if (d < bestD) { bestD = d; best = u; }
          }
          this.free = false;
          this.host.follow(best);
        }
      }
      if (this.free) this.host.arena.setFocus(this.freeCam, 0);
    } else {
      let step = 0;
      if (live) {
        if (Input.wasPressed("KeyA") || Input.wasPressed("ArrowLeft")) step = -1;
        else if (Input.wasPressed("KeyD") || Input.wasPressed("ArrowRight")
          || Input.mousePressed) step = 1;
      }
      let next: Unit | undefined;
      if (step && alive.length) {
        const at = cur ? alive.indexOf(cur) : -1;
        next = alive[((at < 0 ? 0 : at + step) + alive.length) % alive.length];
      } else if (!cur || cur.dead || !cur.visible) {
        next = alive[0] ?? this.host.units[0];
      }
      if (next && next !== cur) this.host.follow(next);
    }

    const cam: SpecCam = this.overview ? "overview" : this.free ? "free" : "follow";
    const shown = this.host.player;
    const name = shown ? shown.unitInfo.name : null;
    const key = `${cam}:${name ?? ""}`;
    if (key !== this.watching) {
      this.watching = key;
      this.host.spectating(name ?? (cam === "follow" ? null : ""), cam);
    }
  }

  private watching = "";
  private overview = false;
  private free = false;
  private readonly freeCam = { x: 0, y: 0, human: false, dead: null };

  private applyRows(a: Snapshot, b: Snapshot, f: number): void {
    const units = this.host.units;
    const rows = a.units;
    for (let i = 0; i < rows.length && i < units.length; i++) {
      const row = rows[i];
      const nxt = b.units[i];
      const u = units[i];
      const flags = row[UR.FLAGS];

      const tween = nxt && f > 0
        && !!(flags & UF.VISIBLE) && !!(nxt[UR.FLAGS] & UF.VISIBLE)
        && Math.abs(nxt[UR.X] - row[UR.X]) < TELEPORT
        && Math.abs(nxt[UR.Y] - row[UR.Y]) < TELEPORT;

      if (tween) {
        u.x = row[UR.X] + (nxt[UR.X] - row[UR.X]) * f;
        u.y = row[UR.Y] + (nxt[UR.Y] - row[UR.Y]) * f;
        u.aimX = row[UR.AIM_X] + (nxt[UR.AIM_X] - row[UR.AIM_X]) * f;
        u.aimY = row[UR.AIM_Y] + (nxt[UR.AIM_Y] - row[UR.AIM_Y]) * f;
        u.alpha = (row[UR.ALPHA] + (nxt[UR.ALPHA] - row[UR.ALPHA]) * f) / 100;
        u.rotArm = angleLerp(row[UR.ROT_ARM], nxt[UR.ROT_ARM], f);
        u.rotReload = row[UR.ROT_RELOAD]
          + (nxt[UR.ROT_RELOAD] - row[UR.ROT_RELOAD]) * f;
      } else {
        u.x = row[UR.X];
        u.y = row[UR.Y];
        u.aimX = row[UR.AIM_X];
        u.aimY = row[UR.AIM_Y];
        u.alpha = row[UR.ALPHA] / 100;
        u.rotArm = row[UR.ROT_ARM];
        u.rotReload = row[UR.ROT_RELOAD];
      }

      u.visible = !!(flags & UF.VISIBLE);
      u.scaleX = flags & UF.FACE_LEFT ? -1 : 1;
      u.team = row[UR.TEAM];
      u.pscore = row[UR.PSCORE];
      u.streakInProgress = flags & UF.STREAK_ON ? 1 : 0;
      u.score.kills = row[UR.KILLS];
      u.score.deaths = row[UR.DEATHS];
      u.score.streak = row[UR.STREAK];
      u.respawnTimer = row[UR.RESPAWN];

      if (flags & UF.DEAD) {
        if (!u.dead) u.dead = { x: u.x, y: u.y };
      } else {
        u.dead = null;
      }

      const st = u.status;
      st.hpCur = row[UR.HP];
      st.hpMax = row[UR.HP_MAX];
      st.arCur = row[UR.AR];
      st.arMax = row[UR.AR_MAX];

      u.MC.netPose(ANIM_IDS[row[UR.ANIM]] ?? "idle",
        playhead(row[UR.FRAME], nxt?.[UR.FRAME], f, nxt?.[UR.ANIM] === row[UR.ANIM]));
      u.MC.gunsVisible = !!(flags & UF.GUNS_VIS);
      u.MC.arm1.frame = playhead(row[UR.ARM1], nxt?.[UR.ARM1], f, true);
      u.MC.arm2.frame = playhead(row[UR.ARM2], nxt?.[UR.ARM2], f, true);

      const gun = u.gun.curGun;
      if (gun) {
        gun.clipAmmo = row[UR.AMMO];
        gun.spareAmmo = row[UR.SPARE];
      }
    }
  }

  private applyObjectives(obj: readonly number[]): void {
    const a = this.host.arena;
    const units = this.host.units;
    let k = 0;
    for (const h of a.holdpoints) {
      h.curTeam = obj[k++] ?? h.curTeam;
      h.flagPos = obj[k++] ?? h.flagPos;
    }
    for (const f of a.ctfflags) {
      f.team = obj[k++] ?? f.team;
      const carrier = obj[k++] ?? -1;
      const unit = carrier >= 0 ? units[carrier] ?? null : null;
      f.unitCaptured = unit;
      f.present = !unit;
      for (const u of units) {
        if (u.hasFlag === f && u !== unit) u.hasFlag = null;
      }
      if (unit) unit.hasFlag = f as NodeCtfFlag;
    }
    for (const p of a.pickups) p.taken = obj[k++] ?? p.taken;
  }

  private replayEvents(ev: readonly unknown[][]): void {
    const fx = this.host.fx;
    for (const e of ev) {
      switch (e[0]) {
        case EV.FX:
          fx.createEffect(n(e[1]), n(e[2]), s(e[3]));
          break;
        case EV.FX_FRAME:
          fx.createEffectAtFrame(n(e[1]), n(e[2]), s(e[3]), s(e[4]), n(e[5]));
          break;
        case EV.PARTICLE:
          fx.createParticle(
            n(e[1]), n(e[2]), s(e[3]), n(e[4]),
            (e[5] ?? null) as never, s(e[6]), s(e[7]), n(e[8]),
          );
          break;
        case EV.SOUND:
          SH.playSound(s(e[1]));
          break;
        case EV.PAINT:
          fx.bitScreen.paint(
            n(e[1]), n(e[2]), !!n(e[3]), s(e[4]), s(e[5]) || undefined,
            n(e[6]) || undefined,
          );
          break;
        case EV.KILL:
          this.replayKill(e);
          break;
        case EV.FEED: {
          const u = this.host.units[n(e[1])];
          if (u) this.host.hud.addCustomFeed(u as never, s(e[2]));
          break;
        }
        case EV.GUN:
          this.replayGun(n(e[1]), s(e[2]), n(e[3]), s(e[4]), n(e[5]));
          break;
        case EV.HERO:
          this.replayHero(n(e[1]), e[2]);
          break;
        case EV.SAY: {
          const u = this.host.units[n(e[1])];
          if (u) this.host.hud.setMsg(u.unitInfo.name, s(e[2]), 4, false, u.unitInfo);
          break;
        }
        case EV.SCALE: {
          const u = this.host.units[n(e[1])];
          if (u) u.oscale = u.scale = n(e[2]);
          break;
        }
        default:
          break;
      }
    }
  }

  private replayKill(e: readonly unknown[]): void {
    const units = this.host.units;
    const killer = units[n(e[1])] ?? null;
    const victim = units[n(e[2])];
    if (!victim) return;
    const weaponId = s(e[3]);
    const bits = n(e[4]);
    const extra = {
      headMult: bits & 1 ? 1 : 0,
      critMult: !!(bits & 2),
      hitX: n(e[5]),
      hitY: n(e[6]),
    } as HitExtra;

    this.host.hud.addKillFeed(killer as never, victim as never, weaponId);
    if (n(e[2]) === this.slot && this.slot >= 0 && killer && killer !== victim) {
      this.pendingCam = { killer: n(e[1]), at: this.clock.play };
    }

    const phys = this.host.phys;
    if (!phys) return;
    let weapon: GunLike;
    try {
      weapon = new GunInfo(weaponId, 1, 0).stats as unknown as GunLike;
    } catch {
      return;
    }
    victim.mov.xVel = n(e[7]);
    victim.mov.yVel = n(e[8]);
    const corpse = phys.createCorpse(victim, killer, weapon, extra);
    if (corpse) victim.dead = corpse;
  }

  private replayGun(
    idx: number, curId: string, curRarity: number,
    otherId: string, otherRarity: number,
  ): void {
    const u = this.host.units[idx];
    if (!u) return;
    const g = u.gun;
    const pick = (id: string, rarity: number): typeof g.curGun | null => {
      if (!id) return null;
      if (g.primary && g.primary.id === id) return g.primary;
      if (g.secondary && g.secondary.id === id) return g.secondary;
      try {
        return new GunInfo(id, u.unitInfo.level, rarity).stats;
      } catch {
        return null;
      }
    };
    const cur = pick(curId, curRarity);
    if (cur) g.curGun = cur;
    const other = pick(otherId, otherRarity);
    g.otherGun = other as typeof g.otherGun;
  }

  private replayHero(idx: number, blob: unknown): void {
    const u = this.host.units[idx];
    if (!u || !blob || typeof blob !== "object") return;
    let info: ReturnType<typeof heroFromWire>;
    try {
      info = heroFromWire(blob as Record<string, unknown>);
    } catch {
      return;
    }
    info.name = u.unitInfo.name;
    info.team = u.team;
    info.extra = {};
    info.prepareForGame(idx === 0);
    u.adoptHero(info);
    if (idx === this.slot) {
      this.shownGun = "";
      if (this.streakReady) this.host.hud.clearStreak();
      this.streakReady = false;
    }
    this.host.heroChanged(u);
  }

  private replayLines(run: readonly number[]): void {
    const g = this.host.lineCont;
    let i = 0;
    while (i < run.length) {
      switch (run[i++]) {
        case LINE_OP.STYLE:
          g.lineStyle(run[i], run[i + 1], run[i + 2]);
          i += 3;
          break;
        case LINE_OP.MOVE:
          g.moveTo(run[i], run[i + 1]);
          i += 2;
          break;
        case LINE_OP.LINE:
          g.lineTo(run[i], run[i + 1]);
          i += 2;
          break;
        case LINE_OP.CURVE:
          g.curveTo(run[i], run[i + 1], run[i + 2], run[i + 3]);
          i += 4;
          break;
        default:
          return;
      }
    }
  }

  private updateScoreBar(snap: Snapshot): void {
    const player = this.host.player;
    if (snap.s1 || snap.s2) {
      this.host.setScoreBar(1, snap.s1, 2, snap.s2);
      return;
    }
    if (!player) return;
    let best: Unit | null = null;
    for (const u of this.host.units) {
      if (u === player) continue;
      if (!best || u.pscore > best.pscore) best = u;
    }
    const other = best ?? player;
    this.host.setScoreBar(player.team, player.pscore, other.team, other.pscore);
  }

  private updateHud(snap: Snapshot): void {
    const u = this.host.player;
    const hud = this.host.hud;
    if (!u) return;
    hud.setHealth(u.status.hpCur, u.status.hpMax);
    hud.setArmor(u.status.arCur, u.status.arMax);

    const waiting = this.slot >= 0
      && !!u.dead && u.respawnTimer > 0 && u.respawnTimer < 3 * 30;
    if (waiting) {
      hud.setRespawnText(`Respawn in ${Math.ceil(u.respawnTimer / 30)}`);
      this.showedRespawn = true;
    } else if (this.showedRespawn && !u.dead) {
      this.showedRespawn = false;
      hud.setRespawnText("");
    }

    const gun = u.gun.curGun;
    if (gun) {
      hud.setAmmoCount(gun as never);
      if (this.shownGun !== gun.id) {
        this.shownGun = gun.id;
        hud.setGuns(gun as never, u.gun.otherGun as never);
      }
    }

    const val = u.streak?.val ?? 0;
    if (this.slot < 0 || !val || u.streakInProgress) return;
    const ready = snap.started && u.score.streak >= val;
    if (ready !== this.streakReady) {
      this.streakReady = ready;
      if (ready) hud.setStreakReady(u.streak.name);
      else hud.clearStreak();
    }
    if (!ready) hud.setKillstreakNum(u.score.streak, val);
  }
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}
