import { ColorMatrixFilter, Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { MenuPage, type PageHost } from "./MenuPage";
import { focusable, hitTest } from "../../ui/kit";
import { ArtButton, itemOf } from "../../ui/art";
import { MenuRig, type InfoField, type InfoRec, type TexRec } from "../../assets/MenuRig";
import { MenuFigure } from "../../menu/MenuFigure";
import { animLabelFor, gunNameFor, makeHeroFigure } from "../../menu/heroFigure";
import { HeroPicker, changeToggle, deployCardState, pickResult, type PickerCard } from "./HeroPicker";
import { PartButton, partsEpoch } from "../../assets/menuParts";
import { MenuExtras, EXTRAS_SCALE, type ExtraRec } from "../../ui/menuExtras";
import infoButtons from "../../assets/menuInfoButtons.json";
import { SD } from "../../state/SD";
import { SH } from "../../audio/SH";
import { MatchSettings, squadSizeFor } from "../../game/MatchSettings";
import type { UnitInfo } from "../../game/UnitInfo";
import * as Missions from "../../data/StatsMissions";
import * as Classes from "../../data/StatsClasses";

const MAX_SLOTS = 5;
const PAGE_TOP = 64;
const CHAR: readonly [number, number][] = [
  [397.1, 454.0], [260.1, 439.7], [535.6, 439.7], [125.85, 431.3], [663.4, 431.3],
];
const CHAR_SCALE: readonly number[] = [2.75, 2.5, 2.5, 2.2916, 2.2499];
const INFO: readonly [number, number][] = [
  [329.35, 419.3], [177.35, 419.3], [481.35, 419.3], [25.35, 419.3], [633.3, 419.3],
];
const INFO_Y = 419.3;
const INFO_Y_HOME = 415;
const INFO_Y_OPEN = 395;
const START_Y_HOME = 532;
const START_Y_OPEN = 607;
const CODE = { x: 21.4, y: 81.3 };
const COPY_HIT: readonly [number, number, number, number] = [
  CODE.x + 4.6, CODE.y + 0.45, 50 * 2.3013, 50 * 0.3868,
];
const CODE_TXT = { x: CODE.x + 122.6, y: CODE.y + 3.0, size: 14 };
const CODE_BAR_RIGHT = CODE.x + 626.2;

const BAND_COLOR: Readonly<Record<string, number>> = {
  active: 0x00ff66, tired: 0xffcc33, injured: 0xff6600, critical: 0xff3300,
};

const INFO_BTN = infoButtons as unknown as {
  cid: number;
  states: Partial<Record<"up" | "over" | "down", string>>;
  place: Record<string, Record<string, { cid: number; m: number[] }>>;
  offX: number; offY: number; w: number; h: number;
};

function legacyCopy(code: string): void {
  if (typeof document === "undefined") return;
  const el = document.createElement("textarea");
  el.value = code;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
  } catch {
  }
  el.remove();
}

function mcTransform(r: number, g: number, b: number, a = 1): ColorMatrixFilter {
  const f = new ColorMatrixFilter();
  f.matrix = [
    r, 0, 0, 0, 0,
    0, g, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, a, 0,
  ];
  return f;
}

interface SlotView {
  root: Container;
  fig: MenuFigure | null;
  card: Sprite | null;
  cardRec: InfoRec | null;
  texts: Text[];
  bar: Sprite | null;
  barRec: TexRec | null;
  change: PartButton | null;
  remove: PartButton | null;

}

export class DeployPage extends MenuPage {
  private start: ArtButton | null = null;
  private back: ArtButton | null = null;
  private picker: HeroPicker | null = null;
  private figuresLayer = new Container();
  private cardsLayer = new Container();
  private slots: SlotView[] = [];

  private built = false;
  private artEpoch = -1;
  private tempX = -1;
  private tempY = -1;
  private infoY: number[] = [];
  private startY = START_Y_HOME;
  private codeTxt: Text | null = null;
  private codeArt: Sprite | null = null;
  private codeRec: ExtraRec | null = null;
  private dimFilter = mcTransform(0.5, 0.5, 0.5);
  private ghostFilter = mcTransform(1, 1, 3, 0.7);

  constructor(host: PageHost) {
    super(host);
  }

  build(w: number, h: number): void {
    const size = this.computeSize();
    while (SD.squad.length < size) SD.squad.push(-1);
    SD.squad.length = size;
    if (this.tempX >= size) this.tempX = -1;
    for (let i = 0; i < SD.squad.length; i++) {
      if (SD.squad[i] >= SD.heroes.length) SD.squad[i] = -1;
    }
    this.tempY = -1;
    this.infoY = [];
    for (let i = 0; i < MAX_SLOTS; i++) this.infoY.push(INFO_Y);
    this.startY = START_Y_HOME;
    this.artEpoch = -1;

    this.view.addChild(this.figuresLayer);
    this.view.addChild(this.cardsLayer);

    const st = itemOf("deploy", "bt_start");
    if (st) {
      this.start = new ArtButton(st.cid, st.x, st.y - PAGE_TOP, st.sx, st.sy);
      this.start.position.y = this.startY - PAGE_TOP;
      this.view.addChild(this.start);
    }
    const bk = itemOf("deploy", "bt_back");
    if (bk) {
      this.back = new ArtButton(bk.cid, bk.x, bk.y - PAGE_TOP, bk.sx, bk.sy);
      this.view.addChild(this.back);
    }

    const showCode = SD.stages.length > 3;
    this.codeArt = new Sprite();
    this.codeRec = MenuExtras.squadCode();
    if (this.codeRec) {
      this.codeArt.anchor.set(0, 0);
      this.codeArt.scale.set(1 / EXTRAS_SCALE);
      this.codeArt.position.set(CODE.x - this.codeRec.ox,
                                CODE.y - this.codeRec.oy - PAGE_TOP);
      this.codeArt.texture = MenuExtras.texture(this.codeRec);
    }
    this.codeArt.visible = showCode;
    this.view.addChild(this.codeArt);

    this.codeTxt = new Text({
      roundPixels: true,
      text: "",
      style: new TextStyle({
        fontFamily: ["QTypeSquare-Book", "Verdana", "sans-serif"],
        fontSize: CODE_TXT.size,
        fill: 0x000000,
      }),
    });
    this.codeTxt.position.set(CODE_TXT.x, CODE_TXT.y - PAGE_TOP);
    const codeMask = new Graphics();
    codeMask.rect(CODE_TXT.x, CODE.y - PAGE_TOP,
      CODE_BAR_RIGHT - CODE_TXT.x, 18).fill({ color: 0xffffff });
    this.view.addChild(codeMask);
    this.codeTxt.mask = codeMask;
    this.codeTxt.visible = showCode;
    this.view.addChild(this.codeTxt);

    this.picker = new HeroPicker({
      label: "deploy",
      state: (i) => this.cardState(i),
      onPick: (i) => this.pickHero(i),
      onHover: (i) => this.hoverHero(i),
    });
    this.view.addChild(this.picker.view);

    this.rebuildSlots();
    this.refreshCode();
    this.built = true;
    void w;
    void h;
  }

  private refreshCode(): void {
    try {
      SD.createSquadCode();
    } catch {
      SD.squadCode = "";
    }
    if (this.codeTxt) this.codeTxt.text = SD.squadCode;
  }

  private copyCode(): void {
    const code = SD.squadCode;
    if (!code) return;
    void navigator.clipboard?.writeText(code).catch(() => legacyCopy(code));
    if (!navigator.clipboard) legacyCopy(code);
  }

  private computeSize(): number {
    const m = this.currentMission();
    if (MatchSettings.matchType === 1 || !m) {
      return Math.max(1, Math.min(MAX_SLOTS, squadSizeFor(MatchSettings.qmMode)));
    }
    return Math.max(1, Math.min(MAX_SLOTS, m.team1));
  }

  private currentMission(): Missions.Mission | null {
    if (MatchSettings.matchType === 0) return Missions.getMission(SD.curStage);
    if (MatchSettings.matchType === 2) return Missions.daily;
    return null;
  }

  private cardState(i: number): PickerCard {
    return deployCardState(SD.heroes[i] ?? null, i, SD.squad, this.tempX);
  }

  private pickHero(i: number): void {
    if (this.tempX === -1) return;
    SH.playSound("S_Empty");
    const r = pickResult(SD.squad, this.tempX, i);
    SD.squad = r.squad;
    this.tempX = r.tempX;
    this.tempY = -1;
    SD.selHero = r.selHero;
    this.refreshState();
  }

  private hoverHero(i: number): void {
    if (this.tempX === -1) return;
    if (i !== this.tempY) {
      this.tempY = i;
      this.refreshState();
    }
  }

  private refreshState(): void {
    this.picker?.setOpen(this.tempX !== -1);
    this.picker?.refresh();
    this.rebuildSlots();
    this.refreshCode();
  }

  private rebuildSlots(): void {
    for (const s of this.slots) {
      s.fig?.destroy();
      s.root.destroy({ children: true });
    }
    this.figuresLayer.removeChildren();
    this.cardsLayer.removeChildren();
    this.slots = [];
    for (let i = 0; i < MAX_SLOTS; i++) this.buildFigure(i);
    for (let i = 0; i < MAX_SLOTS; i++) this.buildCard(i);
  }

  private slotHero(i: number): UnitInfo | null {
    if (i === this.tempX && this.tempY !== -1) return SD.heroes[this.tempY] ?? null;
    const idx = SD.squad[i] ?? -1;
    return idx >= 0 ? SD.heroes[idx] ?? null : null;
  }

  private buildFigure(i: number): void {
    const hero = this.slotHero(i);
    const slot: SlotView = {
      root: new Container(), fig: null,
      card: null, cardRec: null, texts: [], bar: null, barRec: null,
      change: null, remove: null,
    };
    if (hero) {
      const fig = makeHeroFigure(hero);
      fig.view.position.set(CHAR[i][0], CHAR[i][1] - PAGE_TOP);
      fig.view.scale.set(CHAR_SCALE[i] ?? 2.5);
      this.figuresLayer.addChild(fig.view);
      fig.playLabel(animLabelFor(hero));
      slot.fig = fig;
    }
    this.slots.push(slot);
    this.applyFigureLook(i);
  }

  private applyFigureLook(i: number): void {
    const slot = this.slots[i];
    if (!slot.fig) return;
    const changing = this.tempX !== -1;
    if (changing && i !== this.tempX) {
      slot.fig.view.filters = [this.dimFilter];
    } else if (changing && i === this.tempX && this.tempY !== -1) {
      slot.fig.view.filters = [this.ghostFilter];
    } else {
      slot.fig.view.filters = [];
    }
  }

  private buildCard(i: number): void {
    const slot = this.slots[i];
    const occupied = SD.squad[i] !== -1;
    const previewing = this.tempX === i && this.tempY !== -1;
    const empty = !occupied && !previewing;
    const state = empty ? (i === 0 ? 4 : 3) : (i === this.tempX ? 2 : 1);
    const hero = this.slotHero(i);

    const root = new Container();
    root.position.set(INFO[i][0], this.infoY[i] - PAGE_TOP);
    if (this.tempX !== -1 && i !== this.tempX) root.alpha = 0.5;
    this.cardsLayer.addChild(root);
    slot.root = root;

    const rec = MenuRig.info(state);
    if (rec) {
      const card = new Sprite(MenuRig.texture(rec));
      card.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
      root.addChild(card);
      slot.card = card;
      slot.cardRec = rec;
    }

    const texts: Text[] = [];
    let bar: Sprite | null = null;
    if (!empty && hero && rec) {
      const band = Classes.getStatusBand(hero.status);
      const fields = rec.fields;
      const color = BAND_COLOR[band.anim === "idle" ? "active" : band.anim];
      const bonus = i === 0 && hero.status > 300
        ? "Captain: +15% Stats"
        : band.info;

      const add = (key: string, value: string, fill?: number): void => {
        const f = fields[key];
        if (!f || !f.spec || !value) return;
        const t = this.fieldText(f, value, fill);
        texts.push(t);
        root.addChild(t);
      };
      add("txt_name", hero.name);
      add("txt_primary", gunNameFor(hero, "primary"));
      add("txt_secondary", gunNameFor(hero, "secondary"));
      add("txt_lvl", `Lv ${hero.level}`);
      add("txt_status", band.label, color);
      add("txt_bonus", bonus, color);

      const barRec = MenuRig.bar;
      const bf = fields.bar;
      if (barRec && bf) {
        bar = new Sprite(MenuRig.texture(barRec));
        bar.anchor.set(barRec.ox / (barRec.w || 1), barRec.oy / (barRec.h || 1));
        bar.position.set(bf.x, bf.y);
        root.addChild(bar);
        slot.barRec = barRec;
      }
    }

    const place = INFO_BTN.place[String(state)];
    if (place?.bt_change) {
      const btn = this.makeCardButton(place.bt_change.m);
      root.addChild(btn);
      slot.change = btn;
    }
    if (place?.bt_remove) {
      const btn = this.makeCardButton(place.bt_remove.m);
      root.addChild(btn);
      slot.remove = btn;
    }

    slot.texts = texts;
    slot.bar = bar;
  }

  private makeCardButton(m: number[]): PartButton {
    const btn = new PartButton(INFO_BTN, m[4], m[5]);
    btn.scale.set(m[0], m[3]);
    return btn;
  }

  private fieldText(f: InfoField, value: string, fill?: number): Text {
    const spec = f.spec ?? {};
    const align = spec.align ?? "left";
    const t = new Text({
      roundPixels: true,
      text: value,
      style: new TextStyle({
        fontFamily: [spec.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
        fontSize: spec.size ?? 12,
        fill: fill ?? spec.color ?? 0xffffff,
        align: align === "justify" ? "left" : (align as "left" | "center" | "right"),
      }),
    });
    const bx = f.x + (spec.x ?? 0);
    const by = f.y + (spec.y ?? 0);
    const bw = spec.w ?? 0;
    if (align === "center") {
      t.anchor.set(0.5, 0);
      t.position.set(bx + bw / 2, by);
    } else if (align === "right") {
      t.anchor.set(1, 0);
      t.position.set(bx + bw, by);
    } else {
      t.position.set(bx, by);
    }
    return t;
  }

  update(dt: number): void {
    if (!this.built) return;

    if (this.start) {
      const stages = SD.stages.length;
      this.start.visible = (SD.squad[0] ?? -1) !== -1
        && !(stages === 2 && ((SD.squad[1] ?? -1) === -1));
    }

    const open = this.tempX !== -1;
    const targets: [number, number] = open
      ? [INFO_Y_OPEN, START_Y_OPEN] : [INFO_Y_HOME, START_Y_HOME];
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (this.slots[i]?.card || this.slots[i]?.texts.length) {
        this.infoY[i] += (targets[0] - this.infoY[i]) * 0.3;
      }
    }
    this.startY += (targets[1] - this.startY) * 0.3;
    if (this.start) this.start.position.y = this.startY - PAGE_TOP;

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.fig?.tick();
      if (slot.card && slot.cardRec) slot.card.texture = MenuRig.texture(slot.cardRec);
      if (slot.bar && slot.barRec) {
        slot.bar.texture = MenuRig.texture(slot.barRec);
        const hero = this.slotHero(i);
        const f = 6;
        const bf = MenuRig.info(1)?.fields.bar;
        const frac = hero && bf
          ? Math.max(0, Math.min(1, hero.exp / Classes.getNextExp(hero.level)))
          : 0;
        slot.bar.scale.set((bf?.sx ?? f) * frac, bf?.sy ?? 0.2348);
      }
      slot.change?.update();
      slot.remove?.update();
      slot.root.position.y = this.infoY[i] - PAGE_TOP;
      for (const b of [slot.change, slot.remove]) {
        if (b) b.setState(this.hitBut(b) ? "over" : "up");
      }
      this.applyFigureLook(i);
    }

    this.picker?.update(dt);

    if (partsEpoch() !== this.artEpoch) {
      this.artEpoch = partsEpoch();
      for (const slot of this.slots) {
        if (slot.card && slot.cardRec) slot.card.texture = MenuRig.texture(slot.cardRec);
      }
    }
    if (this.codeArt && this.codeRec) {
      this.codeArt.texture = MenuExtras.texture(this.codeRec);
    }
    for (const b of [this.start, this.back]) {
      if (!b) continue;
      const [x, y, w, h] = b.hitBox();
      b.setState(hitTest(x, y, w, h) ? "over" : "up");
      if (b === this.back) focusable(x, y, w, h, { back: true });
    }
    for (let i = 0; i < SD.squad.length; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      for (const b of [slot.remove, slot.change]) {
        if (!b?.visible || !slot.root.visible) continue;
        const [x, y, w, h] = b.hitBox();
        focusable(x + slot.root.x, y + slot.root.y, w, h);
      }
    }
    if (SD.stages.length > 3) focusable(COPY_HIT[0], COPY_HIT[1] - PAGE_TOP, COPY_HIT[2], COPY_HIT[3]);
  }

  private hitBut(b: PartButton | null, card: Container | null = null): boolean {
    if (!b) return false;
    const [x, y, w, h] = b.hitBox();
    const dx = card ? card.x : 0;
    const dy = card ? card.y : 0;
    return hitTest(x + dx, y + dy, w, h);
  }

  onClick(): void {
    const bHit = (b: ArtButton | null): boolean => {
      if (!b) return false;
      const [x, y, w, h] = b.hitBox();
      return hitTest(x, y, w, h);
    };
    if (bHit(this.back)) {
      this.host.goto("missions");
      return;
    }
    if (SD.stages.length > 3
        && hitTest(COPY_HIT[0], COPY_HIT[1] - PAGE_TOP, COPY_HIT[2], COPY_HIT[3])) {
      this.copyCode();
      return;
    }
    for (let i = 0; i < SD.squad.length; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      if (this.hitBut(slot.remove, slot.root)) {
        SH.playSound("S_Die6");
        SD.squad[i] = -1;
        this.refreshState();
        return;
      }
      if (this.hitBut(slot.change, slot.root)) {
        SH.playSound("S_Click");
        this.tempX = changeToggle(this.tempX, i);
        this.tempY = -1;
        this.refreshState();
        return;
      }
    }
    if (this.tempX !== -1) {
      if (this.picker?.pick()) return;
      return;
    }
    if (this.start?.visible && bHit(this.start)) {
      SH.playSound("S_Shot");
      this.host.startMatch();
    }
  }
}
