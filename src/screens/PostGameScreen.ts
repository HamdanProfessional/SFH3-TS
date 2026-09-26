import { Container, Sprite, Text, Texture } from "pixi.js";
import { Screen } from "../core/Screen";
import type { Engine } from "../core/Engine";
import {
  GAME_WIDTH, GAME_HEIGHT, DESIGN_WIDTH, DESIGN_HEIGHT,
} from "../core/Config";
import { Input } from "../core/Input";
import { focusable, hitTest, setHitOrigin } from "../ui/kit";
import {
  PageButton, PlateEdges, bindTex, pageField, refreshTex,
  type PageTextSpec, type PageTex,
} from "./menu/pageArt";
import post from "../assets/postgameUi.json";
import { resolvePostGame, type PostGameResult } from "../state/postGame";
import { SD } from "../state/SD";
import { SH } from "../audio/SH";
import { MenuFigure } from "../menu/MenuFigure";
import { makeHeroFigure } from "../menu/heroFigure";
import { MAX_HERO_LVL, MAX_MISSION } from "../data/StatsMisc";
import { getNextExp, getStatusBand } from "../data/StatsClasses";
import { MatchSettings } from "../game/MatchSettings";
import type { UnitInfo } from "../game/UnitInfo";

export interface PostGameArg {
  won: boolean;
  afterCutscene?: boolean;
}

interface PostUi {
  scale: number;
  plate: { file: string; plateX: number; plateY: number; plateW: number; plateH: number };
  tile: { filled: PageTex; empty: PageTex };
  tilebar: PageTex;
  beam: PageTex;
  ring: Record<string, PageTex>;
  badge: Record<string, PageTex>;
  selected: PageTex;
  newskill: PageTex;
  levelup: Record<string, PageTex>;
  back: {
    states: Partial<Record<"up" | "over" | "down", string>>;
    w: number; h: number; offX: number; offY: number;
    x: number; y: number; sx: number; sy: number;
  };
  fields: Record<string, PageTextSpec>;
  place: Record<string, [number, number, number, number]>;
  alpha: Record<string, number>;
  iconHead: { x: number; y: number; sx: number; sy: number };
  iconClass: { x: number; y: number; sx: number; sy: number };
}

const P = post as unknown as PostUi;
const ICON_HEAD = (P.place as unknown as { icon_head: PostUi["iconHead"] }).icon_head;
const ICON_CLASS = (P.place as unknown as { icon_class: PostUi["iconClass"] }).icon_class;

function tex(rec: PageTex): PageTex {
  return { file: `postgame/${rec.file.replace(/^postgame\//, "")}`, w: rec.w, h: rec.h, ox: rec.ox, oy: rec.oy };
}

export interface TallyRow {
  slot: number;
  hero: number;
  name: string;
  level: number;
  exp: number;
  status: number;
  status1: number;
  turned: boolean;
  addedExp: number;
  remaining: number;
  expSpd: number;
  leveled: boolean;
  scale: number;
}

export class PostGameTally {
  readonly rows: TallyRow[];
  state: "exp" | "funds" | "done" = "exp";
  order = -1;
  barRow = -1;
  funds0: number;
  earnedFunds: number;
  remainingFunds: number;
  fundsSpd = 0;
  tempFunds: number;
  day: number;
  charX = 800;
  charHero: number;
  levelupTimer = 0;
  charLevelup = false;

  constructor(result: PostGameResult) {
    this.funds0 = result.funds0;
    this.tempFunds = result.funds0;
    this.day = result.day0;
    this.earnedFunds = result.tally.reduce((a, r) => a + r.funds, 0);
    this.remainingFunds = this.earnedFunds;
    this.rows = result.tally.map((r) => ({
      slot: r.slot, hero: SD.squad[r.slot] ?? -1, name: r.name,
      level: r.level0, exp: r.exp0, status: r.status0, status1: r.status1,
      turned: false, addedExp: r.addedExp, remaining: r.addedExp,
      expSpd: 0, leveled: false, scale: 1,
    }));
    this.charHero = SD.squad[0] ?? -1;
    this.setNextExpChar();
  }

  private setNextExpChar(): void {
    this.order++;
    if (this.order >= this.rows.length) {
      this.setFunds();
      return;
    }
    const row = this.rows[this.order];
    row.turned = true;
    row.expSpd = row.addedExp / 30;
    this.barRow = row.slot;
  }

  private setFunds(): void {
    this.state = "funds";
    this.day += 1;
    this.fundsSpd = this.earnedFunds / 60;
    this.barRow = 5;
  }

  tick(): void {
    switch (this.state) {
      case "exp": {
        const row = this.rows[this.order];
        if (!row) break;
        let done = false;
        row.remaining -= row.expSpd;
        if (row.remaining <= 0) {
          row.expSpd = -row.remaining;
          done = true;
        }
        row.exp += row.expSpd;
        if (row.level >= MAX_HERO_LVL) {
          row.exp = getNextExp(row.level);
        } else if (row.exp > getNextExp(row.level) && row.level < MAX_HERO_LVL) {
          row.exp -= getNextExp(row.level);
          row.level++;
          row.leveled = true;
          this.onLevelUp(row);
        }
        if (done) this.setNextExpChar();
        break;
      }
      case "funds": {
        let done = false;
        this.remainingFunds -= this.fundsSpd;
        if (this.remainingFunds <= 0) {
          this.fundsSpd = -this.remainingFunds;
          done = true;
        }
        this.tempFunds += this.fundsSpd;
        if (done) {
          this.state = "done";
          this.barRow = -1;
          this.tempFunds = SD.funds;
        }
        break;
      }
      case "done":
        break;
    }
    for (const row of this.rows) row.scale += (1 - row.scale) * 0.1;
    this.charX += (600 - this.charX) * 0.3;
    if (this.levelupTimer > 0) this.levelupTimer++;
  }

  private onLevelUp(row: TallyRow): void {
    this.levelupTimer = 1;
    this.charLevelup = true;
    if (row.hero !== this.charHero) {
      this.charHero = row.hero;
      this.charX = 800;
    }
  }
}

const LEVELUP_FRAMES = Object.keys(P.levelup).length;

interface RowView {
  group: Container;
  tile: Sprite;
  ring: Sprite;
  badge: Sprite;
  selected: Sprite;
  newskill: Sprite;
  head: MenuFigure;
  headHero: number;
  name: Text;
  level: Text;
  status: Text;
  bar: Sprite;
}

export class PostGameScreen extends Screen {
  private root = new Container();
  private plateEdges = new PlateEdges();
  private plate = new Sprite();
  private readonly redirecting: boolean;
  private leaving = false;
  private result: PostGameResult | null = null;
  private tally: PostGameTally | null = null;
  private rows: RowView[] = [];
  private beams: Sprite[] = [];
  private levelupSprite: Sprite | null = null;
  private figure: MenuFigure | null = null;
  private figureHero = -1;
  private backBtn: PageButton | null = null;
  private backTxt: Text | null = null;
  private dayTxt: Text | null = null;
  private fundsTxt: Text | null = null;
  private done = false;

  constructor(engine: Engine, arg?: unknown) {
    super(engine, arg);
    const a = (arg as PostGameArg | undefined) ?? { won: true };
    const won = a.won ?? true;
    const finale = MatchSettings.matchType === 0 && !MatchSettings.sandbox
      && SD.curStage === MAX_MISSION - 1;
    this.redirecting = won && finale && !a.afterCutscene;
    if (!this.redirecting) {
      this.result = resolvePostGame(won);
      this.tally = new PostGameTally(this.result);
      this.build();
    }
    SH.inMatch = false;
    SH.msgTimer = false;
    SH.playMusic("M_Menu");
  }

  private build(): void {
    this.view.addChild(this.root);

    const plate = this.plate;
    bindTex(plate, tex(P.plate as unknown as PageTex));
    plate.width = P.plate.plateW;
    plate.height = P.plate.plateH;
    plate.position.set(P.plate.plateX, P.plate.plateY);
    this.root.addChild(plate);
    this.root.addChild(this.plateEdges);

    this.anchor();
    this.buildRows();
    this.buildChar();
    this.buildFields();
    this.sync();
  }

  private anchor(): void {
    const dx = Math.round((GAME_WIDTH - DESIGN_WIDTH) / 2);
    this.root.position.set(dx, Math.round((GAME_HEIGHT - DESIGN_HEIGHT) / 2));
    this.plateEdges.update(this.plate, DESIGN_WIDTH, dx,
      GAME_WIDTH - DESIGN_WIDTH - dx);
  }

  resize(): void {
    this.anchor();
  }

  private buildRows(): void {
    const F = P.fields;
    const iconAt = P.place.tile_icon;
    const classAt = ICON_CLASS;
    for (let slot = 0; slot < 5; slot++) {
      const place = P.place[`squad${slot}`];
      if (!place) continue;
      const group = new Container();
      group.position.set(place[2], place[3]);
      this.root.addChild(group);

      const tile = new Sprite();
      bindTex(tile, tex(P.tile.empty));
      tile.anchor.set(P.tile.empty.ox / (P.tile.empty.w || 1),
                      P.tile.empty.oy / (P.tile.empty.h || 1));
      tile.scale.set(1 / P.scale);
      tile.visible = false;
      group.addChild(tile);

      const ring = new Sprite();
      bindTex(ring, tex(P.ring["1"]));
      ring.anchor.set(P.ring["1"].ox / (P.ring["1"].w || 1),
                      P.ring["1"].oy / (P.ring["1"].h || 1));
      ring.scale.set(1 / P.scale);
      ring.position.set(iconAt[2], iconAt[3]);
      ring.visible = false;
      group.addChild(ring);

      const badge = new Sprite();
      bindTex(badge, tex(P.badge.eng));
      badge.anchor.set(P.badge.eng.ox / (P.badge.eng.w || 1),
                       P.badge.eng.oy / (P.badge.eng.h || 1));
      badge.scale.set(1 / P.scale);
      badge.position.set(iconAt[2] + classAt.x, iconAt[3] + classAt.y);
      badge.visible = false;
      group.addChild(badge);

      const selected = new Sprite();
      bindTex(selected, tex(P.selected));
      selected.anchor.set(P.selected.ox / (P.selected.w || 1),
                          P.selected.oy / (P.selected.h || 1));
      selected.scale.set(1 / P.scale);
      selected.position.set(iconAt[2], iconAt[3]);
      selected.visible = false;
      group.addChild(selected);

      const newskill = new Sprite();
      bindTex(newskill, tex(P.newskill));
      newskill.anchor.set(P.newskill.ox / (P.newskill.w || 1),
                          P.newskill.oy / (P.newskill.h || 1));
      newskill.scale.set(1 / P.scale);
      newskill.position.set(iconAt[2] + 17.7, iconAt[3] - 16.0);
      newskill.visible = false;
      group.addChild(newskill);

      const head = new MenuFigure();
      head.view.position.set(iconAt[2], iconAt[3]);
      group.addChild(head.view);

      const name = pageField(F.txt_name, { x: P.place.tile_txt_name[2], y: P.place.tile_txt_name[3] }, "");
      group.addChild(name);
      const level = pageField(F.txt_level, { x: P.place.tile_txt_level[2], y: P.place.tile_txt_level[3] }, "");
      group.addChild(level);
      const status = pageField(F.txt_status, { x: P.place.tile_txt_status[2], y: P.place.tile_txt_status[3] }, "");
      group.addChild(status);

      const bar = new Sprite();
      bindTex(bar, tex(P.tilebar));
      bar.anchor.set(0, 0);
      bar.scale.set(1 / P.scale);
      bar.position.set(P.place.tile_bar[2], P.place.tile_bar[3]);
      bar.visible = false;
      group.addChild(bar);

      this.rows.push({
        group, tile, ring, badge, selected, newskill, head, headHero: -2,
        name, level, status, bar,
      });
    }

    for (let i = 0; i < 6; i++) {
      const place = P.place[`bar${i}`];
      const beam = new Sprite();
      bindTex(beam, tex(P.beam));
      beam.anchor.set(0, 0);
      beam.scale.set(1 / P.scale);
      beam.alpha = P.alpha[`bar${i}`] ?? 1;
      beam.position.set(place[2], place[3]);
      beam.width = P.beam.w * place[0];
      beam.height = P.beam.h * place[1];
      beam.visible = false;
      this.root.addChild(beam);
      this.beams.push(beam);
    }

    this.levelupSprite = new Sprite();
    bindTex(this.levelupSprite, tex(P.levelup["1"]));
    this.levelupSprite.anchor.set(P.levelup["1"].ox / (P.levelup["1"].w || 1),
                                  P.levelup["1"].oy / (P.levelup["1"].h || 1));
    this.levelupSprite.scale.set(1 / P.scale);
    this.levelupSprite.position.set(P.place.levelup[2], P.place.levelup[3]);
    this.levelupSprite.visible = false;
    this.root.addChild(this.levelupSprite);

    const back = P.back;
    this.backBtn = new PageButton({ ...back, cid: 2087 }, back.x, back.y);
    this.backBtn.visible = false;
    this.root.addChild(this.backBtn);
    this.backTxt = pageField(P.fields.txt_back,
      { x: P.place.txt_back[2], y: P.place.txt_back[3] }, "CONTINUE");
    this.backTxt.visible = false;
    this.root.addChild(this.backTxt);
  }

  private buildChar(): void {
    const t = this.tally;
    if (!t) return;
    const hero = SD.heroes[t.charHero];
    if (!hero) return;
    this.figureHero = t.charHero;
    this.spawnChar(hero);
  }

  private spawnChar(hero: UnitInfo): void {
    const place = P.place.char;
    const fig = makeHeroFigure(hero);
    fig.setHero(hero, 0, 0);
    fig.playLabel("idle");
    this.figure = fig;
    this.root.addChild(fig.view);
    fig.view.position.set(this.tally?.charX ?? place[2], place[3]);
    fig.view.scale.set(place[0], place[1]);
  }

  private buildFields(): void {
    const F = P.fields;
    const title = pageField(F.txt_title,
      { x: P.place.txt_title[2], y: P.place.txt_title[3] }, "BATTLE RESULTS");
    this.root.addChild(title);
    this.dayTxt = pageField(F.txt_day,
      { x: P.place.txt_day[2], y: P.place.txt_day[3] }, "");
    this.root.addChild(this.dayTxt);
    this.fundsTxt = pageField(F.txt_funds,
      { x: P.place.txt_funds[2], y: P.place.txt_funds[3] }, "");
    this.root.addChild(this.fundsTxt);
  }

  private sync(): void {
    const t = this.tally;
    if (!t) return;
    const scale = 1 / P.scale;

    this.rows.forEach((view, slot) => {
      const row = t.rows.find((r) => r.slot === slot);
      const hero: UnitInfo | undefined = row ? SD.heroes[row.hero] : undefined;
      if (!row || !hero) {
        view.tile.visible = false;
        view.ring.visible = false;
        view.badge.visible = false;
        view.selected.visible = false;
        view.newskill.visible = false;
        view.head.view.visible = false;
        view.bar.visible = false;
        view.name.text = "";
        view.level.text = "";
        view.status.text = "";
        return;
      }

      bindTex(view.tile, tex(P.tile.filled));
      view.tile.anchor.set(P.tile.filled.ox / (P.tile.filled.w || 1),
                           P.tile.filled.oy / (P.tile.filled.h || 1));
      view.tile.scale.set(scale);
      view.tile.visible = true;

      const ringFrame = row.status > 0
        ? Math.min(4, Math.max(1, Math.ceil(row.status / 100))) : 1;
      const ring = P.ring[String(ringFrame)];
      bindTex(view.ring, tex(ring));
      view.ring.anchor.set(ring.ox / (ring.w || 1), ring.oy / (ring.h || 1));
      view.ring.scale.set(scale);
      view.ring.visible = true;

      const badge = P.badge[hero.cls] ?? P.badge.eng;
      bindTex(view.badge, tex(badge));
      view.badge.anchor.set(badge.ox / (badge.w || 1), badge.oy / (badge.h || 1));
      view.badge.position.set(P.place.tile_icon[2] + ICON_CLASS.x,
                              P.place.tile_icon[3] + ICON_CLASS.y);
      view.badge.scale.set(ICON_CLASS.sx * scale, ICON_CLASS.sy * scale);
      view.badge.visible = true;

      if (view.headHero !== row.hero) view.headHero = row.hero;
      view.head.setHeadOnly(hero,
        [ICON_HEAD.sx, 0, 0, ICON_HEAD.sy, ICON_HEAD.x, ICON_HEAD.y]);
      for (const part of view.head.view.children) {
        const sp = part as Sprite;
        sp.visible = sp.texture !== Texture.EMPTY;
      }

      view.name.text = row.name;
      view.level.text = `Lv ${row.level}`;
      const band = getStatusBand(row.turned ? row.status1 : row.status);
      view.status.text = band.label;
      view.status.style.fill = band.color;

      view.selected.visible = row.leveled;
      view.newskill.visible = row.leveled;

      bindTex(view.bar, tex(P.tilebar));
      view.bar.anchor.set(0, 0);
      view.bar.position.set(P.place.tile_bar[2], P.place.tile_bar[3]);
      view.bar.scale.set(1 / P.scale);
      view.bar.height = P.tilebar.h * P.place.tile_bar[1];
      view.bar.width = row.level >= MAX_HERO_LVL
        ? 225
        : Math.max(0, (row.exp / getNextExp(row.level)) * 215);
      view.bar.visible = true;

      view.group.scale.set(row.scale);
    });

    this.beams.forEach((b, i) => {
      b.visible = i === t.barRow;
    });

    this.syncFigure();

    if (this.levelupSprite) {
      const frame = Math.max(1, Math.min(t.levelupTimer, LEVELUP_FRAMES));
      const rec = P.levelup[String(frame)];
      this.levelupSprite.visible = t.levelupTimer > 0 && !!rec;
      if (rec) {
        bindTex(this.levelupSprite, tex(rec));
        this.levelupSprite.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
      }
    }

    if (this.dayTxt) this.dayTxt.text = String(t.day);
    if (this.fundsTxt) {
      this.fundsTxt.text = t.state === "done"
        ? `$${SD.funds}`
        : `$${Math.ceil(t.tempFunds)}    $${Math.ceil(Math.max(0, t.remainingFunds))}`;
    }
    const showBack = t.state === "done";
    if (this.backBtn) {
      this.backBtn.visible = showBack;
      this.backBtn.refresh();
    }
    if (this.backTxt) this.backTxt.visible = showBack;
    refreshTex(this.root);
    this.anchor();
  }

  private syncFigure(): void {
    const t = this.tally;
    if (!t) return;
    const hero = SD.heroes[t.charHero];
    if (!hero) return;
    const place = P.place.char;
    if (t.charHero !== this.figureHero) {
      this.figureHero = t.charHero;
      this.figure?.destroy();
      this.spawnChar(hero);
    }
    if (!this.figure) return;
    this.figure.view.position.set(t.charX, place[3]);

    if (t.charLevelup) {
      t.charLevelup = false;
      this.figure.playLabel("levelup");
    } else {
      this.figure.tick();
    }
  }

  enterFrame(dt: number): void {
    SH.enterFrame();
    if (this.redirecting) {
      if (this.leaving) return;
      this.leaving = true;
      void import("./CutsceneScreen").then((m) => {
        this.engine.setScreen(m.CutsceneScreen, {
          start: 11, end: 19, showCredits: true,
        });
      });
      return;
    }
    if (this.done) return;
    for (let i = 0; i < Math.max(1, Math.round(dt)); i++) this.tally?.tick();
    this.sync();

    const back = this.backBtn;
    setHitOrigin(this.root.x, this.root.y);
    if (back && back.visible) {
      back.setState(hitTest(...back.hitBox()) ? "over" : "up");
      focusable(...back.hitBox(), { back: true });
    }
    if (Input.mousePressed && back?.visible && hitTest(...back.hitBox())) {
      SH.playSound("S_Click");
      this.done = true;
      void import("./MenuScreen").then((m) => {
        this.engine.setScreen(m.MenuScreen, "missions");
      });
    }
    setHitOrigin(0, 0);
  }

  override get padFocus(): boolean {
    return true;
  }

  override get focusKeys(): boolean {
    return true;
  }

  destructor(): void {
    this.figure?.destroy();
    super.destructor();
  }
}
