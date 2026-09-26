import { UnitInfo } from "../game/UnitInfo";
import type { PerkSlot } from "../game/UnitInfo";
import { GunInfo, type GunInfoSave } from "../game/GunInfo";
import { MAX_HERO_LVL, MAX_LVL } from "../data/StatsMisc";
import * as Classes from "../data/StatsClasses";
import * as Perks from "../data/StatsPerks";
import * as Guns from "../data/StatsGuns";

export function heroToWire(h: UnitInfo): Record<string, unknown> {
  const ob = h.createObject();
  if (ob.primary instanceof GunInfo) ob.primary = ob.primary.createObject();
  if (ob.secondary instanceof GunInfo) ob.secondary = ob.secondary.createObject();
  return ob;
}

export function heroFromWire(ob: Record<string, unknown>): UnitInfo {
  const info = UnitInfo.loadObject(ob);
  if (info.primary) info.primary = GunInfo.loadObject(info.primary as GunInfoSave);
  if (info.secondary) info.secondary = GunInfo.loadObject(info.secondary as GunInfoSave);
  return info;
}

function int(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function pick(v: unknown, table: Record<string, unknown>, fallback: string): string {
  return typeof v === "string" && v in table ? v : fallback;
}

export function sanitiseHero(raw: unknown): Record<string, unknown> {
  const ob = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cls = pick(ob.cls, Classes.itemOb, "eng");
  const klass = Classes.itemOb[cls];

  const perks: PerkSlot[] = [];
  if (Array.isArray(ob.perks)) {
    for (const slot of ob.perks as unknown[]) {
      if (perks.length >= 3) break;
      if (!Array.isArray(slot)) continue;
      perks.push([
        pick(slot[0], Perks.itemOb, ""),
        pick(slot[1], Perks.itemOb, ""),
        int(slot[2], 0, 2, 0),
      ]);
    }
  }

  const out: Record<string, unknown> = {
    name: cleanName(ob.name, klass?.name ?? "Rookie"),
    cls,
    level: int(ob.level, 1, MAX_HERO_LVL, 1),
    trait: pick(ob.trait, Perks.itemOb, ""),
    flaw: pick(ob.flaw, Perks.itemOb, ""),
    streak: klass && (klass.streaks as readonly string[]).includes(String(ob.streak))
      ? ob.streak : (klass?.streaks[0] ?? ""),
    weaponMod: pick(ob.weaponMod, Perks.itemOb, ""),
    armorMod: pick(ob.armorMod, Perks.itemOb, ""),
    perks,
    exp: int(ob.exp, 0, 1e9, 0),
    status: 400,
    head: int(ob.head, 0, 200, klass?.frames[0] ?? 0),
    body: int(ob.body, 0, 200, klass?.frames[0] ?? 0),
    face: int(ob.face, 1, 3, 1),
    skin: int(ob.skin, 1, 8, 1),
    hair: int(ob.hair, 1, 12, 1),
    color: int(ob.color, 1, 6, 1),
  };

  const primary = sanitiseGun(ob.primary);
  const secondary = sanitiseGun(ob.secondary);
  if (primary) out.primary = primary;
  if (secondary) out.secondary = secondary;
  return out;
}

function sanitiseGun(raw: unknown): GunInfoSave | null {
  if (!raw || typeof raw !== "object") return null;
  const ob = raw as Record<string, unknown>;
  const id = pick(ob.id, Guns.itemOb, "");
  if (!id) return null;
  return {
    id,
    rarity: int(ob.rarity, 0, 3, 0),
    level: int(ob.level, 1, MAX_LVL + 1, 1),
    upgrades: int(ob.upgrades, 0, 31, 0),
  };
}

export function cleanText(raw: unknown, max: number): string {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) continue;
    if (c >= 0x200b && c <= 0x200f) continue;
    if (c >= 0x202a && c <= 0x202e) continue;
    out += ch;
    if (out.length >= max) break;
  }
  return out.trim();
}

export function cleanName(raw: unknown, fallback: string): string {
  return cleanText(raw, 16) || fallback;
}
