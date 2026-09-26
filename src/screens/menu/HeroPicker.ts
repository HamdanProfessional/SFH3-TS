import { Container, Sprite, Texture } from "pixi.js";
import { hitTest, localMouseY } from "../../ui/kit";
import { MenuPicker } from "../../assets/MenuPicker";
import { partTexture, partsEpoch } from "../../assets/menuParts";
import { MenuFigure } from "../../menu/MenuFigure";
import type { UnitInfo } from "../../game/UnitInfo";

const PAGE_TOP = 64;

export interface PickerCard {
  hero: UnitInfo | null;
  frame: number;
  selected: boolean;
  dim: boolean;
  clickable: boolean;
}

export interface HeroPickerOptions {
  label: "heroes" | "deploy";
  state(i: number): PickerCard;
  onPick(i: number): void;
  onHover(i: number): void;
}

export function deployCardState(
  hero: UnitInfo | null, i: number, squad: readonly number[], tempX: number,
): PickerCard {
  if (!hero) {
    return { hero: null, frame: 1, selected: false, dim: false, clickable: false };
  }
  const inSquad = squad.indexOf(i) !== -1;
  const isSlotHero = tempX !== -1 && squad[tempX] === i;
  return {
    hero,
    frame: Math.max(1, Math.min(4, Math.ceil(hero.status / 100))),
    selected: isSlotHero,
    dim: inSquad && !isSlotHero,
    clickable: !inSquad && !isSlotHero,
  };
}

export function pickResult(
  squad: readonly number[], tempX: number, i: number,
): { squad: number[]; tempX: number; selHero: number } {
  const next = squad.slice();
  if (tempX >= 0) next[tempX] = i;
  return { squad: next, tempX: -1, selHero: i };
}

export function changeToggle(tempX: number, i: number): number {
  return tempX === i ? -1 : i;
}

export function heroesCardState(
  heroes: readonly UnitInfo[], i: number, selHero: number, canHire: boolean,
): PickerCard {
  const hero = heroes[i] ?? null;
  if (!hero) {
    const plus = i === heroes.length && canHire;
    return { hero: null, frame: plus ? 5 : 1, selected: false, dim: false,
             clickable: plus };
  }
  return {
    hero,
    frame: Math.max(1, Math.min(4, Math.ceil(hero.status / 100))),
    selected: i === selHero,
    dim: false,
    clickable: i !== selHero,
  };
}

interface CardView {
  root: Container;
  art: Sprite;
  head: MenuFigure;
  heroRef: UnitInfo | null;
  cls: Sprite;
  clsId: string;
  selected: Sprite;
  newskill: Sprite;
  hover: Sprite;
}

export class HeroPicker {
  readonly view = new Container();
  y: number;
  private targetY: number;
  private cards: CardView[] = [];
  private ring = -1;
  private reported = -1;
  private artEpoch = -1;
  private tray: Sprite | null = null;

  constructor(private readonly o: HeroPickerOptions) {
    const deck = MenuPicker.deck;
    this.y = deck.place[o.label].y;
    this.targetY = deck.homeY[o.label];
    this.view.position.set(deck.place[o.label].x, this.y - PAGE_TOP);

    const tray = MenuPicker.tray(o.label === "heroes" ? 1 : 2);
    if (tray) {
      const sp = new Sprite();
      MenuPicker.applyRec(sp, tray);
      this.view.addChild(sp);
      this.tray = sp;
    }

    for (let i = 0; i < deck.count; i++) {
      const root = new Container();
      root.position.set(deck.firstX + i * deck.step, deck.firstY);
      this.view.addChild(root);

      const art = new Sprite();
      root.addChild(art);

      const head = new MenuFigure();
      root.addChild(head.view);

      const cls = new Sprite();
      const c = MenuPicker.iconMatrix;
      cls.position.set(c[4], c[5]);
      cls.visible = false;
      root.addChild(cls);

      const selected = new Sprite();
      MenuPicker.applyRec(selected, MenuPicker.selected);
      selected.position.set(MenuPicker.selected.m[4], MenuPicker.selected.m[5]);
      selected.visible = false;
      root.addChild(selected);

      const newskill = new Sprite();
      MenuPicker.applyRec(newskill, MenuPicker.newskill);
      newskill.position.set(MenuPicker.newskill.m[4], MenuPicker.newskill.m[5]);
      newskill.visible = false;
      root.addChild(newskill);

      const hover = new Sprite();
      const bt = MenuPicker.button;
      hover.position.set(bt.offX, bt.offY);
      hover.width = bt.w;
      hover.height = bt.h;
      hover.visible = false;
      root.addChild(hover);

      this.cards.push({
        root, art, head, heroRef: null, cls, clsId: "", selected, newskill,
        hover,
      });
    }
    this.refresh();
  }

  setOpen(open: boolean): void {
    const deck = MenuPicker.deck;
    this.targetY = open ? deck.openY : deck.homeY[this.o.label];
    if (open && this.reported !== -1) {
      this.reported = -1;
    }
  }

  refresh(): void {
    for (let i = 0; i < this.cards.length; i++) this.applyCard(i, this.o.state(i));
  }

  private applyCard(i: number, st: PickerCard): void {
    const c = this.cards[i];
    const rec = MenuPicker.card(st.frame);
    if (rec) MenuPicker.applyRec(c.art, rec);
    MenuPicker.applyRec(c.selected, MenuPicker.selected);
    c.selected.position.set(MenuPicker.selected.m[4], MenuPicker.selected.m[5]);
    MenuPicker.applyRec(c.newskill, MenuPicker.newskill);
    c.newskill.position.set(MenuPicker.newskill.m[4], MenuPicker.newskill.m[5]);
    c.root.visible = st.hero !== null || st.frame === 5;
    c.root.alpha = st.dim ? 0.3 : 1;

    const hero = st.hero;
    if (hero && c.heroRef !== hero) {
      c.head.setHeadOnly(hero, MenuPicker.headMatrix);
      c.heroRef = hero;
    }
    c.head.view.visible = !!hero;

    if (hero) {
      if (c.clsId !== hero.cls) {
        const icon = MenuPicker.classIcon(hero.cls);
        if (icon) MenuPicker.applyRec(c.cls, icon,
          MenuPicker.iconMatrix[0], MenuPicker.iconMatrix[3]);
        c.clsId = hero.cls;
      }
      c.cls.visible = true;
      c.newskill.visible = hero.hasUpgrade >= 0 || hero.hasLevel;
    } else {
      c.cls.visible = false;
      c.newskill.visible = false;
    }
    c.selected.visible = st.selected;
    c.hover.visible = i === this.ring && st.clickable;
  }

  update(dt: number): number {
    const deck = MenuPicker.deck;
    if (partsEpoch() !== this.artEpoch) {
      this.artEpoch = partsEpoch();
      if (this.tray) {
        const tr = MenuPicker.tray(this.o.label === "heroes" ? 1 : 2);
        if (tr) MenuPicker.applyRec(this.tray, tr);
      }
      for (const c of this.cards) {
        c.heroRef = null;
        c.clsId = "";
      }
      this.refresh();
    }
    for (const c of this.cards) {
      if (c.heroRef) c.head.setHeadOnly(c.heroRef, MenuPicker.headMatrix);
    }

    const k = 1 - Math.pow(0.7, Math.max(0, dt) * 30);
    this.y += (this.targetY - this.y) * k;
    this.view.position.y = this.y - PAGE_TOP;
    this.view.visible = this.y < 590;

    let hover = -1;
    const deckX = this.view.x;
    const deckY = this.view.y;
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (!c.root.visible) continue;
      if (!this.o.state(i).clickable) continue;
      const x = deckX + deck.firstX + i * deck.step + MenuPicker.button.offX;
      const y = deckY + deck.firstY + MenuPicker.button.offY;
      if (hitTest(x, y, MenuPicker.button.w, MenuPicker.button.h)) {
        hover = i;
        break;
      }
    }
    if (this.y > deck.openY + 40) hover = -1;

    let next = this.reported;
    if (hover >= 0) next = hover;
    else if (localMouseY() < this.view.y + deck.firstY - 10) next = -1;
    if (next !== this.reported) {
      this.reported = next;
      this.o.onHover(next);
    }
    if (hover !== this.ring) {
      this.ring = hover;
      const file = MenuPicker.button.states.over;
      const tex = file ? partTexture({ file, w: 0, h: 0, ox: 0, oy: 0 }) : Texture.EMPTY;
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i];
        c.hover.texture = tex;
        if (tex !== Texture.EMPTY) {
          c.hover.width = MenuPicker.button.w;
          c.hover.height = MenuPicker.button.h;
        }
        c.hover.visible = i === hover && tex !== Texture.EMPTY;
      }
    }
    return hover;
  }

  hoverIndex(): number {
    return this.ring;
  }

  pick(): boolean {
    if (this.ring < 0) return false;
    this.o.onPick(this.ring);
    return true;
  }
}
