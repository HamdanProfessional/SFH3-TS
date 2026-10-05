import { BlurFilter, Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { MenuPage } from "./MenuPage";
import { focusable, hitTest, localMouseX } from "../../ui/kit";
import { SfhButton } from "./sfhStyle";
import { Input } from "../../core/Input";
import { UT } from "../../core/UT";
import { SD } from "../../state/SD";
import { SH } from "../../audio/SH";
import * as Missions from "../../data/StatsMissions";
import { getMap, MAP_ORDER } from "../../data/StatsMaps";
import {
  buildModList, DIFF_COLORS, DIFF_NAMES, getGameMode, getLevelReq, MAX_LVL,
} from "../../data/StatsMisc";
import * as Classes from "../../data/StatsClasses";
import * as Guns from "../../data/StatsGuns";
import {
  MatchSettings, QM_DIFF_LABELS, cycleQmMode, getMod, qmLevelFor,
} from "../../game/MatchSettings";
import {
  MissionsArt, MissionButton, refreshMissionTex, type MTex,
} from "../../assets/MissionsArt";
import { containerView, itemArtEpoch, preloadItemArt } from "./InventoryPage";
import dotLayout from "../../assets/missionDots.json";

export type MatchType = 0 | 1 | 2;

const PAGE_TOP = 64;
const CONT_POS = [10.45, 102.0];
const CONT_CLIP = [12.15, 104.0, 775.3, 370.95];
const FOG_Y = -27.0;
const BOX_POS = [521.5, 101.25];
const DAILY_POS = [166.4, 117.35];
const DAILY_SCALE = 0.369;
const SCROLL_POS = [11.95, 468.4];
const CONTBOX = { x: 10.85, y: 104.4, sx: 5.4348, sy: 4.6664, w: 142.95 };
const CONTBOX_W = CONTBOX.w * CONTBOX.sx;
const CONTENT_W: number = dotLayout.contentWidth;
const INIT_MIN_X = -CONTENT_W + 800;
const DOT_BTN = MissionsArt.data.buttons["2144"];
const DOT_BTN_LIFT = -9;

interface DotView {
  i: number;
  x: number;
  y: number;
  root: Container;
  beat: Container | null;
  beatScale: number;
}

interface StripDot {
  x: number;
  y: number;
  challenge: boolean;
}

function buildStrip(): StripDot[] {
  const strip: StripDot[] = dotLayout.missionDots.map(
    ([x, y]) => ({ x, y, challenge: false }));
  for (const c of dotLayout.challengeDots) {
    strip.splice(parseInt(c.name.substring(1), 10) - 1, 0,
      { x: c.x, y: c.y, challenge: true });
  }
  return strip;
}

const STRIP = buildStrip();

let hermite: number[] = [0, 0, 1, 0];

function setResolution(value: number): void {
  const resolution = 1 / value;
  hermite = [];
  for (let t = resolution; t <= 1; t += resolution) {
    const h00 = (1 + 2 * t) * (1 - t) * (1 - t);
    const h10 = t * (1 - t) * (1 - t);
    const h01 = t * t * (3 - 2 * t);
    const h11 = t * t * (t - 1);
    hermite.push(h00, h10, h01, h11);
  }
}

function drawSpline(
  g: Graphics, start: StripDot, end: StripDot,
  prev?: StripDot, next?: StripDot,
): void {
  const p0 = prev ?? start;
  const n0 = next ?? end;
  const m1x = (end.x - p0.x) / 2;
  const m1y = (end.y - p0.y) / 2;
  const m2x = (n0.x - start.x) / 2;
  const m2y = (n0.y - start.y) / 2;
  for (let i = 0; i < hermite.length; i += 4) {
    const px = hermite[i] * start.x + hermite[i + 1] * m1x
      + hermite[i + 2] * end.x + hermite[i + 3] * m2x;
    const py = hermite[i] * start.y + hermite[i + 1] * m1y
      + hermite[i + 2] * end.y + hermite[i + 3] * m2y;
    g.lineTo(px, py);
  }
}

function authoredText(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, "").trim();
}

function fontOf(family: string | undefined): {
  fontFamily: string[]; fontWeight?: "bold";
} {
  const f = family ?? "QTypeSquare-Book";
  if (f.startsWith("Arial")) {
    return { fontFamily: ["Arial", "Verdana", "sans-serif"], fontWeight: "bold" };
  }
  return { fontFamily: [f, "Verdana", "sans-serif"] };
}

function boxField(cid: number, place: { x: number; y: number }): Text {
  const spec = MissionsArt.data.text[String(cid)];
  const align = spec?.align ?? "left";
  const t = new Text({
    roundPixels: true,
    text: authoredText(spec?.text),
    style: new TextStyle({
      ...fontOf(spec?.font),
      fontSize: spec?.size ?? 12,
      fill: spec?.color ?? 0xffffff,
      align: align === "justify" ? "left" : (align as "left"),
      wordWrap: spec?.wordWrap ?? false,
      wordWrapWidth: spec?.w ?? 200,
      lineHeight: spec?.size ? spec.size + (spec?.leading ?? 0) : undefined,
    }),
  });
  t.alpha = spec?.alpha ?? 1;
  const bx = place.x + (spec?.x ?? 0);
  const by = place.y + (spec?.y ?? 0);
  const bw = spec?.w ?? 0;
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

function fieldBox(cid: number, place: { x: number; y: number }):
{ x: number; y: number; w: number; h: number } {
  const spec = MissionsArt.data.text[String(cid)];
  return {
    x: place.x + (spec?.x ?? 0),
    y: place.y + (spec?.y ?? 0),
    w: spec?.w ?? 0,
    h: spec?.h ?? 0,
  };
}

export class MissionsPage extends MenuPage {
  static get matchType(): MatchType {
    return MatchSettings.matchType;
  }

  static set matchType(v: MatchType) {
    MatchSettings.matchType = v;
  }

  private static scrollX: number | null = null;
  private static targetX = 0;
  private static boxX = BOX_POS[0];
  private static dragFrom: number | null = null;
  private static squadError = false;
  private static squadCode = "";

  static resetSession(): void {
    this.matchType = 0;
    this.scrollX = null;
    this.targetX = 0;
    this.boxX = BOX_POS[0];
    this.dragFrom = null;
    this.squadError = false;
    this.squadCode = "";
  }

  static enterFrame(): void {
    this.boxX = 800;
  }

  private strip = new Container();
  private lineGfx = new Graphics();
  private fogSprite: Sprite | null = null;
  private fogX = 0;
  private dots: DotView[] = [];
  private scrollSprite: Sprite | null = null;
  private boxClip: Graphics | null = null;

  private box = new Container();
  private fields: Record<string, Text> = {};
  private btns: Record<string, MissionButton> = {};

  private playBtn: MissionButton | null = null;
  private customBtn: MissionButton | null = null;
  private dailyBtn: MissionButton | null = null;
  private editorBtn: SfhButton | null = null;
  private mapsBtn: SfhButton | null = null;

  private domInput: HTMLInputElement | null = null;
  private squadFocused = false;
  private artEpoch = 0;
  private itemHolder: Container | null = null;
  private itemFactory: (() => Container) | null = null;

  build(_w: number, _h: number): void {
    this.blurSquadInput();
    preloadItemArt();
    this.artEpoch = itemArtEpoch();
    setResolution(10);
    this.dots = [];
    this.fields = {};
    this.btns = {};
    this.fogSprite = null;
    this.scrollSprite = null;
    this.boxClip = null;
    this.itemHolder = null;
    this.itemFactory = null;
    if (MissionsPage.scrollX === null) MissionsPage.scrollX = CONT_POS[0];

    this.view.removeChildren();
    this.buildStrip();
    this.buildFrameButtons();
    this.buildBox();

    if (MissionsPage.matchType === 0) {
      const sel = STRIP[SD.curStage];
      let tx = sel ? -sel.x + 275 : 0;
      if (tx > 0) tx = 1;
      if (tx < INIT_MIN_X) tx = INIT_MIN_X;
      MissionsPage.targetX = tx;
    } else {
      MissionsPage.targetX = 0;
    }
  }

  private buildStrip(): void {
    const clip = new Graphics();
    clip.rect(CONT_CLIP[0], CONT_CLIP[1] - PAGE_TOP, CONT_CLIP[2], CONT_CLIP[3])
      .fill({ color: 0xffffff });
    this.view.addChild(clip);

    this.strip = new Container();
    this.strip.position.set(MissionsPage.scrollX ?? CONT_POS[0],
                            CONT_POS[1] - PAGE_TOP);
    this.view.addChild(this.strip);
    this.strip.mask = clip;

    this.strip.addChild(MissionsArt.sprite(MissionsArt.data.cont.tex));

    this.lineGfx = new Graphics();
    this.strip.addChild(this.lineGfx);

    const unlocked = SD.stages.length;
    this.drawPath(unlocked);
    this.buildFog(unlocked);
    this.buildDots(unlocked);
    this.buildScrollbar();
  }

  private drawPath(unlocked: number): void {
    const g = this.lineGfx;
    g.clear();

    const trunk = dotLayout.missionDots;
    for (let i = 0; i < trunk.length - 1; i++) {
      const past = i >= unlocked - 1;
      const width = past ? 6 : 8;
      const alpha = past ? Math.max(0, 0.4 - (i - unlocked) * 0.05) : 0.6;
      if (alpha <= 0) continue;
      const cur = { x: trunk[i][0], y: trunk[i][1], challenge: false };
      const nxt = { x: trunk[i + 1][0], y: trunk[i + 1][1], challenge: false };
      const prv = i > 0
        ? { x: trunk[i - 1][0], y: trunk[i - 1][1], challenge: false } : undefined;
      const nxt2 = i + 2 < trunk.length
        ? { x: trunk[i + 2][0], y: trunk[i + 2][1], challenge: false } : undefined;
      g.moveTo(cur.x, cur.y);
      drawSpline(g, cur, nxt, prv, nxt2);
      g.stroke({ color: 0xffffff, width, alpha });
    }

    for (let i = 1; i < STRIP.length; i++) {
      const d = STRIP[i];
      if (!d.challenge || i >= unlocked) continue;
      g.moveTo(d.x, d.y);
      g.lineTo(STRIP[i - 1].x, STRIP[i - 1].y);
      g.stroke({ color: 0xff6600, width: 8, alpha: 0.4 });
    }
  }

  private buildFog(unlocked: number): void {
    const frontier = STRIP[Math.min(unlocked - 1, STRIP.length - 1)];
    this.fogX = (frontier?.x ?? 0) + 40;
    const sp = MissionsArt.sprite(MissionsArt.data.fog);
    sp.position.set(this.fogX, FOG_Y);
    this.fogSprite = sp;
    this.strip.addChild(sp);
  }

  private buildDots(unlocked: number): void {
    const data = MissionsArt.data;
    STRIP.forEach((d, i) => {
      const locked = i >= unlocked;
      const selected = i === SD.curStage && MissionsPage.matchType === 0;
      const tier = SD.stages[i] ?? 0;

      const root = new Container();
      root.position.set(d.x, d.y);

      const frame = locked ? 3 : selected ? 2 : 1;
      const art = data.dots[d.challenge ? "chal" : "dot"][frame - 1];
      root.addChild(MissionsArt.sprite(art));

      let beat: Container | null = null;
      const beatRec: MTex | null = tier > 0 ? data.beat[tier] : null;
      if (beatRec) {
        beat = new Container();
        beat.position.set(-0.15, -7);
        beat.scale.set(0.3);
        beat.addChild(MissionsArt.sprite(beatRec));
        root.addChild(beat);
      }

      const a = i >= unlocked - 1
        ? Math.max(0, Math.min(1, 1 - (i - unlocked) * 0.5)) : 1;
      root.alpha = a;

      this.strip.addChild(root);
      this.dots.push({
        i, x: d.x, y: d.y, root, beat, beatScale: 0.3,
      });
    });
  }

  private buildScrollbar(): void {
    const sp = MissionsArt.sprite(MissionsArt.data.scroll);
    sp.position.set(SCROLL_POS[0], SCROLL_POS[1] - PAGE_TOP);
    sp.alpha = 0;
    this.scrollSprite = sp;
    this.view.addChild(sp);
  }

  private buildFrameButtons(): void {
    const custom = MissionsArt.button(2685, 12.6, 103.9 - PAGE_TOP);
    const daily = MissionsArt.button(2604, 154.55, 103.9 - PAGE_TOP);
    const play = MissionsArt.button(2681, 518.85, 482.95 - PAGE_TOP,
                                    1.1445, 0.3236);
    this.customBtn = custom;
    this.dailyBtn = daily;
    this.playBtn = play;

    const stages = SD.stages.length;
    const tabsHidden = stages <= 3;
    const startHidden = (stages === 2 && SD.heroes.length === 1)
      || (stages === 3 && SD.bpBuilt.length === 11);
    custom.visible = !tabsHidden;
    daily.visible = !tabsHidden;
    play.visible = !startHidden;

    this.view.addChild(custom, daily, play);

    const tabGap = daily.x - (custom.x + custom.w);
    const x0 = daily.x + daily.w + tabGap;
    const w = (BOX_POS[0] - 2 - x0 - tabGap) / 2;
    this.editorBtn = new SfhButton("Map editor", x0, daily.y, w, daily.h, 10.5);
    this.editorBtn.visible = !tabsHidden;
    this.view.addChild(this.editorBtn);
    this.mapsBtn = new SfhButton("Shared maps", x0 + w + tabGap, daily.y, w, daily.h, 10.5);
    this.mapsBtn.visible = !tabsHidden;
    this.view.addChild(this.mapsBtn);

    if (custom.visible) {
      const f = SD.checkDaily() ? 6 : 5;
      const rec = MissionsArt.data.beat[f - 1];
      if (rec) {
        const holder = new Container();
        holder.position.set(DAILY_POS[0], DAILY_POS[1] - PAGE_TOP);
        holder.scale.set(DAILY_SCALE);
        holder.addChild(MissionsArt.sprite(rec));
        this.view.addChild(holder);
      }
    }
  }

  private boxFrame(): "1" | "2" | "3" {
    if (MissionsPage.matchType === 2) return "1";
    if (MissionsPage.matchType === 1) return MatchSettings.qmAiBots ? "2" : "3";
    return "1";
  }

  private buildBox(): void {
    const f = this.boxFrame();
    const frame = MissionsArt.data.box[f];
    this.box = new Container();
    this.box.position.set(MissionsPage.boxX, BOX_POS[1] - PAGE_TOP);
    this.view.addChild(this.box);

    const clip = new Graphics();
    clip.rect(frame.clip[0], frame.clip[1], frame.clip[2], frame.clip[3])
      .fill({ color: 0xffffff });
    this.boxClip = clip;
    clip.position.set(MissionsPage.boxX, BOX_POS[1] - PAGE_TOP);
    this.view.addChild(clip);

    const shadow = MissionsArt.sprite(frame.under);
    shadow.tint = 0x000000;
    shadow.alpha = 0.85;
    shadow.position.set(2.19, 2.05);
    shadow.filters = [new BlurFilter({ strength: 2, quality: 3 })];
    this.box.addChild(shadow);

    this.box.addChild(MissionsArt.sprite(frame.under));

    if (MissionsPage.matchType === 2) {
      this.fillDaily(f, 0);
      this.box.addChild(MissionsArt.sprite(frame.over));
      this.fillDaily(f, 1);
    } else if (MissionsPage.matchType === 1) {
      this.fillQuick(f, 0);
      this.box.addChild(MissionsArt.sprite(frame.over));
      this.fillQuick(f, 1);
    } else {
      this.fillCampaign(f, 0);
      this.box.addChild(MissionsArt.sprite(frame.over));
      this.fillCampaign(f, 1);
    }
    this.box.mask = clip;
  }

  private placed(
    f: string, name: string, rec: MTex | null,
  ): Sprite | null {
    const p = MissionsArt.placed(f, name);
    if (!p || !rec) return null;
    const holder = new Container();
    holder.position.set(p.m[4], p.m[5]);
    holder.scale.set(p.m[0], p.m[3]);
    const sp = MissionsArt.sprite(rec);
    holder.addChild(sp);
    this.box.addChild(holder);
    return sp;
  }

  private addField(f: string, name: string, cid: number): Text | null {
    const p = MissionsArt.placed(f, name);
    if (!p) return null;
    const t = boxField(cid, { x: p.m[4], y: p.m[5] });
    this.box.addChild(t);
    this.fields[name] = t;
    return t;
  }

  private setField(name: string, text: string, color?: number): void {
    const t = this.fields[name];
    if (!t) return;
    t.text = text;
    if (color !== undefined) t.style.fill = color;
  }

  private addBtn(f: string, name: string, cid: number): void {
    const p = MissionsArt.placed(f, name);
    if (!p) return;
    const b = MissionsArt.button(cid, p.m[4], p.m[5], p.m[0], p.m[3]);
    this.box.addChild(b);
    this.btns[name] = b;
  }

  private beatRec(frame: number): MTex | null {
    return MissionsArt.data.beat[frame - 1] ?? null;
  }

  private placeItem(f: string, factory: () => Container): void {
    const p = MissionsArt.placed(f, "item");
    if (!p) return;
    this.itemFactory = factory;
    this.itemHolder = new Container();
    this.itemHolder.position.set(p.m[4], p.m[5]);
    this.box.addChild(this.itemHolder);
    this.itemHolder.addChild(factory());
  }
  private rewardItemView(m: Missions.Mission): Container {    if (SD.curDiff === 0) return containerView("none");
    const tier = SD.stages[SD.curStage] ?? 0;
    if (tier >= SD.curDiff) return containerView("random");
    const r = m.rewards[SD.curDiff - 1];
    if (typeof r === "number") return containerView("gold");
    const s = String(r);
    if (s.charAt(0) === "$") {
      return containerView("class3", { classId: s.substring(1) });
    }
    if (s === "random2") return containerView("random2");
    if (s === "features") return containerView("features");
    if (Classes.itemOb[s]) return containerView("class2", { classId: s });
    const g = Guns.itemOb[s];
    if (g) {
      return containerView("blueprint",
        { blueprint: { id: s, num: g.i, notFound: false } });
    }
    return containerView("default");
  }

  private fillCampaign(f: string, phase: 0 | 1): void {
    const m = Missions.getMission(SD.curStage);
    const mode = getGameMode(m.mode);
    const tier = SD.stages[SD.curStage] ?? 0;

    if (phase === 0) {
      this.placed(f, "mc_map", MissionsArt.data.boxmap[m.map] ?? null);
      this.placed(f, "mc_beatshield", this.beatRec(tier + 1));
      this.placed(f, "mc_diffshield", this.beatRec(SD.curDiff + 1));
      this.placeItem(f, () => this.rewardItemView(m));
      return;
    }

    this.addField(f, "txt_mission", 2635);
    this.setField("txt_mission",
      m.challenge ? m.challenge : `Mission ${m.num + 1}`,
      m.challenge ? 0xff6600 : 0xffcc00);
    this.addField(f, "txt_special", 2647);
    this.setField("txt_special", m.desc);
    this.addField(f, "txt_mode", 2640);
    this.setField("txt_mode", mode.name);
    this.addField(f, "txt_teams", 2641);
    this.setField("txt_teams",
      mode.teams ? `${m.team1} v ${m.team2}` : "Free for all");
    this.addField(f, "txt_map", 2644);
    this.setField("txt_map", getMap(m.map).name);
    this.addField(f, "txt_level", 2643);
    const req = getLevelReq(SD.curStage, SD.curDiff);
    const raise = typeof m.extra.raiseLvl === "number" ? m.extra.raiseLvl : 0;
    this.setField("txt_level",
      req === 0 ? "(Levels disabled)" : String(req + raise));
    this.addField(f, "txt_diff", 2637);
    this.setField("txt_diff", DIFF_NAMES[SD.curDiff], DIFF_COLORS[SD.curDiff]);
    this.addField(f, "txt_difftext", 2636);
    this.setField("txt_difftext", "DIFFICULTY", 0xffffff);

    if (SD.stages.length > 3) {
      this.addBtn(f, "bt_prev", 2652);
      this.addBtn(f, "bt_next", 2652);
    }
    this.placed(f, "mc_mode", MissionsArt.data.boxmode[mode.sprite] ?? null);
  }

  private fillDaily(f: string, phase: 0 | 1): void {
    const m = Missions.daily;
    const mode = getGameMode(m.mode);
    const done = SD.checkDaily();

    if (phase === 0) {
      this.placed(f, "mc_map", MissionsArt.data.boxmap[m.map] ?? null);
      this.placed(f, "mc_beatshield", this.beatRec(done ? 6 : 5));
      this.placeItem(f, () => containerView(done ? "none" : "random2"));
      return;
    }

    this.addField(f, "txt_mission", 2635);
    this.setField("txt_mission", "Daily Mission", 0xffcc00);
    this.addField(f, "txt_special", 2647);
    this.setField("txt_special", m.desc);
    this.addField(f, "txt_mode", 2640);
    this.setField("txt_mode", mode.name);
    this.addField(f, "txt_teams", 2641);
    this.setField("txt_teams",
      m.team1 === 1 ? "1 Hero" : `${m.team1} v ${m.team2}`);
    this.addField(f, "txt_map", 2644);
    this.setField("txt_map", getMap(m.map).name);
    this.addField(f, "txt_level", 2643);
    this.setField("txt_level", String(SD.getHighestLevel()));
    this.addField(f, "txt_difftext", 2636);
    this.setField("txt_difftext",
      done ? "Already completed." : "+10x Better reward chance!",
      done ? 0xcccccc : 0xffcc00);
    this.placed(f, "mc_mode", MissionsArt.data.boxmode[mode.sprite] ?? null);
  }

  private fillQuick(f: string, phase: 0 | 1): void {
    const mode = getGameMode(MatchSettings.qmMode);
    const mod = getMod(MatchSettings.qmMod);
    const bots = MatchSettings.qmAiBots;

    if (phase === 0) {
      this.placed(f, "mc_map", MissionsArt.data.boxmap[MatchSettings.qmMap] ?? null);
      return;
    }

    this.addField(f, "txt_mission", 2659);
    this.addField(f, "txt_modedesc", 2665);
    this.setField("txt_modedesc", mode.desc);
    this.addField(f, "txt_mode", 2661);
    this.setField("txt_mode", mode.name);
    this.addField(f, "txt_scorename", 2660);
    this.setField("txt_scorename", mode.scoretype);
    this.addField(f, "txt_score", 2662);
    this.setField("txt_score", String(MatchSettings.qmScore));
    this.addField(f, "txt_mod", 2664);
    this.setField("txt_mod", mod.name);
    this.addField(f, "txt_moddesc", 2666);
    this.setField("txt_moddesc", mod.desc);
    this.addField(f, "txt_modexp", 2667);
    this.setField("txt_modexp",
      mod.expmod !== 1 ? `-${(1 - mod.expmod) * 100}% EXP` : "");
    this.addField(f, "txt_map", 2668);
    this.setField("txt_map", getMap(MatchSettings.qmMap).name);

    if (bots) {
      this.addField(f, "txt_enemy", 2656);
      this.setField("txt_enemy", String(MatchSettings.qmEnemies));
      this.addField(f, "txt_diff", 2658);
      this.setField("txt_diff", QM_DIFF_LABELS[MatchSettings.qmDiff - 1]);
      this.addField(f, "txt_level", 2654);
      MatchSettings.qmLevel = qmLevelFor(MatchSettings.qmDiff);
      let hi = MatchSettings.qmLevel + 1;
      let lo = MatchSettings.qmLevel - 1;
      if (hi > MAX_LVL + 1) hi = MAX_LVL + 1;
      if (lo < 1) lo = 1;
      this.setField("txt_level", `${lo} - ${hi}`);

      this.addBtn(f, "bt_enemyprev", 2652);
      this.addBtn(f, "bt_enemynext", 2652);
      this.addBtn(f, "bt_diffprev", 2652);
      this.addBtn(f, "bt_diffnext", 2652);
      this.addBtn(f, "bt_squad", 2087);
    } else {
      this.addField(f, "txt_codedesc", 2673);
      this.setField("txt_codedesc",
        MissionsPage.squadError
          ? "ERROR: This squad code is invalid.\nMake sure it was copied "
            + "correctly and not modified."
          : "Copy and paste a friend\u2019s squad code below to play against "
            + "their team. Find your code on the Select Squad screen.",
        MissionsPage.squadError ? 0xff3333 : 0x999999);
      this.addField(f, "txt_squadcode", 2674);
      this.setField("txt_squadcode", MissionsPage.squadCode);

      this.addBtn(f, "bt_bots", 2087);
    }

    this.addBtn(f, "bt_modeprev", 2652);
    this.addBtn(f, "bt_modenext", 2652);
    this.addBtn(f, "bt_scoreprev", 2652);
    this.addBtn(f, "bt_scorenext", 2652);
    this.addBtn(f, "bt_modprev", 2652);
    this.addBtn(f, "bt_modnext", 2652);
    this.addBtn(f, "bt_prev", 2652);
    this.addBtn(f, "bt_next", 2652);
    this.placed(f, "mc_mode", MissionsArt.data.boxmode[mode.sprite] ?? null);
  }

  update(_dt: number): void {
    refreshMissionTex(this.view);
    if (itemArtEpoch() !== this.artEpoch) {
      this.artEpoch = itemArtEpoch();
      this.refreshItem();
    }
    if (this.boxFrame() === "3") this.pullSquadInput();
    this.updateSlide();
    this.updateScroll();
    this.updateButtons();
    this.registerFocus();
  }

  private registerFocus(): void {
    const sx = CONT_POS[0] + (MissionsPage.scrollX ?? 0);
    const sy = CONT_POS[1] - PAGE_TOP;
    const left = CONT_CLIP[0];
    const right = Math.min(CONT_CLIP[0] + CONT_CLIP[2], MissionsPage.boxX);
    const clip = [left, CONT_CLIP[1] - PAGE_TOP, right - left, CONT_CLIP[3]] as const;
    const unlocked = SD.stages.length;
    for (const d of this.dots) {
      if (d.i >= unlocked) continue;
      const dx = d.x + DOT_BTN.offX;
      focusable(sx + dx, sy + d.y + DOT_BTN_LIFT + DOT_BTN.offY, DOT_BTN.w, DOT_BTN.h, {
        key: `dot:${d.i}`,
        clip,
        reveal: () => {
          MissionsPage.targetX = (left + right) / 2 - CONT_POS[0] - dx - DOT_BTN.w / 2;
        },
      });
    }
    if (this.boxFrame() === "3") {
      const p = MissionsArt.placed("3", "txt_squadcode");
      if (p) {
        const b = fieldBox(2674, { x: p.m[4], y: p.m[5] });
        focusable(MissionsPage.boxX + b.x, BOX_POS[1] - PAGE_TOP + b.y, b.w, b.h);
      }
    }
  }

  private refreshItem(): void {
    const holder = this.itemHolder;
    if (!holder || !this.itemFactory) return;
    holder.removeChildren().forEach((c) => c.destroy({ children: true }));
    holder.addChild(this.itemFactory());
  }

  private updateSlide(): void {
    MissionsPage.boxX += (BOX_POS[0] - MissionsPage.boxX) * 0.3;
    this.box.x = MissionsPage.boxX;
    if (this.boxClip) {
      this.boxClip.position.set(MissionsPage.boxX, BOX_POS[1] - PAGE_TOP);
    }
  }

  private updateScroll(): void {
    if (MissionsPage.dragFrom !== null) {
      if (!Input.mouseDown) {
        MissionsPage.dragFrom = null;
      } else {
        const want = localMouseX() - MissionsPage.dragFrom;
        MissionsPage.targetX += (want - MissionsPage.targetX) * 0.5;
      }
    }
    const minX = CONTBOX.x - (CONTENT_W - CONTBOX_W);
    if (MissionsPage.targetX > CONTBOX.x) {
      MissionsPage.targetX += (CONTBOX.x - MissionsPage.targetX) * 0.7;
    }
    if (MissionsPage.targetX < minX) {
      MissionsPage.targetX += (minX - MissionsPage.targetX) * 0.7;
    }
    if (MissionsPage.targetX !== 0) {
      const cur = MissionsPage.scrollX ?? CONT_POS[0];
      MissionsPage.scrollX = cur + (MissionsPage.targetX - cur) * 0.3;
    }
    this.strip.x = MissionsPage.scrollX ?? CONT_POS[0];

    const fog = this.fogSprite;
    if (fog) {
      fog.position.set(this.fogX, FOG_Y);
      fog.width = CONTENT_W - this.fogX + 150;
      fog.height = MissionsArt.data.fog.h;
    }

    const sp = this.scrollSprite;
    if (sp) {
      const cur = MissionsPage.scrollX ?? 0;
      const denom = CONTBOX.x - (CONTENT_W - CONTBOX_W);
      let x = CONTBOX.x + (cur / denom) * (CONTBOX_W - sp.width);
      const span = CONTBOX.x + CONTBOX_W - sp.width;
      if (x < CONTBOX.x) x = CONTBOX.x;
      if (x > span) x = span;
      sp.position.set(x, SCROLL_POS[1] - PAGE_TOP);
      sp.alpha = Math.min(1, Math.abs(MissionsPage.targetX - cur) * 0.1);
    }

    const sel = this.dots[SD.curStage];
    if (sel && MissionsPage.matchType === 0 && sel.beat) {
      sel.beatScale += (0.6 - sel.beatScale) * 0.3;
      sel.beat.scale.set(sel.beatScale);
      UT.setDate();
      sel.beat.y = -7 + UT.getOscillation(1, 3);
    }
  }

  private hitFrameBtn(b: MissionButton | null): boolean {
    if (!b || !b.visible) return false;
    const [x, y, w, h] = b.hitBox();
    return hitTest(x, y, w, h);
  }

  private hitBoxBtn(name: string): boolean {
    const b = this.btns[name];
    if (!b || !b.visible) return false;
    const [x, y, w, h] = b.hitBox();
    return hitTest(x + MissionsPage.boxX, y + (BOX_POS[1] - PAGE_TOP), w, h);
  }

  private updateButtons(): void {
    for (const [name, b] of Object.entries(this.btns)) {
      b.refresh();
      b.setState(this.hitBoxBtn(name) ? "over" : "up");
    }
    for (const b of [this.playBtn, this.customBtn, this.dailyBtn]) {
      if (!b) continue;
      b.refresh();
      b.setState(this.hitFrameBtn(b) ? "over" : "up");
    }
    this.editorBtn?.update();
    this.mapsBtn?.update();
  }

  onClick(): void {
    const mt = MissionsPage.matchType;

    if (this.domInput && this.squadFocused && !this.hitSquadField()) {
      this.blurSquadInput();
    }

    const hit = (name: string): boolean => {
      if (!this.hitBoxBtn(name)) return false;
      SH.playSound("S_Click");
      return true;
    };

    if (mt === 0 || mt === 2) {
      if (hit("bt_prev")) { this.cycleDiff(mt, -1); this.host.refresh(); return; }
      if (hit("bt_next")) { this.cycleDiff(mt, 1); this.host.refresh(); return; }
      if (this.hitFrameBtn(this.playBtn)) {
        SH.playSound("S_Ammo");
        this.host.goto("deploy");
        return;
      }
    } else if (mt === 1) {
      if (hit("bt_modeprev")) { cycleQmMode(false); this.host.refresh(); return; }
      if (hit("bt_modenext")) { cycleQmMode(true); this.host.refresh(); return; }
      if (hit("bt_scoreprev")) { this.cycleScore(-1); this.host.refresh(); return; }
      if (hit("bt_scorenext")) { this.cycleScore(1); this.host.refresh(); return; }
      if (hit("bt_modprev")) { this.cycleMod(-1); this.host.refresh(); return; }
      if (hit("bt_modnext")) { this.cycleMod(1); this.host.refresh(); return; }
      if (hit("bt_squad")) {
        MatchSettings.qmAiBots = false;
        this.host.refresh();
        return;
      }
      if (hit("bt_bots")) {
        MatchSettings.qmAiBots = true;
        this.host.refresh();
        return;
      }
      if (hit("bt_prev")) { this.cycleMap(-1); this.host.refresh(); return; }
      if (hit("bt_next")) { this.cycleMap(1); this.host.refresh(); return; }
      if (MatchSettings.qmAiBots) {
        if (hit("bt_enemyprev")) { this.stepEnemies(-1); this.host.refresh(); return; }
        if (hit("bt_enemynext")) { this.stepEnemies(1); this.host.refresh(); return; }
        if (hit("bt_diffprev")) { this.cycleQmDiff(-1); this.host.refresh(); return; }
        if (hit("bt_diffnext")) { this.cycleQmDiff(1); this.host.refresh(); return; }
        if (this.hitFrameBtn(this.playBtn)) {
          SH.playSound("S_Ammo");
          this.host.goto("deploy");
          return;
        }
      } else {
        if (this.hitSquadField()) {
          this.focusSquadInput();
          return;
        }
        if (this.hitFrameBtn(this.playBtn)) {
          if (!SD.readSquadCode(MissionsPage.squadCode)) {
            SH.playSound("S_Error");
            MissionsPage.squadError = true;
            this.host.refresh();
          } else {
            SH.playSound("S_Ammo");
            MissionsPage.squadError = false;
            this.host.goto("deploy");
          }
          return;
        }
      }
    }

    if (localMouseX() > MissionsPage.boxX) return;

    if (this.hitDot()) return;

    if (this.editorBtn?.activate()) {
      this.host.openEditor();
      return;
    }
    if (this.mapsBtn?.activate()) {
      this.host.goto("mapBrowser");
      return;
    }
    if (this.hitFrameBtn(this.customBtn)) {
      SH.playSound("S_Click");
      MissionsPage.matchType = 1;
      this.host.refresh();
      return;
    }
    if (this.hitFrameBtn(this.dailyBtn)) {
      SH.playSound("S_Click");
      MissionsPage.matchType = 2;
      this.host.refresh();
      return;
    }

    if (hitTest(CONTBOX.x, CONTBOX.y - PAGE_TOP, CONTBOX_W,
                CONTBOX.w * CONTBOX.sy)) {
      MissionsPage.dragFrom = localMouseX() - (MissionsPage.scrollX ?? 0);
    }
  }

  private hitDot(): DotView | null {
    if (localMouseX() > MissionsPage.boxX) return null;
    const sx = CONT_POS[0] + (MissionsPage.scrollX ?? 0);
    const sy = CONT_POS[1] - PAGE_TOP;
    const unlocked = SD.stages.length;
    for (const d of this.dots) {
      if (d.i >= unlocked) continue;
      const x = sx + d.x + DOT_BTN.offX;
      const y = sy + d.y + DOT_BTN_LIFT + DOT_BTN.offY;
      if (hitTest(x, y, DOT_BTN.w, DOT_BTN.h)) {
        SH.playSound("S_Click");
        MissionsPage.matchType = 0;
        SD.curStage = d.i;
        this.host.refresh();
        return d;
      }
    }
    return null;
  }

  private hitSquadField(): boolean {
    if (this.boxFrame() !== "3") return false;
    const p = MissionsArt.placed("3", "txt_squadcode");
    if (!p) return false;
    const b = fieldBox(2674, { x: p.m[4], y: p.m[5] });
    return hitTest(MissionsPage.boxX + b.x, BOX_POS[1] - PAGE_TOP + b.y,
                   b.w, b.h);
  }

  private cycleDiff(mt: MatchType, step: number): void {
    SD.curDiff += step;
    if (mt === 2) {
      if (SD.curDiff < 0) SD.curDiff = 3;
      if (SD.curDiff > 3) SD.curDiff = 0;
    } else {
      if (SD.curDiff < 1) SD.curDiff = 3;
      if (SD.curDiff > 3) SD.curDiff = 1;
    }
  }

  private cycleMap(dir: number): void {
    const i = MAP_ORDER.indexOf(MatchSettings.qmMap as typeof MAP_ORDER[number]);
    const n = MAP_ORDER.length;
    MatchSettings.qmMap = MAP_ORDER[(i + dir + n) % n];
  }

  private cycleScore(dir: number): void {
    const list = getGameMode(MatchSettings.qmMode).scorelist;
    let i = list.indexOf(MatchSettings.qmScore);
    if (i < 0) i = 0;
    MatchSettings.qmScore = list[(i + dir + list.length) % list.length];
  }

  private cycleMod(dir: number): void {
    const list = buildModList(SD.achievements);
    let i = list.indexOf(MatchSettings.qmMod);
    if (i < 0) i = 0;
    MatchSettings.qmMod = list[(i + dir + list.length) % list.length] ?? "none";
  }

  private cycleQmDiff(dir: number): void {
    MatchSettings.qmDiff = ((MatchSettings.qmDiff - 1 + dir + 6) % 6) + 1;
    MatchSettings.qmLevel = qmLevelFor(MatchSettings.qmDiff);
  }

  private stepEnemies(dir: number): void {
    const mode = getGameMode(MatchSettings.qmMode);
    const max = mode.teams ? 5 : 9;
    MatchSettings.qmEnemies += dir;
    if (MatchSettings.qmEnemies < 1) MatchSettings.qmEnemies = max;
    if (MatchSettings.qmEnemies > max) MatchSettings.qmEnemies = 1;
  }

  layout(w: number, h: number): void {
    this.view.removeChildren();
    this.build(w, h);
  }

  destroy(): void {
    this.blurSquadInput();
    super.destroy();
  }

  private focusSquadInput(): void {
    if (typeof document === "undefined") return;
    if (!this.domInput) {
      const el = document.createElement("input");
      el.type = "text";
      el.autocomplete = "off";
      el.spellcheck = false;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "0";
      el.value = MissionsPage.squadCode;
      document.body.appendChild(el);
      this.domInput = el;
    }
    this.squadFocused = true;
    this.domInput.focus();
  }

  private blurSquadInput(): void {
    this.squadFocused = false;
    if (this.domInput) {
      MissionsPage.squadCode = this.domInput.value;
      this.domInput.remove();
      this.domInput = null;
    }
  }

  private pullSquadInput(): void {
    if (this.domInput && this.squadFocused) {
      MissionsPage.squadCode = this.domInput.value;
      const t = this.fields["txt_squadcode"];
      if (t && t.text !== MissionsPage.squadCode) {
        t.text = MissionsPage.squadCode;
      }
    }
  }
}
