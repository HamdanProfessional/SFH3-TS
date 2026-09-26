import { setKillstreakFactory } from "../Unit";
import { Killstreak_Turret, type KillstreakTurretKind } from "./Killstreak_Turret";
import type { GameLike, KillstreakLike } from "../types";
import type { Unit } from "../Unit";

export { Killstreak, type HpBar } from "./Killstreak";
export { Killstreak_Turret, TURRET_KINDS, type KillstreakTurretKind } from "./Killstreak_Turret";

export const STREAK_DEVICE: Readonly<Record<string, KillstreakTurretKind>> = {
  dualtur: "turret",
  rockettur: "sentry",
};

export function createKillstreak(
  game: GameLike, owner: Unit, frames: number, kind: KillstreakTurretKind,
): KillstreakLike {
  return new Killstreak_Turret(game, owner, frames, kind);
}

let installed = false;

export function installKillstreaks(): void {
  if (installed) return;
  installed = true;
  setKillstreakFactory(createKillstreak);
}

installKillstreaks();
