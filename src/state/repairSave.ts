import { UT } from "../core/UT";
import * as Classes from "../data/StatsClasses";
import * as Guns from "../data/StatsGuns";
import * as Perks from "../data/StatsPerks";
import type { SaveBlob } from "./SD";

const BUCKETS = 13;
const STORE_KINDS = 13;

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const num = (v: unknown, def: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : def;
const isPerk = (v: unknown): v is string => typeof v === "string" && !!Perks.itemOb[v];

function indices(v: unknown, n: number): number[] {
  return [...new Set(list(v).filter((i): i is number => isInt(i) && i >= 0 && i < n))];
}

function isGun(v: unknown): v is Raw & { id: string } {
  return isObj(v) && typeof v.id === "string" && !!Guns.itemOb[v.id];
}

function bucketOf(v: unknown): number {
  if (typeof v === "string") return isPerk(v) ? Perks.getGunType(v) : BUCKETS;
  return isGun(v) ? Guns.itemOb[v.id].type : BUCKETS;
}

function rewardOk(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    return v.startsWith("$") || v === "features"
      || !!Guns.itemOb[v] || !!Classes.itemOb[v] || !!Perks.itemOb[v];
  }
  return isGun(v);
}

function perkSlot(v: unknown): unknown[] | null {
  if (!Array.isArray(v) || !isPerk(v[0]) || !isPerk(v[1])) return null;
  return [v[0], v[1], isInt(v[2]) && v[2] >= 0 && v[2] <= 2 ? v[2] : 0];
}

function repairHero(h: Raw): Raw {
  const out: Raw = { ...h };
  const cls = typeof h.cls === "string" && Classes.itemOb[h.cls] ? h.cls : "eng";
  const c = Classes.itemOb[cls];
  out.cls = cls;
  out.name = typeof h.name === "string" ? h.name : "";
  if (h.trait !== "" && !isPerk(h.trait)) out.trait = UT.randEl(c.traits);
  if (!isPerk(h.flaw)) out.flaw = UT.randEl(Perks.flawAr).id;
  if (!isPerk(h.streak)) out.streak = UT.randEl(c.streaks);
  for (const k of ["weaponMod", "armorMod"]) {
    if (h[k] !== "" && !isPerk(h[k])) out[k] = "";
  }
  const slots = list(h.perks).map(perkSlot);
  out.perks = slots.every((s) => s) ? slots : [];
  for (const k of ["primary", "secondary"]) {
    if (h[k] && !isGun(h[k])) delete out[k];
  }
  out.level = Math.max(1, Math.floor(num(h.level, 1)));
  out.exp = Math.max(0, num(h.exp, 0));
  out.status = num(h.status, 400);
  for (const [k, def] of [["head", 0], ["body", 0], ["face", 1], ["skin", 1], ["hair", 1], ["color", 1]] as const) {
    out[k] = num(h[k], def);
  }
  return out;
}

export function repairSave(ob: SaveBlob): SaveBlob {
  const heroes = list(ob.heroes).filter(isObj).map(repairHero);
  const items: unknown[][] = Array.from({ length: BUCKETS }, () => []);
  for (const b of list(ob.items)) {
    for (const v of list(b)) {
      const k = bucketOf(v);
      if (k < BUCKETS) items[k].push(v);
    }
  }
  const seen = new Set<number>();
  const squad = list(ob.squad).filter((v): v is number => {
    if (v === -1) return true;
    if (!isInt(v) || v < 0 || v >= heroes.length || seen.has(v)) return false;
    seen.add(v);
    return true;
  });
  if (!squad.some((v) => v >= 0) && heroes.length) squad.unshift(0);
  const order = list(ob.storeOrder);
  const orderOk = order.every((v, i) => isInt(v) && v >= 0 && v < STORE_KINDS && order.indexOf(v) === i);
  const selHero = isInt(ob.selHero) && ob.selHero >= 0 && ob.selHero < heroes.length ? ob.selHero : 0;
  return {
    ...ob,
    heroes,
    selHero,
    squad,
    items: items as SaveBlob["items"],
    funds: Math.max(0, num(ob.funds, 0)),
    day: Math.max(1, Math.floor(num(ob.day, 1))),
    stages: list(ob.stages).filter((v): v is number => isInt(v) && v >= 0),
    bpClasses: indices(ob.bpClasses, Classes.itemAr.length),
    uniqueClasses: list(ob.uniqueClasses).filter((v): v is string => typeof v === "string"),
    bpOwned: indices(ob.bpOwned, Guns.itemAr.length),
    bpBuilt: indices(ob.bpBuilt, Guns.itemAr.length),
    gotAkq: ob.gotAkq === true,
    justHired: ob.justHired === true,
    lastDaily: typeof ob.lastDaily === "string" ? ob.lastDaily : "",
    mapItem: list(ob.mapItem).filter(rewardOk) as SaveBlob["mapItem"],
    storeItems: list(ob.storeItems).filter((v) => bucketOf(v) < BUCKETS) as SaveBlob["storeItems"],
    storeOrder: orderOk ? order as number[] : Array.from({ length: STORE_KINDS }, (_, i) => i),
    achievements: list(ob.achievements).filter((v): v is string => typeof v === "string"),
    achOb: isObj(ob.achOb) ? ob.achOb as SaveBlob["achOb"] : {},
    options: isObj(ob.options) ? ob.options as SaveBlob["options"] : ({} as SaveBlob["options"]),
  };
}
