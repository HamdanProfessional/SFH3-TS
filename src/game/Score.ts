import { MatchInfo } from "./types";
import type { Unit } from "./Unit";

export class Score {
  private readonly unit: Unit;

  headshots = 0;
  killed1 = 0;
  killed2 = 0;
  killed3 = 0;
  killed4 = 0;
  killed5 = 0;
  bulletsFired = 0;
  bulletsHit = 0;
  flagCap = 0;
  domCap = 0;
  jugKill = 0;
  lives = 0;
  kills = 0;
  deaths = 0;
  suicides = 0;
  betrayals = 0;
  killtimer = 0;
  multikill = 0;
  spree = 0;
  streak = 0;
  streakKills = 0;

  constructor(unit: Unit) {
    this.unit = unit;
    if (MatchInfo.useMode === "elim" || MatchInfo.useMode === "telim") {
      this.lives = MatchInfo.useScore;
      this.updateScore();
    }
    if (unit.unitInfo.extra.kills) this.setKills(Number(unit.unitInfo.extra.kills));
  }

  setKills(amt: number): void {
    this.kills = amt;
    this.updateScore();
  }

  EnterFrame(): void {
    if (this.killtimer) --this.killtimer;
    else this.multikill = 0;
  }

  addStreak(amt: number): void {
    const skills = this.unit.unitInfo.skills;
    if (this.unit.streak.val && !this.streakReady()) {
      if (skills.streak0) amt *= skills.streak0;
      if (skills.streak1) amt *= skills.streak1;
      if (skills.streak2) amt *= skills.streak2;
      if (skills.streak_) amt *= skills.streak_;
      if (skills.streak__) amt *= skills.streak__;
      this.streak += amt;
      this.unit.setKillstreakNum(this.streak);
      if (this.streakReady()) {
        this.unit.startKillstreak();
      }
    }
  }

  streakReady(): boolean {
    if (!this.unit.unitInfo.streak) return false;
    if (this.unit.streakInProgress) return false;
    if (this.unit.dead) return false;
    if (this.streak < this.unit.streak.val) return false;
    return true;
  }

  addKill(): void {
    ++this.multikill;
    ++this.spree;
    ++this.kills;
    this.killtimer = 3.5 * 30;
    this.addStreak(1);
    if (this.unit.streakInProgress && this.unit.human) ++this.streakKills;
    this.updateScore();
  }

  addDeath(): void {
    this.spree = 0;
    ++this.deaths;
    --this.lives;
    if (
      MatchInfo.useMode === "elim" ||
      (MatchInfo.useMode === "telim" && this.lives <= 0)
    ) {
      this.unit.unitInfo.extra.noSpawn = true;
    }
    if (!this.unit.unitInfo.skills.streak2) {
      this.streak = 0;
      this.unit.setKillstreakNum(this.streak);
    }
  }

  addSuicide(): void {
    ++this.suicides;
    this.updateScore();
  }

  addBetrayal(): void {
    ++this.betrayals;
    this.updateScore();
  }

  updateScore(): void {
    switch (MatchInfo.useMode) {
      case "dm":
      case "gg":
      case "tgg":
      case "tdm":
      case "one":
      case "zom":
        this.unit.pscore = this.kills - this.suicides - this.betrayals;
        break;
      case "elim":
        this.unit.pscore = this.lives;
        break;
      default:
        break;
    }
    MatchInfo.updateScores();
    if (MatchInfo.useMode === "gg" || MatchInfo.useMode === "tgg") {
      this.unit.setGunGameWeapon();
    }
  }
}
