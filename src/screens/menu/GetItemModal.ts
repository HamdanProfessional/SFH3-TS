import { Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT, DESIGN_WIDTH, DESIGN_HEIGHT } from "../../core/Config";
import { focusable, hitTest } from "../../ui/kit";
import { ArtButton } from "../../ui/art";
import {
  itemBoxView, containerView, imgSprite, itemField, preloadItemArt,
  itemArtEpoch, tex, UI, BOX_TWEEN_FRAMES, type ImgRec,
} from "./InventoryPage";
import {
  canSell, classify, sellReward, takeReward, type RewardSource,
} from "../../state/getItem";
import { SD, type InvItem } from "../../state/SD";
import { SH } from "../../audio/SH";
import { GunInfo } from "../../game/GunInfo";
import type { UnitInfo } from "../../game/UnitInfo";
import * as Guns from "../../data/StatsGuns";
import * as Classes from "../../data/StatsClasses";
import * as Perks from "../../data/StatsPerks";
import { UT } from "../../core/UT";

const BTN = { take: "bt_take", sell: "bt_sell", okay: "bt_okay" } as const;

const PLATE_EDGE = 24;

const UNLOCK_POP = [0.4314, 0.9097, 1.2818, 1.5475, 1.707, 1.7601] as const;

const UNLOCK_OK_AT = 13;

export class GetItemModal extends Container {
  private ok: ArtButton | null = null;
  private okHit: [number, number, number, number] | null = null;
  private discardBtn: ArtButton | null = null;
  private discardHit: [number, number, number, number] | null = null;
  private msgTxt: Text | null = null;

  private confirmKind: "hire" | "fire" | "build" | null = null;
  private confirmPrice = 0;
  private confirmName = "";
  private confirmBp = -1;
  private onConfirm: ((ok: boolean) => void) | null = null;
  private hoverGlow = new Graphics();

  private item: unknown = null;
  private source: RewardSource = "mapItem";
  private mode: "reward" | "buy" | "sell" = "reward";
  private revealOnly = false;
  private onDone: (() => void) | null = null;
  private message = "";
  private plateLabel = "";
  private artEpoch = -1;
  private revealFrame = 0;
  private ox = 0;
  private oy = 0;
  private wingCache = new Map<string, Texture>();

  get isOpen(): boolean {
    return this.item !== null || this.confirmKind !== null;
  }

  open(item: unknown, source: RewardSource, onDone: () => void): void {
    preloadItemArt();
    this.item = item;
    this.source = source;
    this.mode = "reward";
    this.revealOnly = false;
    this.onDone = onDone;
    this.message = "";
    this.plateLabel = "";
    this.revealFrame = 0;
    this.build();
  }

  openReveal(item: unknown, onDone: () => void): void {
    preloadItemArt();
    this.item = item;
    this.mode = "reward";
    this.revealOnly = true;
    this.onDone = onDone;
    this.message = "";
    this.plateLabel = "";
    this.revealFrame = 0;
    this.build();
  }

  openTransaction(item: InvItem, mode: "buy" | "sell", onDone: () => void): void {
    preloadItemArt();
    this.item = item;
    this.mode = mode;
    this.revealOnly = false;
    this.onDone = onDone;
    this.message = "";
    this.plateLabel = "";
    this.revealFrame = 0;
    this.build();
  }

  initHire(price: number, onDone: (ok: boolean) => void): void {
    preloadItemArt();
    this.item = null;
    this.confirmKind = "hire";
    this.confirmPrice = price;
    this.confirmName = "";
    this.onConfirm = onDone;
    this.message = "";
    this.plateLabel = "";
    this.build();
  }

  initBuild(bpNum: number, onDone: (ok: boolean) => void): void {
    preloadItemArt();
    this.item = null;
    this.confirmKind = "build";
    this.confirmBp = bpNum;
    this.confirmPrice = Guns.getBlueprintPrice(Guns.itemAr[bpNum].costMod);
    this.confirmName = "";
    this.onConfirm = onDone;
    this.message = "";
    this.plateLabel = "";
    this.build();
  }

  initFire(name: string, onDone: (ok: boolean) => void): void {
    preloadItemArt();
    this.item = null;
    this.confirmKind = "fire";
    this.confirmName = name;
    this.onConfirm = onDone;
    this.message = "";
    this.plateLabel = "";
    this.build();
  }

  layout(): void {
    if (this.isOpen) this.build();
  }

  private plateWings(rec: ImgRec | undefined): Sprite[] {
    if (!rec || !rec.w || !rec.h) return [];
    const src = tex(rec);
    if (src.width < 2) return [];
    const left = this.ox - rec.ox;
    const right = left + rec.w;
    const top = this.oy - rec.oy;
    const inset = Math.min(src.width - 1,
      Math.round(PLATE_EDGE * src.width / rec.w));
    const out: Sprite[] = [];
    const wing = (col: number, x: number, w: number): void => {
      if (w <= 0.5) return;
      const key = `${rec.file}#${col}`;
      let strip = this.wingCache.get(key);
      if (!strip) {
        strip = new Texture({
          source: src.source,
          frame: new Rectangle(col, 0, 1, src.height),
        });
        this.wingCache.set(key, strip);
      }
      const s = new Sprite(strip);
      s.position.set(x, top);
      s.width = w;
      s.height = rec.h;
      out.push(s);
    };
    if (left > 0) wing(inset, 0, left + PLATE_EDGE);
    if (right < GAME_WIDTH) {
      wing(src.width - 1 - inset, right - PLATE_EDGE,
        GAME_WIDTH - right + PLATE_EDGE);
    }
    return out;
  }

  update(): void {
    if (itemArtEpoch() !== this.artEpoch) this.build();
    this.registerFocus();
    if (this.confirmKind) { this.updateConfirmHover(); return; }
    if (this.revealFrame < this.revealLength()) {
      this.revealFrame++;
      this.build();
    }
  }

  private registerFocus(): void {
    const confirm = !!this.confirmKind;
    if (this.okHit && (confirm || this.ok)) focusable(...this.okHit);
    if (this.discardHit && (confirm || (this.discardBtn && !this.revealOnly))) {
      focusable(...this.discardHit, { back: confirm || this.mode !== "reward" });
    }
  }

  private revealLength(): number {
    if (this.item === null || this.errorState()) return 0;
    const kind = classify(this.item);
    return kind === "gun" || kind === "perk" ? BOX_TWEEN_FRAMES : UNLOCK_OK_AT;
  }

  click(): boolean {
    if (!this.isOpen) return false;
    if (this.confirmKind) return this.clickConfirm();
    if (this.mode !== "reward") return this.clickTransaction();
    if (this.revealOnly) {
      if (this.ok && this.okHit && hitTest(...this.okHit)) {
        SH.playSound("S_Click");
        this.finish("");
      }
      return true;
    }
    if (this.ok && this.okHit && hitTest(...this.okHit)) {
      const r = takeReward(this.item, this.source);
      SH.playSound(r.ok ? "S_Buy" : "S_Error");
      if (r.ok) this.finish(r.message);
      else {
        this.message = r.message;
        this.build();
      }
      return true;
    }
    if (this.discardBtn && this.discardHit && hitTest(...this.discardHit)) {
      const gain = sellReward(this.item, this.source);
      SH.playSound(gain ? "S_Buy" : "S_Click");
      this.finish(gain ? `Sold for $${UT.addNumCommas(gain)}.` : "Discarded.");
      return true;
    }
    return true;
  }

  private clickTransaction(): boolean {
    if (this.ok && this.okHit && hitTest(...this.okHit)) {
      const item = this.item as InvItem;
      const ok = this.mode === "buy" ? SD.buyStoreItem(item) : SD.sellItem(item);
      SH.playSound(ok ? "S_Buy" : "S_Error");
      if (ok) this.finish(this.mode === "buy" ? "Purchased." : "Sold.");
      else {
        this.message = this.mode === "buy" ? "Cannot buy." : "Cannot sell.";
        this.build();
      }
      return true;
    }
    if (this.discardBtn && this.discardHit && hitTest(...this.discardHit)) {
      SH.playSound("S_Click");
      this.finish("");
      return true;
    }
    return true;
  }

  private clickConfirm(): boolean {
    if (this.discardHit && hitTest(...this.discardHit)) {
      SH.playSound("S_Click");
      this.closeConfirm(false);
      return true;
    }
    if (this.okHit && hitTest(...this.okHit)) {
      if (this.confirmKind === "fire") {
        SH.playSound("S_Error");
        SH.playSound("S_Die1");
      } else if (this.confirmKind === "build") {
        SH.playSound("S_Equip");
      } else {
        SH.playSound("S_Click");
      }
      this.closeConfirm(true);
      return true;
    }
    return true;
  }

  private closeConfirm(ok: boolean): void {
    const cb = this.onConfirm;
    this.confirmKind = null;
    this.confirmPrice = 0;
    this.confirmName = "";
    this.confirmBp = -1;
    this.onConfirm = null;
    this.removeChildren();
    cb?.(ok);
  }

  io(): boolean {
    return this.isOpen && hitTest(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }

  private finish(message: string): void {
    const cb = this.onDone;
    this.item = null;
    this.onDone = null;
    this.message = message;
    this.removeChildren();
    cb?.();
  }

  private build(): void {
    if (!this.isOpen) return;
    if (this.confirmKind) { this.buildConfirm(); return; }
    if (this.mode !== "reward") { this.buildTransaction(); return; }
    this.removeChildren();
    this.ok = null;
    this.discardBtn = null;
    this.artEpoch = itemArtEpoch();
    this.ox = Math.round((GAME_WIDTH - DESIGN_WIDTH) / 2);
    this.oy = Math.round((GAME_HEIGHT - DESIGN_HEIGHT) / 2);
    const dim = new Graphics();
    dim.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    this.addChild(dim);
    this.content = new Container();
    this.content.position.set(this.ox, this.oy);
    this.addChild(this.content);

    const kind = classify(this.item);
    const cardKind = kind === "gun" || kind === "perk";
    let stateName = cardKind ? "get" : "unlock";
    const err = cardKind ? this.errorState() : null;
    if (err) stateName = err;
    const state = UI.get[stateName];
    if (!state) return;
    this.plateLabel = state.plate;
    const plate = imgSprite(UI.img[state.plate]);
    if (UI.img[state.plate]) this.content.addChild(plate);
    for (const s of this.plateWings(UI.img[state.plate])) this.addChildAt(s, 1);

    const place = (name: string) => state.place.find((p) => p.name === name);

    if (cardKind) {
      const p = place("item");
      if (p) {
        const card = this.item as GunInfo | string;
        const v = itemBoxView(card, kind === "gun" ? "open1" : "open3",
                              { tween: this.revealFrame });
        v.position.set(p.m[4], p.m[5]);
        v.scale.set(p.m[0], p.m[3]);
        this.content.addChild(v);
      }
      this.content.addChild(this.title(place("txt_title"), this.getTitle()));
    } else {
      const p = place("item2");
      if (p) {
        const c = this.unlockContainer(kind);
        c.position.set(p.m[4], p.m[5]);
        const k = UNLOCK_POP[Math.min(this.revealFrame, UNLOCK_POP.length - 1)]
          / UNLOCK_POP[UNLOCK_POP.length - 1];
        c.scale.set(p.m[0] * k, p.m[3] * k);
        this.content.addChild(c);
      }
      this.content.addChild(this.title(place("txt_title"), this.unlockTitle(kind)));
      const d = place("txt_desc");
      if (d) {
        const t = itemField(2397, { x: d.m[4], y: d.m[5] });
        t.text = this.unlockDesc(kind);
        this.content.addChild(t);
      }
    }

    if (stateName === "unlock") {
      if (this.revealFrame >= UNLOCK_OK_AT) {
        this.addButton(BTN.okay, stateName, false);
        this.ok = this.lastButton;
      }
    } else if (stateName === "get") {
      this.addButton(BTN.take, stateName, "TAKE");
      this.ok = this.lastButton;
      this.addButton(BTN.sell, stateName, this.sellLabel());
      this.discardBtn = this.lastButton;
    } else {
      this.addButton(BTN.sell, stateName, false);
      this.ok = null;
      this.discardBtn = this.lastButton;
      this.msgTxt = this.liveLabel(this.sellLabel(), this.discardHit);
      this.content.addChild(this.msgTxt);
    }

    if (this.message && stateName === "get") {
      this.msgTxt = this.liveLabel(this.message, null, DESIGN_HEIGHT - 96);
      this.content.addChild(this.msgTxt);
    }
  }

  private buildTransaction(): void {
    this.removeChildren();
    this.ok = null;
    this.discardBtn = null;
    this.msgTxt = null;
    this.artEpoch = itemArtEpoch();
    this.ox = Math.round((GAME_WIDTH - DESIGN_WIDTH) / 2);
    this.oy = Math.round((GAME_HEIGHT - DESIGN_HEIGHT) / 2);
    const dim = new Graphics();
    dim.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    this.addChild(dim);
    this.content = new Container();
    this.content.position.set(this.ox, this.oy);
    this.addChild(this.content);

    const state = UI.get["get"];
    if (!state) return;
    this.plateLabel = state.plate;
    if (UI.img[state.plate]) this.content.addChild(imgSprite(UI.img[state.plate]));
    for (const s of this.plateWings(UI.img[state.plate])) this.addChildAt(s, 1);
    const place = (name: string) => state.place.find((p) => p.name === name);

    const p = place("item");
    if (p) {
      const card = this.item as GunInfo | string;
      const v = itemBoxView(card, card instanceof GunInfo ? "open1" : "open3",
                            { tween: this.revealFrame });
      v.position.set(p.m[4], p.m[5]);
      v.scale.set(p.m[0], p.m[3]);
      this.content.addChild(v);
    }
    this.content.addChild(this.title(place("txt_title"), this.transactionTitle()));

    this.addButton(BTN.take, "get", this.mode === "buy" ? "BUY" : "SELL");
    this.ok = this.lastButton;
    this.addButton(BTN.sell, "get", "CANCEL");
    this.discardBtn = this.lastButton;

    if (this.message) {
      this.msgTxt = this.liveLabel(this.message, null, DESIGN_HEIGHT - 96);
      this.content.addChild(this.msgTxt);
    }
  }

  private buildConfirm(): void {
    this.removeChildren();
    this.ok = null;
    this.discardBtn = null;
    this.msgTxt = null;
    this.okHit = null;
    this.discardHit = null;
    this.hoverGlow = new Graphics();
    this.artEpoch = itemArtEpoch();
    this.ox = Math.round((GAME_WIDTH - DESIGN_WIDTH) / 2);
    this.oy = Math.round((GAME_HEIGHT - DESIGN_HEIGHT) / 2);
    const dim = new Graphics();
    dim.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    this.addChild(dim);
    this.content = new Container();
    this.content.position.set(this.ox, this.oy);
    this.addChild(this.content);

    const hiring = this.confirmKind === "hire";
    const building = this.confirmKind === "build";
    const stateName = building ? "build"
      : hiring ? (this.confirmPrice > SD.funds ? "hireError" : "hire")
        : "fire";
    const state = UI.get[stateName];
    if (!state) return;
    this.plateLabel = state.plate;
    if (UI.img[state.plate]) this.content.addChild(imgSprite(UI.img[state.plate]));
    for (const s of this.plateWings(UI.img[state.plate])) this.addChildAt(s, 1);
    const place = (name: string) => state.place.find((p) => p.name === name);

    const field = (name: string, cid: number, text: string): void => {
      const p = place(name);
      const t = itemField(cid, p ? { x: p.m[4], y: p.m[5] } : { x: 0, y: 0 });
      t.text = text;
      this.content.addChild(t);
    };
    if (building) {
      const p = place("item2");
      const stats = Guns.itemAr[this.confirmBp];
      if (p && stats) {
        const c = containerView("blueprint", {
          blueprint: { id: stats.id, num: this.confirmBp, notFound: false },
        });
        c.position.set(p.m[4], p.m[5]);
        c.scale.set(p.m[0], p.m[3]);
        this.content.addChild(c);
      }
      field("txt_title", 2382, stats
        ? `Build ${Guns.getGunType(stats.type)} for `
          + `$${UT.addNumCommas(this.confirmPrice)}?`
        : "");
    } else if (hiring) {
      field("txt_title", 2401,
        `Hire a new hero for $${UT.addNumCommas(this.confirmPrice)}?`);
      field("txt_desc", 2402, "(You can only hire 5 heroes per day)");
    } else {
      field("txt_title", 2405, `Dismiss ${this.confirmName}?`);
      field("txt_desc", 2406, `Really dismiss ${this.confirmName}?\n`
        + "This hero and their equipment will be gone forever.");
    }
    this.content.addChild(this.hoverGlow);

    const rect = (name: string): [number, number, number, number] | null => {
      const p = place(name);
      return p ? [p.m[4] + this.ox, p.m[5] + this.oy, 50 * p.m[0], 50 * p.m[3]]
        : null;
    };
    this.okHit = rect(building ? "bt_build" : hiring ? "bt_hire" : "bt_fire");
    this.discardHit = rect("bt_cancel");
  }

  private updateConfirmHover(): void {
    this.hoverGlow.clear();
    const wash = (rect: [number, number, number, number] | null): void => {
      if (!rect || !hitTest(...rect)) return;
      this.hoverGlow.rect(rect[0] - this.ox, rect[1] - this.oy, rect[2], rect[3])
        .fill({ color: 0xffffff, alpha: 0.12 });
    };
    wash(this.okHit);
    wash(this.discardHit);
  }

  private transactionTitle(): string {
    const item = this.item as InvItem;
    const type = item instanceof GunInfo
      ? Guns.getGunType(item.stats.type)
      : Guns.getGunType(Perks.getGunType(item as string));
    const price = this.mode === "buy" ? SD.priceOf(item) : SD.sellPriceOf(item);
    return `${this.mode === "buy" ? "Buy" : "Sell"} ${type} for $${UT.addNumCommas(price)}?`;
  }

  private content = new Container();
  private lastButton: ArtButton | null = null;

  private addButton(
    key: string, stateName: string, liveLabel: string | boolean,
  ): void {
    const state = UI.get[stateName];
    const p = state?.place.find((q) => q.name === key);
    if (!p) { this.lastButton = null; return; }
    const sx = p.m[0], sy = p.m[3];
    const btn = new ArtButton(2087, p.m[4], p.m[5], sx, sy);
    this.content.addChild(btn);
    this.lastButton = btn;
    const rect: [number, number, number, number] =
      [p.m[4] + this.ox, p.m[5] + this.oy, 50 * sx, 50 * sy];
    if (key === BTN.take) this.okHit = rect;
    else if (key === BTN.sell) this.discardHit = rect;
    else if (key === BTN.okay) this.okHit = rect;
    if (typeof liveLabel === "string") {
      const t = this.liveLabel(liveLabel, rect);
      this.content.addChild(t);
    }
  }

  private liveLabel(
    str: string, rect: [number, number, number, number] | null, y = 0,
  ): Text {
    const t = new Text({
      roundPixels: true,
      text: str,
      style: {
        fontFamily: ["QTypeSquare-Bold", "Verdana", "sans-serif"],
        fontSize: 15,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    t.anchor.set(0.5);
    if (rect) t.position.set(rect[0] + rect[2] / 2 - this.ox, rect[1] + rect[3] / 2 - this.oy);
    else t.position.set(DESIGN_WIDTH / 2, y);
    return t;
  }

  private title(
    p: { m: number[] } | undefined, text: string,
  ): Text {
    const cid = this.plateLabel === "gi_unlock" ? 2396 : 2382;
    const t = itemField(cid, p ? { x: p.m[4], y: p.m[5] } : { x: 0, y: 0 });
    t.text = text;
    return t;
  }

  private sellLabel(): string {
    if (!canSell(this.item)) return "DISCARD";
    return `SELL $${UT.addNumCommas(SD.sellPriceOf(this.item))}`;
  }

  private getTitle(): string {
    if (this.item instanceof GunInfo) {
      return `${Guns.getGunType(this.item.stats.type)} Acquired!`;
    }
    return `${Guns.getGunType(Perks.getGunType(this.item as string))} Acquired!`;
  }

  private unlockTitle(kind: string): string {
    switch (kind) {
      case "blueprint": {
        const g = Guns.itemOb[this.item as string];
        return `${Guns.getGunType(g.type)} blueprint Acquired!`;
      }
      case "gold":
        return `$${UT.addNumCommas(this.item as number)} earned!`;
      case "class":
        return `New Class: ${Classes.itemOb[this.item as string].name}!`;
      case "uniqueClass": {
        const id = (this.item as string).replace(/^\$/, "");
        return `Unique Hero: ${Classes.itemOb[id].name}!`;
      }
      case "uniqueHero":
      case "hiredHero":
        return `${(this.item as UnitInfo).name} recruited!`;
      default:
        return "Base Expanded!";
    }
  }

  private unlockDesc(kind: string): string {
    switch (kind) {
      case "blueprint":
        return "Build this blueprint in the Workshop to unlock it in the "
          + "store, slot machine, and as random rewards!";
      case "gold":
        return "You've earned some Funds! You can use them to build "
          + "blueprints, recruit heroes, or buy/upgrade weapons!";
      case "class": {
        const c = Classes.itemOb[this.item as string];
        return `${c.name}s can now be randomly recruited from the Heroes menu! ${c.desc}`;
      }
      case "uniqueClass": {
        const id = (this.item as string).replace(/^\$/, "");
        const c = Classes.itemOb[id];
        return `A Unique ${c.name} is waiting to be recruited! Recruit a new `
          + "Hero to gain this special Unique Hero!";
      }
      case "uniqueHero": {
        const u = this.item as UnitInfo;
        return `${u.name} is a Unique Hero. As one of the best Heroes in the `
          + `world, ${u.name} will fight by your side.`;
      }
      case "hiredHero": {
        const u = this.item as UnitInfo;
        const c = Classes.itemOb[u.cls];
        return `Recruited ${u.name}, the ${c.name}. ${c.desc}`;
      }
      default:
        return "You are now able to visit the store, play the slot machine "
          + "and can upgrade and enhance your weapons!";
    }
  }

  private unlockContainer(kind: string): Container {
    switch (kind) {
      case "blueprint": {
        const id = this.item as string;
        return containerView("blueprint", {
          blueprint: { id, num: Guns.itemOb[id].i, notFound: false },
        });
      }
      case "gold":
        return containerView("gold");
      case "class":
        return containerView("class", { classId: this.item as string });
      case "uniqueClass":
        return containerView("class3", {
          classId: (this.item as string).replace(/^\$/, ""),
        });
      case "uniqueHero":
        return containerView("class3", {
          classId: (this.item as UnitInfo).cls,
        });
      case "hiredHero":
        return containerView("class", { classId: (this.item as UnitInfo).cls });
      default:
        return containerView("features");
    }
  }

  private errorState(): string | null {
    if (!this.message) return null;
    if (this.message.startsWith("Inventory full")) return "error1";
    if (this.message.startsWith("Cannot be stored")) return "error3";
    return null;
  }
}
