import { UT } from "../core/UT";
import { getDamageAtLevel, getStatsAtLevel, itemOb } from "../data/StatsGuns";
import { coinFlip } from "./Geom";
import { SD } from "../state/SD";
import { MatchInfo } from "./types";
import { combatHooks } from "./combatHooks";
import type { FilterSpec, GunLike, HitExtra } from "./types";
import type { Unit } from "./Unit";

interface Bar {
  min: number;
  max: number;
  cur: number;
  old: number;
}

function bar(min = 0, max = 0, cur = 0): Bar {
  return { min, max, cur, old: 0 };
}

const achVariableHook = (id: string, amt: number): void => combatHooks.variable(id, amt);
export function setAchVariableHook(fn: (id: string, amt: number) => void): void {
  combatHooks.variable = fn;
}

const C_RAGE_OUTER = 0xffff00;
const C_RAGE_INNER = 0xff0000;
const C_FIRE = 0xffb600;
const C_ACID = 0xaccc00;
const C_ICE = 0xccffff;
const C_ZAP = 0x6666ff;
const C_CRAP = 0x996600;
const C_ARMOR = 0xffffff;
const C_REGEN = 0x00ff00;
const C_CRIT = 0xff0000;
const C_AIM = 0xffff00;
const C_JUG = 0xff0000;
const C_HURTBAR = 0xff0000;
const C_BEAM_FIRE = 0xff0000;
const C_BEAM_FIRE_HIT = 0xff9900;
const C_BEAM_ICE = 0x3399ff;
const C_BEAM_ICE_HIT = 0x66ffff;

function glow(
  color: number,
  alpha: number,
  blurX: number,
  blurY: number,
  strength: number,
  quality?: number,
  inner?: boolean,
  knockout?: boolean,
): FilterSpec {
  return { kind: "glow", color, alpha, blurX, blurY, strength, quality, inner, knockout };
}

export class Status {
  static readonly hurtBarColor = C_HURTBAR;

  private readonly unit: Unit;

  hpCur = 0;
  hpMax = 0;
  arCur = 0;
  arMax = 0;

  private hpBarDist = 0;
  readonly healthBar: Bar = bar();
  readonly hurtBar: Bar = bar();
  readonly armorBar: Bar = bar();

  private regenDelay = 0;
  stealthDelay = 60;

  sFireUnit: Unit | null = null;
  sAcidUnit: Unit | null = null;
  sBeamUnit: Unit | null = null;

  sSpawn = 0;
  sFire = 0;
  sIce = 0;
  sFrozen = 0;
  sFrozenTimer = 0;
  sZap = 0;
  sAcid = 0;
  sCrap = 0;
  sScan = 0;
  sAdren = 0;
  sFocus = 0;
  sReflect = 0;
  sTag = 0;
  sElement = 0;
  sDodge = 0;
  sInvis = 0;
  sSurge = 0;
  sRegenBoost = 0;
  sCritBoost = 0;
  sCritBoost2 = 0;
  sAimBoost = 0;
  sWallhack = 0;
  sAimbot = 0;
  sStealth = 0;
  sBloodthirst = 0;
  sRage = 0;
  sAkimbo = 0;
  sFireBeam = 0;
  sIceBeam = 0;
  overkill = 0;
  usedTrap = false;

  private fc = 0;
  healthColor = 0xffffff;

  constructor(unit: Unit) {
    this.unit = unit;
    this.stealthDelay = 60;
  }

  reset(): void {
    const info = this.unit.unitInfo;
    this.hpMax = info.health;
    if (info.skills.sacrifice) {
      this.hpMax *= info.skills.sacrifice;
    }
    this.hpCur = this.hpMax;
    this.arMax = info.armor;
    this.arCur = 0;
    this.sFire = 0;
    this.sIce = 0;
    this.sFrozen = 0;
    this.sFrozenTimer = 0;
    this.sZap = 0;
    this.sAcid = 0;
    this.sCrap = 0;
    this.sAdren = 0;
    this.sFocus = 0;
    this.sReflect = 0;
    this.sTag = 0;
    this.sElement = 0;
    this.sDodge = 0;
    this.sInvis = 0;
    this.sSurge = 0;
    this.sRegenBoost = 0;
    this.sCritBoost = 0;
    this.sCritBoost2 = 0;
    this.sAimBoost = 0;
    this.sWallhack = 0;
    this.sAimbot = 0;
    this.sStealth = 0;
    this.sBloodthirst = 0;
    this.sRage = 0;
    this.sAkimbo = 0;
    this.sFireBeam = 0;
    this.sIceBeam = 0;
    this.overkill = 0;
    this.usedTrap = false;

    this.healthBar.min = 0;
    this.healthBar.max = 10 + this.hpMax * 0.085;
    this.healthBar.cur = this.healthBar.max;
    this.armorBar.min = 0;
    this.armorBar.max = this.arMax * 0.1;
    this.armorBar.cur = this.armorBar.max;
    this.hurtBar.min = 0;
    this.hurtBar.max = 0;
    this.hurtBar.cur = 0;
    this.hpBarDist = this.hpMax / 25;
    this.hpBarDist = this.healthBar.max / this.hpBarDist;

    this.heal(this.hpMax, false, true);

    if (this.unit.focused) {
      this.unit.game.hud.setBloodyScreen(0);
      this.unit.game.hud.resetBloodyScreen(
        coinFlip(1, -1),
        coinFlip(1, -1),
        SD.options.screenBlood ? 1 : 2,
      );
    }
    if (info.skills.stealth || info.skills.stealth_) {
      this.sInvis = 1;
    }
    if (info.extra.permRegen) this.sRegenBoost = Number.MAX_VALUE;
    if (info.extra.permReflect) this.sReflect = Number.MAX_VALUE;
    if (info.extra.permWallhack) this.sWallhack = Number.MAX_VALUE;
    if (info.extra.permAkimbo) this.sAkimbo = Number.MAX_VALUE;
  }

  heal(amt: number, effect = true, force = false): void {
    if (this.unit.dead && !force) return;
    this.hpCur += amt;
    if (this.hpCur > this.hpMax) this.hpCur = this.hpMax;
    if (effect) this.unit.game.createEffect(this.unit.x, this.unit.y - 40, "healthPickup");
    this.setBars();
  }

  repair(amt: number, effect = true, force = false): void {
    if (this.unit.dead && !force) return;
    this.arCur += amt;
    if (this.arCur > this.arMax) this.arCur = this.arMax;
    if (effect) this.unit.game.createEffect(this.unit.x, this.unit.y - 40, "armorPickup");
    this.setBars();
  }

  setFire(unit: Unit | null, time: number): void {
    this.sFireUnit = unit;
    if (time < this.sFire) return;
    this.sFire = time;
  }

  setAcid(unit: Unit | null, time: number): void {
    this.sAcidUnit = unit;
    if (time < this.sAcid) return;
    this.sAcid = time;
  }

  damage(
    amt: number,
    shooter: Unit,
    weapon: GunLike,
    extra: HitExtra,
    forceDmg = false,
  ): void {
    const unit = this.unit;
    const info = unit.unitInfo;
    const sInfo = shooter.unitInfo;

    if (unit.dead) return;
    if (this.sSpawn && !forceDmg) return;

    if (info.skills.luck1 && Math.random() < info.skills.luck1) {
      unit.game.createParticle(
        unit.x + UT.rand(-5, 5), unit.y - UT.rand(25, 50),
        "text", 0, null, "bigText", "lucky",
      );
      return;
    }
    if (info.skills.dodge && Math.random() < info.skills.dodge) {
      unit.game.createParticle(
        unit.x + UT.rand(-5, 5), unit.y - UT.rand(25, 50),
        "text", 0, null, "bigText", "dodge",
      );
      this.sDodge = 20;
      return;
    }

    if (sInfo.level === 0) amt *= 0.5;

    let selfDmg = false;
    if (unit === shooter) {
      selfDmg = true;
      if (!unit.human && weapon.type === 9) {
        amt = 0;
      } else if (!unit.human) {
        amt *= 0.3;
      }
      amt *= weapon.selfDmg;
      if (info.skills.self0) amt *= info.skills.self0;
      if (info.skills.self1) amt *= info.skills.self1;
    } else if (unit.human) {
      amt *= 0.6 + shooter.diff * 0.4;
    } else if (MatchInfo.matchType === 0 && !unit.human && !shooter.human) {
      if (unit.team === 1) amt *= 0.6 + shooter.diff * 0.4;
      else amt *= 0.7 + shooter.diff * 0.3;
    } else if (!unit.human && !shooter.human) {
      amt *= 0.7 + shooter.diff * 0.3;
    }

    if (!shooter.human && unit.team === shooter.team && unit.team > 0) amt *= 0.3;
    if (this.sZap > 0) amt *= 1.1;
    if (info.skills.damage0) amt *= info.skills.damage0;
    if (info.skills.damage1) amt *= info.skills.damage1;
    if (sInfo.skills.sacrifice) amt *= sInfo.skills.sacrifice;
    if (info.skills.will) amt *= 1 - (1 - this.hpCur / this.hpMax) * info.skills.will;
    if (sInfo.skills.rage) {
      const hpPerc = 1 - shooter.status.hpCur / shooter.status.hpMax;
      amt *= 1 + hpPerc * sInfo.skills.rage;
    }
    if (weapon.id === "fire" || weapon.id === "acid") {
      if (info.skills.burn0) amt *= info.skills.burn0;
      if (info.skills.burn1) amt *= info.skills.burn1;
    }
    if (weapon.isExplosive) {
      if (info.skills.explo0) amt *= info.skills.explo0;
      if (info.skills.explo1) amt *= info.skills.explo1;
    }
    if (sInfo.skills.tag) this.sTag = 5 * 30;
    if (sInfo.skills.killsteal && unit.target !== shooter && !unit.human) {
      amt *= sInfo.skills.killsteal;
    }
    if (sInfo.skills.focus && shooter.status.sFocus > 1 * 30) amt *= sInfo.skills.focus;
    if (unit.isJug) amt *= 0.7;
    if (unit.team && unit.team === shooter.team && unit !== shooter) {
      amt *= 0.3;
      extra.teamkill = true;
    }

    let rand = Math.random();
    if (info.skills.status0) rand += info.skills.status0;
    if (info.skills.status1) rand += info.skills.status1;
    if (sInfo.skills.coating) rand += sInfo.skills.coating;
    if (sInfo.skills.coating_) rand += sInfo.skills.coating_;
    if (rand < 0) rand = 0;
    if (!selfDmg) {
      if (rand < weapon.fire) this.setFire(shooter, 2 * 30);
      if (rand < weapon.acid) this.setAcid(shooter, 10 * 30);
      if (rand < weapon.ice) this.sIce = 2 * 30;
      if (rand < weapon.zap) this.sZap = 2 * 30;
      if (rand < weapon.crap) this.sCrap = 3 * 30;
    }

    if (shooter.status.sAimbot && Math.random() < 0.7) extra.headMult = 1;

    let critChance = sInfo.crit / 100 + weapon.crit;
    if (shooter.status.sCritBoost) critChance += 0.5;
    if (shooter.status.sCritBoost2) critChance += 0.1;
    if (info.skills.luck0 && Math.random() < info.skills.luck0) critChance = 999;
    if (info.skills.magnet && Math.random() < info.skills.magnet) extra.headMult = 1;

    if (extra.headMult && !weapon.noHead && unit !== shooter) {
      let headDmg = 1.4 + weapon.headDmg;
      if (sInfo.skills.headdmg) headDmg += sInfo.skills.headdmg;
      amt *= headDmg;
      unit.game.createParticle(
        unit.x + UT.rand(-5, 5), unit.y - UT.rand(50, 55),
        "text", 0, null, "bigText", "headshot",
      );
    } else if (Math.random() <= critChance && !weapon.noCrit && unit !== shooter) {
      extra.critMult = true;
      let critDmg = 1.3 + weapon.critDmg;
      if (sInfo.skills.critdmg) critDmg += sInfo.skills.critdmg;
      amt *= critDmg;
      unit.game.createParticle(
        unit.x + UT.rand(-5, 5), unit.y - UT.rand(25, 50),
        "text", 0, null, "bigText", "critical",
      );
    }

    if (extra.splashMult) amt *= extra.splashMult;
    if (extra.headMult) {
      if (sInfo.skills.head0) amt *= sInfo.skills.head0;
      if (sInfo.skills.head1) amt *= sInfo.skills.head1;
    }
    if (unit.human && info.cls === "jug") achVariableHook("jug", amt);

    let hitArmor = false;
    if (this.arCur && !forceDmg) {
      hitArmor = true;
      this.arCur -= amt;
      if (this.arCur <= 0) {
        amt = -this.arCur;
        this.arCur = 0;
      } else {
        amt = 0;
      }
    }
    void hitArmor;

    const canAdren = this.hpCur > 20 && this.hpCur / this.hpMax > 0.3;
    this.hpCur -= amt;
    if (info.skills.adren && canAdren && this.hpCur < 1 && !forceDmg) {
      unit.game.createParticle(
        unit.x + UT.rand(-5, 5), unit.y - UT.rand(50, 55),
        "text", 0, null, "bigText", "adren",
      );
      this.hpCur = 1;
    }
    if (this.hpCur <= 0) {
      if (info.skills.bomb) {
        unit.gun?.makeBullet(getStatsAtLevel("bomb", info.level));
      }
      this.hpCur = 0;
      unit.die(shooter, weapon, extra);
      if (unit.focused) unit.game.hud.setBloodyScreen(1);
    }
    this.setStealthDelay();
    this.regenDelay = 30 * 3;
    if (info.skills.regen1) this.regenDelay = 0;
    this.setBars();
  }

  setBars(): void {
    this.healthBar.old = this.healthBar.cur;
    this.healthBar.cur = (this.hpCur / this.hpMax) * this.healthBar.max;
    this.armorBar.old = this.armorBar.cur;
    this.armorBar.cur = (this.arCur / this.arMax) * this.armorBar.max;
    if (
      this.healthBar.old - this.healthBar.cur <= 0 &&
      this.armorBar.old - this.armorBar.cur <= 0
    ) {
      this.hurtBar.cur = 0;
    } else {
      this.hurtBar.cur +=
        this.healthBar.old - this.healthBar.cur + (this.armorBar.old - this.armorBar.cur);
    }
    this.drawHpBars();
    if (this.unit.focused) this.setHudStuff();
  }

  setHudStuff(): void {
    const hud = this.unit.game.hud;
    hud.setArmor(this.arCur, this.arMax);
    hud.setHealth(this.hpCur, this.hpMax);
    if (this.unit.focused && this.unit.dead) hud.setBloodyScreen(1);
  }

  drawHpBars(): void {
    this.hurtBar.cur += (0 - this.hurtBar.cur) * 0.1;
  }

  get barNotchWidth(): number {
    return this.hpBarDist;
  }

  setStealthDelay(_shooting = false): void {
    this.stealthDelay = 10;
    this.sStealth = 0;
  }

  EnterFrame(): void {
    const unit = this.unit;
    const info = unit.unitInfo;
    const game = unit.game;
    const arena = game.arena;
    const glowOn = SD.options.graphGlow;
    let i = 0;

    unit.MCfilters = [];

    ++this.fc;
    ++this.sFocus;
    if (info.skills.focus && this.sFocus === 1 * 30) {
      if (this.sInvis < 0.7) {
        game.createParticle(
          unit.x + UT.rand(-5, 5), unit.y - UT.rand(50, 55),
          "text", 0, null, "bigText", "focus",
        );
      }
    }

    if (this.sWallhack) {
      if (this.sWallhack > 10 || this.sWallhack % 2 !== 0) {
        if (this.sInvis < 0.7) {
          game.bitscreen.paint(
            unit.x + arena.x, unit.y + arena.y - 30,
            true, "lightningGreen0", "idle", (this.fc % 6) + 1,
          );
        }
      }
      --this.sWallhack;
    }
    if (this.sAimbot) {
      if (this.sAimbot > 10 || this.sAimbot % 2 !== 0) {
        if (this.sInvis < 0.7) {
          game.bitscreen.paint(
            unit.x + arena.x, unit.y + arena.y - 30,
            true, "lightningYellow0", "idle", (this.fc % 6) + 1,
          );
        }
      }
      --this.sAimbot;
    }
    if (this.sAkimbo) {
      if (this.sAkimbo > 10 || this.sAkimbo % 2 !== 0) {
        if (this.sInvis < 0.7) {
          game.bitscreen.paint(
            unit.x + arena.x, unit.y + arena.y - 30,
            true, "lightningRed0", "idle", (this.fc % 6) + 1,
          );
        }
      }
      --this.sAkimbo;
    }
    if (this.sTag) {
      if (this.sInvis < 0.7) {
        game.bitscreen.paint(unit.x + arena.x, unit.y + arena.y - 30, true, "scan0");
      }
      --this.sTag;
    }
    if (this.sRage) {
      if (this.sRage > 10 || this.sRage % 2 !== 0) {
        if (glowOn) {
          unit.MCfilters.push(
            glow(C_RAGE_OUTER, 1, 20, 20, 1.5, 1, true, false),
            glow(C_RAGE_INNER, 1, 5, 5, 1),
          );
        } else {
          unit.MCfilters.push(glow(C_RAGE_OUTER, 1, 10, 10, 1.5));
        }
      }
      --this.sRage;
    }
    if (this.sReflect) {
      if (this.sReflect > 10 || this.sReflect % 2 !== 0) {
        if (this.sInvis < 0.7) {
          game.bitscreen.paint(
            unit.x + arena.x, unit.y + arena.y - 40,
            true, "tankFire0", "idle", (this.fc % 11) + 1,
          );
        }
      }
      --this.sReflect;
    }
    if (this.sElement) {
      if (this.sElement > 10 || this.sElement % 2 !== 0) {
        if (this.sInvis < 0.7) {
          game.bitscreen.paint(
            unit.x + arena.x, unit.y + arena.y - 40,
            true, "tankIce0", "idle", (this.fc % 13) + 1,
          );
        }
      }
      if (this.fc % 20) {
        for (i = 0; i < game.units.length; i++) {
          const other = game.units[i];
          if (other === unit) continue;
          if (other.dead) continue;
          if (other.status.sSpawn) continue;
          if (unit.team && other.team === unit.team) continue;
          if (UT.getDist(unit.x, unit.y, other.x, other.y) < 230) {
            other.status.setFire(unit, 20);
            other.status.setAcid(unit, 20);
          }
        }
      }
      --this.sElement;
    }

    if (this.sFireBeam) {
      --this.sFireBeam;
      if (this.sFireBeam > 30) {
        game.lineCont.lineStyle(
          (1 - this.sFireBeam / 60) * 2, C_BEAM_FIRE, 1.3 - this.sFireBeam / 60,
        );
      } else if (this.fc % 2 === 0) {
        game.lineCont.lineStyle(1, C_BEAM_FIRE, 1);
      }
      if (this.sFireBeam === 2) {
        game.createEffect(unit.x, unit.y - 50, "explosionTiny");
        this.damage(
          getDamageAtLevel("firebeam", this.sBeamUnit!.unitInfo.level),
          this.sBeamUnit!,
          itemOb["firebeam"],
          {},
        );
        this.setFire(this.sBeamUnit, 2 * 30);
        game.lineCont.lineStyle(15, C_BEAM_FIRE_HIT, 1);
      }
      if (this.sFireBeam === 1) game.lineCont.lineStyle(7, C_BEAM_FIRE_HIT, 1);
      if (this.sFireBeam === 0) game.lineCont.lineStyle(4, C_BEAM_FIRE_HIT, 1);
      game.lineCont.moveTo(unit.x, unit.y - 50);
      game.lineCont.lineTo(unit.x, unit.y - 600);
    }
    if (this.sIceBeam) {
      --this.sIceBeam;
      if (this.sIceBeam > 30) {
        game.lineCont.lineStyle(
          (1 - this.sIceBeam / 60) * 2, C_BEAM_ICE, 1.3 - this.sIceBeam / 60,
        );
      } else if (this.fc % 2 === 0) {
        game.lineCont.lineStyle(1, C_BEAM_ICE, 1);
      }
      if (this.sIceBeam === 2) {
        game.createEffect(unit.x, unit.y - 50, "bulletsparkIce");
        this.damage(
          getDamageAtLevel("icebeam", this.sBeamUnit!.unitInfo.level),
          this.sBeamUnit!,
          itemOb["icebeam"],
          {},
        );
        this.sFrozen = 2 * 30;
        this.sIce = 2 * 30;
        unit.stopFrames();
        game.lineCont.lineStyle(15, C_BEAM_ICE_HIT, 1);
      }
      if (this.sIceBeam === 1) game.lineCont.lineStyle(7, C_BEAM_ICE_HIT, 1);
      if (this.sIceBeam === 0) game.lineCont.lineStyle(4, C_BEAM_ICE_HIT, 1);
      game.lineCont.moveTo(unit.x, unit.y - 50);
      game.lineCont.lineTo(unit.x, unit.y - 600);
    }

    if (this.sFire > 0) {
      if (this.sFire > 10 || this.sFire % 2 !== 0) {
        if (glowOn) {
          unit.MCfilters.push(
            glow(C_FIRE, 1, 20, 20, 1.5, 1, true, false),
            glow(C_FIRE, 1, 5, 5, 1),
          );
        } else {
          unit.MCfilters.push(glow(C_FIRE, 1, 10, 10, 1.5));
        }
        if (this.sInvis < 0.7) {
          game.createEffect(
            unit.x + UT.rand(-10, 10), unit.y + UT.rand(-55, -10), "flame",
          );
        }
      }
      if (this.fc % 10 === 0) {
        this.damage(
          getDamageAtLevel("fire", this.sFireUnit!.unitInfo.level),
          this.sFireUnit!,
          itemOb["fire"],
          {},
        );
      }
      --this.sFire;
      if (info.skills.proof) --this.sFire;
    }
    if (this.sAcid > 0) {
      if (this.sAcid > 10 || this.sAcid % 2 !== 0) {
        if (glowOn) {
          unit.MCfilters.push(
            glow(C_ACID, 1, 20, 20, 1.5, 1, true, false),
            glow(C_ACID, 1, 5, 5, 1),
          );
        } else {
          unit.MCfilters.push(glow(C_ACID, 1, 10, 10, 1.5));
        }
        if (this.sInvis < 0.7) {
          game.createEffect(
            unit.x + UT.rand(-10, 10), unit.y + UT.rand(-55, -10), "bubble",
          );
        }
      }
      if (this.fc % 10 === 0) {
        this.damage(
          getDamageAtLevel("acid", this.sAcidUnit!.unitInfo.level),
          this.sAcidUnit!,
          itemOb["acid"],
          {},
        );
      }
      --this.sAcid;
      if (info.skills.proof) --this.sAcid;
    }
    if (this.sIce > 0) {
      if (this.sIce > 10 || this.sIce % 2 !== 0) {
        if (glowOn) {
          unit.MCfilters.push(
            glow(C_ICE, 1, 20, 20, 1.5, 1, true, false),
            glow(C_ICE, 1, 5, 5, 1),
          );
        } else {
          unit.MCfilters.push(glow(C_ICE, 1, 10, 10, 1.5));
        }
      }
      --this.sIce;
      ++this.sFrozenTimer;
      if (this.sFrozenTimer >= 2 * 30) {
        if (!this.sFrozen) game.playScreenSound("S_Ice", unit.x, unit.y);
        this.sFrozenTimer = 0;
        this.sFrozen = 2 * 30;
        this.sIce = 2 * 30;
      }
    } else {
      this.sFrozenTimer = 0;
    }
    if (this.sFrozen > 0) {
      game.bitscreen.paint(unit.x + arena.x, unit.y + arena.y - 30, true, "ice0");
      --this.sFrozen;
      if (info.skills.proof) --this.sFrozen;
      if (this.sFrozen <= 0) {
        this.sIce = 0;
        this.sFrozenTimer = 0;
      }
    }
    if (this.sZap > 0) {
      if (this.sZap > 10 || this.sZap % 2 !== 0) {
        if (glowOn) {
          unit.MCfilters.push(
            glow(C_ZAP, 1, 20, 20, 1.5, 1, true, false),
            glow(C_ZAP, 1, 5, 5, 1),
          );
        } else {
          unit.MCfilters.push(glow(C_ZAP, 1, 10, 10, 1.5));
        }
      }
      --this.sZap;
      if (info.skills.proof) --this.sZap;
    }
    if (this.sCrap > 0) {
      if (this.sCrap > 10 || this.sCrap % 2 !== 0) {
        if (glowOn) {
          unit.MCfilters.push(
            glow(C_CRAP, 1, 20, 20, 1.5, 1, true, false),
            glow(C_CRAP, 1, 5, 5, 1),
          );
        } else {
          unit.MCfilters.push(glow(C_CRAP, 1, 10, 10, 1.5));
        }
      }
      --this.sCrap;
      if (info.skills.proof) --this.sCrap;
    }

    if (this.arCur) {
      if (glowOn) {
        unit.MCfilters.push(
          glow(C_ARMOR, this.arCur / this.arMax, 10, 10, 1, 1, true, false),
          glow(C_ARMOR, this.arCur / this.arMax + 0.5, 4, 4, 1),
        );
      } else {
        unit.MCfilters.push(glow(C_ARMOR, this.arCur / 120 + 0.5, 10, 10, 1.5));
      }
    }
    if (this.sDodge) {
      unit.MCfilters.push({ kind: "blur", blurX: 5, blurY: 0, quality: 1 });
      --this.sDodge;
    }
    if (unit.isJug) unit.MCfilters.push(glow(C_JUG, 1, 8, 8, 2));

    this.drawHpBars();

    if (this.sInvis) {
      if (unit.focused || unit.team === 1) {
        unit.mcAlpha = 1 - this.sInvis * 0.8;
      } else {
        unit.alpha = 1 - this.sInvis;
      }
    } else {
      unit.alpha = 1;
      unit.mcAlpha = 1;
    }
    if (this.sStealth > 0) {
      --this.sStealth;
      this.sInvis = 1;
    } else if (info.skills.stealth || info.skills.stealth_) {
      if (this.fc % 5 === 0) {
        for (i = 0; i < game.units.length; i++) {
          const other = game.units[i];
          if (other.dead) continue;
          if (unit.team && unit.team === other.team) continue;
          if (
            info.skills.stealth &&
            UT.getDist(unit.x, unit.y, other.x, other.y) < 325
          ) {
            this.stealthDelay = 15;
          }
        }
      }
      if (unit.hasFlag) this.stealthDelay = 60;
      if (this.stealthDelay) {
        --this.stealthDelay;
        this.sInvis -= 0.05;
        if (this.sInvis < 0) this.sInvis = 0;
      } else {
        this.sInvis += 0.05;
        if (this.sInvis > 1) this.sInvis = 1;
      }
    } else {
      this.sInvis -= 0.05;
      if (this.sInvis < 0) this.sInvis = 0;
    }

    if (this.sCritBoost) {
      if (this.fc % 3 === 0 && this.sInvis < 0.7) {
        game.createEffect(
          unit.x + UT.rand(-10, 10), unit.y + UT.rand(-45, -10), "critBoost",
        );
      }
      if (this.sCritBoost > 10 || this.sCritBoost % 2 !== 0) {
        unit.MCfilters.push(glow(C_CRIT, 0.8, 10, 10, 1, 1, true));
      }
      --this.sCritBoost;
    }
    if (this.sCritBoost2) {
      if (this.fc % 5 === 0 && this.sInvis < 0.7) {
        game.createEffect(
          unit.x + UT.rand(-10, 10), unit.y + UT.rand(-45, -10), "critBoost",
        );
      }
      --this.sCritBoost2;
    }
    if (this.sAimBoost) {
      if (this.fc % 3 === 0 && this.sInvis < 0.7) {
        game.createEffect(
          unit.x + UT.rand(-10, 10), unit.y + UT.rand(-45, -10), "aimBoost",
        );
      }
      if (this.sAimBoost > 10 || this.sAimBoost % 2 !== 0) {
        unit.MCfilters.push(glow(C_AIM, 0.8, 10, 10, 1, 1, true));
      }
      --this.sAimBoost;
    }

    if (this.sRegenBoost) {
      if (this.fc % 3 === 0) {
        if (this.sInvis < 0.7) {
          game.createEffect(
            unit.x + UT.rand(-10, 10), unit.y + UT.rand(-45, -10), "healthRegen",
          );
        }
        this.heal(this.hpMax * 0.01, false);
      }
      if (this.sRegenBoost > 10 || this.sRegenBoost % 2 !== 0) {
        unit.MCfilters.push(glow(C_REGEN, 0.8, 10, 10, 1, 1, true));
      }
      --this.sRegenBoost;
    } else if (this.regenDelay) {
      --this.regenDelay;
    } else if (this.hpCur < this.hpMax) {
      if (info.skills.regen2) {
        if (this.fc % 3 === 0) {
          this.heal(this.hpMax * 0.01, false);
          if (this.sInvis < 0.7) {
            game.createEffect(
              unit.x + UT.rand(-10, 10), unit.y + UT.rand(-45, -10), "healthRegen",
            );
          }
        }
      } else if (!info.skills.regen0 && this.fc % 9 === 0) {
        this.heal(this.hpMax * 0.01, false);
        if (this.sInvis < 0.7) {
          game.createEffect(
            unit.x + UT.rand(-10, 10), unit.y + UT.rand(-45, -10), "healthRegen",
          );
        }
      }
    }

    if (unit.focused) {
      const hpPerc = this.hpCur / this.hpMax;
      if (hpPerc > 0.5) game.hud.setBloodyScreen(0);
      else game.hud.setBloodyScreen(1 - hpPerc * 1.8);
    }

    if (unit.team && info.skills.aura && this.fc % (3 * 30) === 0) {
      for (i = 0; i < game.units.length; i++) {
        const other = game.units[i];
        if (other === unit) continue;
        if (unit.team !== other.team) continue;
        if (UT.getDist(unit.x, unit.y, other.x, other.y) < 200) {
          other.status.heal(other.status.hpMax * 0.15);
        }
      }
    }
    if (unit.team && info.skills.inspire && this.fc % 15 === 0) {
      for (i = 0; i < game.units.length; i++) {
        const other = game.units[i];
        if (other === unit) continue;
        if (unit.team !== other.team) continue;
        if (UT.getDist(unit.x, unit.y, other.x, other.y) < 200) {
          other.status.sCritBoost2 = 15;
        }
      }
    }
    if (info.skills.boots && this.hpCur / this.hpMax < 0.4) this.sRage = 5;
  }
}
