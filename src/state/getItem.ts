import { SD, achHooks, type InvItem } from "./SD";
import { GunInfo } from "../game/GunInfo";
import { UnitInfo } from "../game/UnitInfo";
import * as Guns from "../data/StatsGuns";
import * as Classes from "../data/StatsClasses";
import * as Perks from "../data/StatsPerks";
import { UT } from "../core/UT";

export type RewardSource = "mapItem" | "storeItem" | "workshopItem";

export type RewardKind =
  | "uniqueClass" | "gun" | "blueprint" | "uniqueHero" | "hiredHero"
  | "class" | "gold" | "features" | "perk";

export function classify(item: unknown): RewardKind {
  if (typeof item === "string") {
    if (item.startsWith("$")) return "uniqueClass";
    if (Guns.itemOb[item]) return "blueprint";
    if (Classes.itemOb[item]) return "class";
    if (item === "features") return "features";
    return "perk";
  }
  if (item instanceof GunInfo) return "gun";
  if (item instanceof UnitInfo) return item.unique ? "uniqueHero" : "hiredHero";
  if (typeof item === "number") return "gold";
  return "perk";
}

export interface RewardView {
  kind: RewardKind;
  title: string;
  detail: string;
  rarity: number;
  card: GunInfo | string | null;
}

export function rewardView(item: unknown): RewardView {
  const kind = classify(item);
  switch (kind) {
    case "gold":
      return {
        kind, title: `$${UT.addNumCommas(item as number)}`, detail: "Funds",
        rarity: -1, card: null,
      };
    case "blueprint": {
      const id = item as string;
      return {
        kind, title: `${Guns.itemOb[id].name} Blueprint`,
        detail: "Build it in the Workshop.", rarity: -1, card: null,
      };
    }
    case "class": {
      const id = item as string;
      return {
        kind, title: `${Classes.itemOb[id].name} Class`,
        detail: "A new class is available to hire.", rarity: -1, card: null,
      };
    }
    case "uniqueClass": {
      const id = (item as string).substring(1);
      return {
        kind, title: Classes.itemOb[id]?.name ?? id,
        detail: "A unique hero is available.", rarity: -1, card: null,
      };
    }
    case "features":
      return {
        kind, title: "New Features", detail: "More of the game is unlocked.",
        rarity: -1, card: null,
      };
    case "uniqueHero":
    case "hiredHero": {
      const u = item as UnitInfo;
      return {
        kind, title: u.name || "Hero", detail: "A new hero joins the roster.",
        rarity: -1, card: null,
      };
    }
    case "gun": {
      const g = item as GunInfo;
      return { kind, title: g.name, detail: Guns.RARITY[g.rarity].text, rarity: g.rarity, card: g };
    }
    default: {
      const p = Perks.itemOb[item as string];
      return {
        kind: "perk", title: p?.name ?? String(item),
        detail: p?.desc ?? "A mod.", rarity: -1, card: item as string,
      };
    }
  }
}

export function popReward(source: RewardSource): void {
  if (source === "mapItem") SD.mapItem.shift();
  else if (source === "storeItem") SD.storeItem = null;
  else SD.workshopItem = null;
}

export interface TakeResult {
  ok: boolean;
  message: string;
}

export function takeReward(item: unknown, source: RewardSource): TakeResult {
  const kind = classify(item);
  let message = "Taken.";

  switch (kind) {
    case "gold":
      SD.setFunds(item as number);
      message = `+$${UT.addNumCommas(item as number)}`;
      break;
    case "blueprint":
      SD.findBlueprint(item as string);
      message = "Blueprint added.";
      break;
    case "class": {
      const id = item as string;
      const cls = Classes.itemOb[id];
      SD.bpClasses.push(cls.i);
      SD.achOb.classes = SD.bpClasses.length;
      achHooks.check("classes", 0);
      if (id !== "gun") SD.uniqueClasses.push(id);
      message = "Class unlocked.";
      break;
    }
    case "uniqueClass":
      SD.uniqueClasses.push(item as string);
      message = "Unique hero unlocked.";
      break;
    case "features":
      message = "Features unlocked.";
      break;
    case "uniqueHero":
    case "hiredHero": {
      const u = item as UnitInfo;
      if (SD.heroes.length >= 15) return { ok: false, message: "Roster full." };
      SD.heroes.push(u);
      message = `${u.name} hired.`;
      break;
    }
    case "gun": {
      const g = item as GunInfo;
      const err = SD.canAcquire(g, false);
      if (err === 1) return { ok: false, message: "Inventory full." };
      if (err === 3) return { ok: false, message: "Cannot be stored." };
      SD.items[SD.bucketOf(g)].push(g);
      message = `${g.name} stored.`;
      break;
    }
    default: {
      const id = item as string;
      const bucket = SD.bucketOf(id);
      if (bucket === 13) return { ok: false, message: "Cannot be stored." };
      if (SD.items[bucket].length >= SD.itemCap()) {
        return { ok: false, message: "Inventory full." };
      }
      SD.items[bucket].push(id);
      message = `${Perks.itemOb[id]?.name ?? id} stored.`;
      break;
    }
  }

  popReward(source);
  SD.save();
  return { ok: true, message };
}

export function discardReward(source: RewardSource): void {
  popReward(source);
  SD.save();
}

export function canSell(item: unknown): item is InvItem {
  const kind = classify(item);
  if (kind === "gun") return true;
  return kind === "perk" && !!Perks.itemOb[item as string];
}

export function sellReward(item: unknown, source: RewardSource): number {
  if (!canSell(item)) {
    discardReward(source);
    return 0;
  }
  const price = SD.sellPriceOf(item);
  SD.setFunds(price);
  achHooks.check("sell", price);
  popReward(source);
  SD.save();
  return price;
}

export function grantToken(token: string | number): TakeResult {
  SD.mapItem.push(token);
  return takeReward(SD.mapItem[SD.mapItem.length - 1], "mapItem");
}
