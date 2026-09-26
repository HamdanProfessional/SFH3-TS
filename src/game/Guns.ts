import type { Unit } from "./Unit";
import type { GameLike, GunHolderLike } from "./types";
import { makeBullet } from "./bullets/index";
import { getDefaultWeapon, GunInfo } from "./GunInfo";
import { cloneStats, type GunStats } from "../data/StatsGuns";
import { ammoCapacity } from "../data/StatsClasses";
import { UT } from "../core/UT";
import { SD } from "../state/SD";
import { MatchSettings } from "./MatchSettings";

export const OVERLEVEL_MALUS = 0.02;

export function applyOverlevel(
  stats: GunStats, gunLevel: number, heroLevel: number,
): void {
  const missing = gunLevel - heroLevel;
  if (missing <= 0) return;
  const m = Math.max(0, 1 - OVERLEVEL_MALUS * missing);
  stats.dmg *= m;
  stats.rps *= m;
  stats.aim *= m;
  stats.range *= m;
}

export class Guns implements GunHolderLike {
  private readonly unit: Unit;
  private readonly game: GameLike;

  shootDelay = 0;
  shotPressed = false;
  private burstCount = 0;
  private burstTimer = 0;
  reloading = false;
  private dualFire = false;

  curFrame = "idle";
  dynRecoil = 0;
  dynRecoilMod = 0;

  primary!: GunStats;
  secondary!: GunStats;
  curGun!: GunStats;
  otherGun!: GunStats;

  private soundFrames = 0;
  private shotTimer = 0;
  private fc = 0;

  constructor(unit: Unit) {
    this.unit = unit;
    this.game = unit.game;
  }

  setGuns(_primary: GunInfo | null, _secondary: GunInfo | null): void {
    this.dualFire = false;
    const cls = this.unit.unitInfo.cls;
    const primary = _primary ?? getDefaultWeapon(cls, "primary");
    const secondary = _secondary ?? getDefaultWeapon(cls, "secondary");

    this.primary = cloneStats(primary.stats);
    this.secondary = cloneStats(secondary.stats);
    applyOverlevel(this.primary, primary.level, this.unit.unitInfo.level);
    applyOverlevel(this.secondary, secondary.level, this.unit.unitInfo.level);

    if (MatchSettings.useMode === "gg" || MatchSettings.useMode === "tgg") {
      this.primary.infSpare = true;
      if (this.primary.noClip || this.primary.clipSpare === 0) this.primary.noAmmo = true;
      this.primary.ksWeap = false;
    } else {
      this.setGunMods(this.primary, 0);
      this.setGunMods(this.secondary, 1);
    }
    this.setAmmoAmount(this.primary);
    this.setAmmoAmount(this.secondary);
  }

  setGunMods(gun: GunStats, type: number): void {
    const sk = this.unit.unitInfo.skills;
    if (sk.dmg1 && !gun.isMelee && gun.type <= 10) gun.dmg *= sk.dmg1;
    if (sk.dmg2 && gun.isMelee) gun.dmg *= sk.dmg2;
    if (sk.bfire && !gun.isMelee) { gun.dmg *= sk.bfire; gun.fire += 0.1; }
    if (sk.bice && !gun.isMelee) { gun.dmg *= sk.bice; gun.ice += 0.1; }
    if (sk.bacid && !gun.isMelee) { gun.dmg *= sk.bacid; gun.acid += 0.1; }
    if (sk.bzap && !gun.isMelee) { gun.dmg *= sk.bzap; gun.acid += 0.1; }
    if (sk.radius && gun.splash && !gun.isMelee) gun.splash *= sk.radius;
    if (sk.range && !gun.isMelee) gun.range *= sk.range;
    if (sk.auto && type === 0 && !gun.isMelee) { gun.dmg *= sk.auto; gun.fireType = 1; }
    if (sk.burst && type === 0 && !gun.isMelee) { gun.dmg *= sk.burst; gun.fireType = 2; }
    if (!gun.isMelee) gun.clipSpare *= ammoCapacity(this.unit.unitInfo.cls);
    if (sk.ammo1 && !gun.isMelee) gun.clipSize *= sk.ammo1;
    if (sk.ammo2 && !gun.isMelee) gun.clipSpare *= sk.ammo2;
    if (sk.ammo3 && !gun.isMelee) {
      gun.clipSize *= gun.clipSpare + 1;
      gun.clipSize *= sk.ammo3;
      gun.clipSpare = 0;
    }
  }

  setAmmoAmount(gun: GunStats): void {
    if (gun.noClip) gun.clipSpare = 0;
    if (gun.infSpare) {
      gun.clipAmmo = gun.ammoTotal = gun.clipSize;
      gun.spareAmmo = gun.spareMax = 0;
    } else if (gun.clipSize === 0) {
      gun.noAmmo = true;
      gun.noClip = true;
      gun.clipAmmo = gun.clipSize = gun.ammoTotal = gun.spareAmmo = gun.spareMax = 0;
    } else if (gun.clipSpare === 0) {
      gun.noClip = true;
      gun.ammoTotal = Math.min(999, Math.ceil(gun.clipSize * (gun.clipSpare + 1)));
      gun.clipAmmo = gun.clipSize = gun.ammoTotal;
      gun.spareAmmo = gun.spareMax = 0;
    } else {
      gun.ammoTotal = Math.min(999, Math.ceil(gun.clipSize * (gun.clipSpare + 1)));
      gun.clipAmmo = gun.clipSize;
      gun.spareAmmo = gun.spareMax = gun.ammoTotal - gun.clipSize;
    }
  }

  setTempGun(id: string, rarity = 0): void {
    if (MatchSettings.useMode === "gg" || MatchSettings.useMode === "tgg") {
      this.unit.endKillstreak();
      return;
    }
    this.dualFire = false;
    this.curGun = new GunInfo(id, this.unit.unitInfo.level, rarity).stats;
    this.setAmmoAmount(this.curGun);
    this.setFrame("idle");
    this.reloading = false;
    if (this.unit.focused) {
      this.game.arena.setFocus?.(this.unit, this.curGun.vision);
      this.game.hud.setAmmoCount?.(this.curGun);
    }
  }

  reset(): void {
    this.shootDelay = 0;
    this.curGun = null as unknown as GunStats;
    this.setAmmoAmount(this.primary);
    this.setAmmoAmount(this.secondary);
    this.swapGuns();
    if (this.unit.unitInfo.extra.forcePistol) this.swapGuns();
  }

  swapGuns(): void {
    this.dualFire = false;
    if (this.curGun === this.primary && this.secondary.id === "Empty") return;
    if (this.curGun && this.curGun.ksWeap) return;
    if (this.unit.hasFlag) this.curGun = this.primary;

    if (this.curGun !== this.primary) {
      this.curGun = this.primary;
      this.otherGun = this.secondary;
      if (this.unit.focused) this.game.hud.setGuns?.(this.primary, this.secondary);
    } else {
      this.curGun = this.secondary;
      this.otherGun = this.primary;
      if (this.unit.focused) this.game.hud.setGuns?.(this.secondary, this.primary);
    }
    this.dynRecoil = this.curGun.recoil;
    this.setFrame("idle");
    if (this.unit.mDown) this.shotPressed = true;
    if (this.unit.focused) {
      this.game.arena.setFocus?.(this.unit, this.curGun.vision);
      this.game.hud.setAmmoCount?.(this.curGun);
    }
    this.burstCount = 0;
    this.burstTimer = 0;
    this.reloading = false;
    this.checkReload();
  }

  addAmmo(perc: number, effect = true): void {
    if (this.primary.noClip) {
      this.primary.clipAmmo = Math.min(
        this.primary.clipSize, this.primary.clipAmmo + Math.ceil(this.primary.clipSize * perc),
      );
    } else {
      this.primary.spareAmmo = Math.min(
        this.primary.spareMax, this.primary.spareAmmo + Math.ceil(this.primary.spareMax * perc),
      );
    }
    if (!this.secondary.infSpare) {
      if (this.secondary.noClip) {
        this.secondary.clipAmmo = Math.min(
          this.secondary.clipSize,
          this.secondary.clipAmmo + Math.ceil(this.secondary.clipSize * perc),
        );
      } else {
        this.secondary.spareAmmo = Math.min(
          this.secondary.spareMax,
          this.secondary.spareAmmo + Math.ceil(this.secondary.spareMax * perc),
        );
      }
    }
    if (this.unit.focused) this.game.hud.setAmmoCount?.(this.curGun);
    if (effect) this.game.createEffect(this.unit.x, this.unit.y - 40, "ammoPickup");
    this.checkReload();
  }

  EnterFrame(): void {
    if (!this.curGun) return;
    ++this.fc;
    if (this.shootDelay > 0) --this.shootDelay;
    else this.shootDelay = 0;

    if (this.burstTimer) {
      --this.burstTimer;
      if (this.burstTimer === 0 && this.burstCount) {
        this.burstTimer = 3;
        --this.burstCount;
        this.shoot(true);
      }
    }

    const sk = this.unit.unitInfo.skills;
    let useRecoil = this.curGun.recoil;
    if (sk.acc1) useRecoil *= sk.acc1;
    if (sk.assist) useRecoil *= sk.assist;
    if (this.dynRecoil > useRecoil) this.dynRecoil -= 0.05;

    let crouchMod = 0.6;
    if (sk.aim3) crouchMod = 0.3;
    if (sk.aim0) {
      if (this.unit.mov.crouching) this.dynRecoilMod = this.dynRecoil * crouchMod;
      else if (this.unit.mov.jumping) this.dynRecoilMod = this.dynRecoil * 1.4;
      else if (this.unit.mov.xVel) this.dynRecoilMod = this.dynRecoil * 1.3;
      else this.dynRecoilMod = this.dynRecoil;
    } else if (sk.aim2) {
      this.dynRecoilMod = this.unit.mov.crouching ? this.dynRecoil * crouchMod : this.dynRecoil;
    } else if (this.unit.mov.crouching) {
      this.dynRecoilMod = this.dynRecoil * crouchMod;
    } else if (this.unit.mov.jumping) {
      this.dynRecoilMod = this.dynRecoil * 1.2;
    } else if (this.unit.mov.xVel) {
      this.dynRecoilMod = this.dynRecoil * 1.1;
    } else {
      this.dynRecoilMod = this.dynRecoil;
    }

    if (sk.energy && this.fc % (30 * 3) === 0) this.addAmmo(0.01, false);
    if (this.soundFrames) --this.soundFrames;
  }

  resetFrame(): void {
    this.setFrame("idle");
  }

  setFrame(frame: string): void {
    this.curFrame = frame;
    void this.shotTimer;
    const cur = this.curGun as GunStats | undefined;
    if (!cur) return;
    const mc = this.unit.MC;
    switch (frame) {
      case "idle":
        mc.arm1.gotoAndStop(cur.frameIdle);
        mc.arm2.gotoAndStop(cur.frameIdle);
        break;
      case "fire": {
        let label = cur.frameFire + "_fire";
        if (this.dualFire) label += "2";
        mc.arm1.gotoAndPlay(label);
        mc.arm2.gotoAndPlay(label);
        break;
      }
      case "reload":
      case "reload_fast": {
        const label = cur.frameReload + "_" + frame;
        mc.arm1.gotoAndPlay(label);
        mc.arm2.gotoAndPlay(label);
        break;
      }
      default:
        break;
    }
  }

  playReloadSound(): void {
    if (!this.curGun) return;
    const cue = reloadSoundFor(this.curGun.frameReload);
    if (cue) this.game.playScreenSound(cue, this.unit.x, this.unit.y);
  }

  releaseMouse(): void {
    this.shotPressed = false;
  }

  shoot(force = false): void {
    const st = this.unit.status;
    if (st.sSpawn) return;
    if (st.sFrozen) return;
    if (((this.shootDelay || this.shotPressed) && !force) || this.reloading) return;

    if (!this.curGun.clipAmmo && !this.curGun.noAmmo) {
      this.game.playScreenSound("S_GunClick", this.unit.x, this.unit.y);
      return;
    }
    if (this.curGun.extra.noShoot) return;

    st.setStealthDelay(true);
    this.setFrame("fire");

    if (this.curGun.fireType === 0 && this.unit.human) this.shotPressed = true;

    if ((this.curGun.fireType === 2 || this.unit.unitInfo.skills.burst) && !force) {
      if (this.unit.human) this.shotPressed = true;
      this.burstTimer = 3;
      this.burstCount = this.curGun.burst - 1;
    }
    if (this.curGun.isDual) this.dualFire = !this.dualFire;
    if (this.curGun.reflectFrames) st.sReflect = this.curGun.reflectFrames;

    if (this.curGun.effShell && SD.options.graphPart) {
      this.game.createParticle(
        this.unit.x + rotX(this.unit.aimRoation, 28),
        this.unit.y + this.unit.MC.armY + rotY(this.unit.aimRoation, 28),
        "shell", 0,
        { rot: this.unit.aimRoation, flip: this.unit.scaleX * this.unit.scale },
        "shell", this.curGun.effShell,
      );
    }

    this.shootDelay = this.curGun.shootDelay;
    if (st.sRage) this.shootDelay *= 0.75;
    if (st.sAimBoost) this.shootDelay *= 0.6;
    if (this.unit.unitInfo.skills.rof1) this.shootDelay *= this.unit.unitInfo.skills.rof1;

    if (MatchSettings.useMod !== "ammo" && !this.curGun.noAmmo) {
      this.curGun.clipAmmo -= this.curGun.consume;
      if (this.curGun.clipAmmo < 0) this.curGun.clipAmmo = 0;
      if (this.curGun.jam && Math.random() < this.curGun.jam) {
        this.game.createParticle(
          this.unit.x + UT.rand(-5, 5), this.unit.y - UT.rand(50, 55),
          "text", 0, null, "bigText", "jam",
        );
        this.manualReload(true);
        return;
      }
    }

    if (this.unit.focused) {
      this.game.hud.setAmmoCount?.(this.curGun);
      this.game.arena.setShake(2, 2);
      if (!this.unit.unitInfo.skills.aim1 && this.dynRecoil < this.curGun.recoil * 1.7) {
        this.dynRecoil += this.curGun.recoilSpread;
      }
    }
    st.sFocus = 0;

    if (this.curGun.shotSound) {
      if (this.curGun.soundFrames) {
        if (!this.soundFrames) {
          this.game.playScreenSound(this.curGun.shotSound, this.unit.x, this.unit.y);
          this.soundFrames = this.curGun.soundFrames;
        }
      } else {
        this.game.playScreenSound(this.curGun.shotSound, this.unit.x, this.unit.y);
      }
    }

    if (this.curGun.multiShots) {
      for (let i = 0; i < this.curGun.multiShots; i++) this.makeBullet(this.curGun);
    } else {
      this.makeBullet(this.curGun);
    }

    if (st.sAkimbo && this.curGun.clipAmmo >= this.curGun.consume * 2) {
      if (MatchSettings.useMod !== "ammo") this.curGun.clipAmmo -= this.curGun.consume;
      this.makeBullet(this.curGun);
    }
    this.checkReload();
  }

  setHudStuff(): void {
    this.game.hud.setGuns?.(this.primary, this.secondary);
    this.game.hud.setAmmoCount?.(this.curGun);
  }

  makeBullet(gun: GunStats): void {
    const b = makeBullet(
      this.game, this.unit,
      this.unit.aimRoation + UT.rand(-this.dynRecoil, this.dynRecoilMod),
      this.unit.x + this.unit.MC.rotation * 1.2,
      this.unit.y + this.unit.MC.armY,
      Math.trunc(gun.xOff * this.unit.scale),
      gun,
    );
    if (b) this.game.addBullet(b);
  }

  reloaded(): void {
    this.reloading = false;
    this.setFrame("idle");
    if (this.unit.unitInfo.skills.butter && Math.random() < this.unit.unitInfo.skills.butter) {
      this.game.createParticle(
        this.unit.x + UT.rand(-5, 5), this.unit.y - UT.rand(50, 55),
        "text", 0, null, "bigText", "jam",
      );
      this.manualReload(true);
      return;
    }
    const needed = this.curGun.clipSize - this.curGun.clipAmmo;
    if (this.curGun.infSpare) {
      this.curGun.clipAmmo = this.curGun.clipSize;
    } else if (this.curGun.spareAmmo < needed) {
      this.curGun.clipAmmo += this.curGun.spareAmmo;
      if (MatchSettings.useMod !== "clips") this.curGun.spareAmmo = 0;
    } else {
      this.curGun.clipAmmo = this.curGun.clipSize;
      if (MatchSettings.useMod !== "clips") this.curGun.spareAmmo -= needed;
    }
    if (this.unit.focused) this.game.hud.setAmmoCount?.(this.curGun);
    if (this.unit.unitInfo.skills.reload) this.unit.status.sRage = 30 * 2;
  }

  reloadOther(): void {
    const needed = this.otherGun.clipSize - this.otherGun.clipAmmo;
    if (this.otherGun.spareAmmo < needed) {
      this.otherGun.clipAmmo += this.otherGun.spareAmmo;
      if (MatchSettings.useMod !== "clips" && !this.curGun.infSpare) this.otherGun.spareAmmo = 0;
    } else {
      this.otherGun.clipAmmo = this.otherGun.clipSize;
      if (MatchSettings.useMod !== "clips" && !this.curGun.infSpare) {
        this.otherGun.spareAmmo -= needed;
      }
    }
  }

  manualReload(force = false): void {
    if (this.unit.status.sFrozen) return;
    if (this.curGun.clipAmmo === this.curGun.clipSize
        || (!this.curGun.spareAmmo && !this.curGun.infSpare)) return;
    if (this.reloading || (this.shootDelay && !force)) return;
    if (this.curGun.extra.noShoot || this.curGun.noAmmo) return;
    this.checkReload(true);
  }

  checkReload(force = false): void {
    if (this.unit.status.sFrozen) return;
    if (this.curGun.extra.noShoot || this.curGun.noAmmo) return;
    if (!this.unit.human
        && (!this.curGun.clipAmmo && (!this.curGun.spareAmmo && !this.curGun.infSpare))) {
      this.swapGuns();
      return;
    }
    if (this.curGun.ksWeap && this.curGun.clipAmmo === 0) {
      this.unit.endKillstreak();
      this.curGun = null as unknown as GunStats;
      this.swapGuns();
      return;
    }
    if (!force && (this.curGun.clipAmmo || (!this.curGun.spareAmmo && !this.curGun.infSpare))) {
      return;
    }
    this.setFrame("reload");
    this.reloading = true;
  }
}

export function reloadSoundFor(frameReload: string): string | null {
  switch (frameReload) {
    case "pistol":
    case "magnum":
      return "S_PistolReload";
    case "magnum2":
      return "S_Magnum2Reload";
    case "pistol2":
    case "smg2":
      return "S_MpistolBReload";
    case "rifle":
      return "S_RifleReload";
    case "smg":
    case "top":
    case "bottom":
      return "S_SMGReload";
    case "shotgun":
    case "judgement":
      return "S_ShotgunReload";
    case "sbullpup":
      return "S_ShotgunBReload";
    case "heavy":
      return "S_HeavyReload";
    case "sniper":
      return "S_SniperReload";
    case "rocket":
    case "launcher":
      return "S_RocketReload";
    case "bullpup":
      return "S_BulpupReload";
    case "hbullpup":
      return "S_BulpupBReload";
    default:
      return null;
  }
}

function rotX(rot: number, spd: number): number {
  return Math.sin((rot * Math.PI) / 180) * spd;
}
function rotY(rot: number, spd: number): number {
  return -Math.cos((rot * Math.PI) / 180) * spd;
}
