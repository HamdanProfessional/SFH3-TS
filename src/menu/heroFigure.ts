import { MenuRig } from "../assets/MenuRig";
import { getDefaultWeapon, type GunInfo } from "../game/GunInfo";
import type { UnitInfo } from "../game/UnitInfo";
import * as Classes from "../data/StatsClasses";
import { MenuFigure } from "./MenuFigure";

function owned(hero: UnitInfo, slot: "primary" | "secondary"): GunInfo | null {
  const g = hero[slot];
  if (g && typeof g === "object" && "stats" in g) return g as GunInfo;
  return null;
}

export function gunFor(hero: UnitInfo, slot: "primary" | "secondary"): GunInfo {
  return owned(hero, slot) ?? getDefaultWeapon(hero.cls, slot);
}

export function gunFrameFor(hero: UnitInfo, slot: "primary" | "secondary"): number {
  const g = gunFor(hero, slot);
  return MenuRig.gunFrame(g.stats.sprite as string, g.rarity);
}

export function gunNameFor(hero: UnitInfo, slot: "primary" | "secondary"): string {
  const g = owned(hero, slot);
  return g ? (g.stats.name as string) : "Default";
}

export function stowTargetFor(hero: UnitInfo): string {
  const target = (gunFor(hero, "secondary").stats.unequip as string) || "body";
  return target === "legup1" ? "frontLeg" : target;
}

export function animLabelFor(hero: UnitInfo | null): string {
  if (!hero) return "idle";
  const band = Classes.getStatusBand(hero.status);
  let label: string = band.anim;
  if (band.anim === "idle") {
    const menu = gunFor(hero, "primary").stats.frameMenu as string;
    if (menu) label = menu;
  }
  return label;
}

export function animStartFor(hero: UnitInfo | null): number {
  const labels = MenuRig.data.animLabels;
  return labels[animLabelFor(hero)] ?? labels.idle ?? 1;
}

export function makeHeroFigure(hero: UnitInfo): MenuFigure {
  const fig = new MenuFigure();
  fig.setHero(hero, gunFrameFor(hero, "primary"), gunFrameFor(hero, "secondary"),
              stowTargetFor(hero));
  return fig;
}
