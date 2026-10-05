import { Container, Graphics, Sprite, Text } from "pixi.js";
import { Screen } from "../core/Screen";
import type { Engine } from "../core/Engine";
import { GAME_WIDTH, GAME_HEIGHT, DESIGN_WIDTH, DESIGN_HEIGHT } from "../core/Config";
import { Input } from "../core/Input";
import { UT } from "../core/UT";
import { SD } from "../state/SD";
import { focusable, hitTest, setHitOrigin } from "../ui/kit";
import { Focus } from "../core/Focus";
import {
  ArtButton, BgStrip, CHROME_BANDS, PORT_BUTTONS, fieldText, fitText, frameArt,
  itemOf, platefor, textSpec, vignetteFor,
} from "../ui/art";
import { Tooltip } from "../ui/Tooltip";
import { MenuPage, type PageHost } from "./menu/MenuPage";
import { HeroesPage } from "./menu/HeroesPage";
import { OptionsPage } from "./menu/OptionsPage";
import { OptionsTutPage } from "./menu/OptionsTutPage";
import { AppstorePage } from "./menu/AppstorePage";
import { StubPage, STUBS, UNKNOWN_FRAME } from "./menu/StubPage";
import { InventoryPage } from "./menu/InventoryPage";
import { HeroesInvPage } from "./menu/HeroesInvPage";
import { WorkshopInvPage } from "./menu/WorkshopInvPage";
import { StorePage } from "./menu/StorePage";
import { WorkshopPage } from "./menu/WorkshopPage";
import { MissionsPage } from "./menu/MissionsPage";
import { MedalsPage } from "./menu/MedalsPage";
import { TipsPage } from "./menu/TipsPage";
import { CreditsPage } from "./menu/CreditsPage";
import { DeployPage } from "./menu/DeployPage";
import { MultiplayerPage } from "./menu/MultiplayerPage";
import { MapBrowserPage } from "./menu/MapBrowserPage";
import { GetItemModal } from "./menu/GetItemModal";
import { PAGES, PageButton, PlateEdges, pagePlate, refreshTex } from "./menu/pageArt";
import { ARMOR_FIRST, SOCIAL_LINKS, urlArmor, urlNotDoppler } from "../core/links";
import { EXTRAS_SCALE, MenuExtras, type ExtraRec } from "../ui/menuExtras";
import { SH } from "../audio/SH";
import { MatchSettings, getGameMode } from "../game/MatchSettings";
import { MatchInfo } from "../game/types";
import { getMap } from "../data/StatsMaps";
import { netSession, setNetSession } from "../net/NetClient";
import { heroFromWire } from "../net/hero";
import { LoaderScreen } from "./LoaderScreen";
import { preloadCustomMatch, preloadMatch, type MatchAssets } from "../core/Preload";
import * as Missions from "../data/StatsMissions";

const LOGO_X: readonly [number, number] = [333.3, 482.7];
const LOGO_Y = 15.75;

const MAIN_BUTTONS = [
  "missions", "heroes", "inventory", "store", "workshop", "multiplayer",
  "options", "medals", "tips", "credits",
] as const;

const NAV_INK_W: Readonly<Record<string, number>> = {
  missions: 138, heroes: 121.5, inventory: 163.5, store: 101.5,
  workshop: 166.5, multiplayer: 216,
};
const NAV_SCALE = 0.79;
const NAV_X0 = 6;
const NAV_X1 = 794;
const NAV_INK_OFF_X = 2.8;
const NAV_INK_OFF_MID_Y = 9.55;
const NAV_MID_Y = 40.25;

const SOCIAL_NAMES = ["bt_youtube", "bt_facebook", "bt_twitter"] as const;

export function pageKindFor(frame: string, stages: number = SD.stages.length): string {
  if (frame === "options" && stages <= 1) return "optionsTut";
  return frame;
}

const BAR_EDGE_PAD = 8;

const PARENT_TAB: Readonly<Record<string, string>> = {
  heroesInv: "heroes",
  workshopInv: "workshop",
  deploy: "missions",
  mapBrowser: "missions",
};

const PAGE_TOP = 64;
const PAGE_BOTTOM = 566;

const BG_SPOT_FRAMES: ReadonlySet<string> = new Set([
  "missions", "heroes", "deploy", "heroesInv", "workshopInv",
  "inventory", "store", "workshop",
]);

export class MenuScreen extends Screen {
  private root = new Container();
  private bg = new BgStrip();
  private vignette = new Sprite();
  private plateLayer = new Container();
  private plateEdges = new PlateEdges();
  private plateSprite: Sprite | null = null;
  private pageHolder = new Container();
  private chrome = new Container();

  private navButtons = new Map<string, ArtButton>();
  private socialButtons: { btn: ArtButton; go: () => void }[] = [];
  private appButton: PageButton | null = null;
  private tooltipView = new Tooltip();
  private getItem = new GetItemModal();
  private letterbox = new Graphics();
  private fundsTxt: Text | null = null;
  private dayTxt: Text | null = null;
  private fundsMaxW = 0;
  private dayMaxW = 0;

  private curFrame = "missions";
  private bgSpot: string | null = null;
  private page: MenuPage | null = null;
  private contentX = 0;
  private bgReady = false;

  private logoSprites: { sp: Sprite; rec: ExtraRec; armor: boolean }[] = [];
  private tutorialFrame = 0;
  private loadError = false;
  private loadErrorTxt: Text | null = null;
  private loadErrorTimer = 0;
  private static pendingLoadError = false;
  private tutorialArt = new Sprite();

  private host: PageHost = {
    goto: (frame: string) => this.goto(frame),
    tooltip: this.tooltipView,
    refresh: () => this.buildPage(true),
    startMatch: () => this.startMatch(),
    startNetMatch: () => this.startNetMatch(),
    openEditor: (arg?: unknown) => {
      void import("./EditorScreen").then((m) => this.engine.setScreen(m.EditorScreen, arg));
    },
    playCustom: async (m) => {
      const [{ playCustomMap }, { checkMap }] = await Promise.all([
        import("../editor/playtest"), import("../editor/build"),
      ]);
      const mode = m.spawns.length && m.spawns.every((s) => s.team === 0) ? "dm" : "tdm";
      const bad = checkMap(m, mode).find((i) => i.level === "error");
      if (bad) return bad.text;
      playCustomMap(this.engine, m, { mode, enemies: 4, diff: 3 },
        { screen: MenuScreen, arg: "mapBrowser" });
      return null;
    },
    openTransaction: (item, mode) =>
      this.getItem.openTransaction(item, mode, () => this.buildPage(true)),
    openHire: () => this.getItem.initHire(SD.getHirePrice(), (ok) => {
      if (!ok) return;
      const hired = SD.hireHero();
      SD.save();
      this.buildPage(true);
      if (hired) this.host.showHireReveal(hired);
    }),
    openFire: () => this.getItem.initFire(SD.selectedHero.name, (ok) => {
      if (!ok) return;
      SD.dismissHero();
      SD.save();
      this.buildPage(true);
    }),
    openBuild: (bpNum: number) => this.getItem.initBuild(bpNum, (ok) => {
      if (!ok) return;
      if (!SD.buildBlueprint(bpNum)) {
        SH.playSound("S_Error");
        return;
      }
      SD.save();
      this.buildPage(true);
    }),
    showHireReveal: (unit) => this.getItem.openReveal(unit, () => {
      HeroesPage.requestHireAnim();
      this.buildPage(true);
    }),
  };

  constructor(engine: Engine, arg?: unknown) {
    super(engine, arg);

    SD.load();
    if (typeof arg === "string" && arg) this.curFrame = arg;
    if (MatchSettings.sandbox) void import("../editor/playtest").then((m) => m.endPlayTest());
    if (MenuScreen.pendingLoadError) {
      MenuScreen.pendingLoadError = false;
      this.loadError = true;
      this.loadErrorTimer = 4;
    }

    MissionsPage.resetSession();

    this.view.addChild(this.letterbox);
    this.view.addChild(this.root);
    this.root.addChild(this.bg);
    this.root.addChild(this.vignette);
    this.root.addChild(this.plateLayer);
    this.root.addChild(this.plateEdges);
    this.root.addChild(this.pageHolder);
    this.root.addChild(this.chrome);
    this.tutorialArt.visible = false;
    this.root.addChild(this.tutorialArt);
    this.view.addChild(this.tooltipView);
    this.view.addChild(this.getItem);

    this.anchor();
    this.buildChrome();
    this.buildPage(false);

    SH.inMatch = false;
    SH.msgTimer = false;
    SH.playMusic("M_Menu");
  }

  private anchor(): void {
    this.contentX = Math.round((GAME_WIDTH - DESIGN_WIDTH) / 2);
    this.root.position.set(this.contentX, Math.round((GAME_HEIGHT - DESIGN_HEIGHT) / 2));
    this.letterbox.clear();
    this.letterbox.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000 });
    this.layoutEdges();
  }

  private layoutEdges(): void {
    this.plateEdges.update(this.plateSprite, DESIGN_WIDTH,
      this.contentX, GAME_WIDTH - DESIGN_WIDTH - this.contentX, CHROME_BANDS);
    this.bg.refresh();
    this.vignette.position.set(-this.contentX, 0);
    this.vignette.width = GAME_WIDTH;
    this.vignette.height = DESIGN_HEIGHT;
  }

  goto(frame: string): void {
    this.curFrame = frame;
    this.buildPage(false);
  }

  refresh(): void {
    this.buildPage(true);
  }

  private buildPage(samePage: boolean): void {
    if (!samePage) SD.save();

    if (this.curFrame === "missions" && !SD.mapItem.length && SD.autoShowAd) {
      SD.autoShowAd = false;
      SH.playSound("S_Powerup");
      this.curFrame = "appstore";
    }

    this.page?.destroy();
    this.pageHolder.removeChildren();
    this.plateLayer.removeChildren();

    if (!samePage && this.curFrame === "missions") MissionsPage.enterFrame();
    if (!samePage && this.curFrame === "workshop") WorkshopPage.enterFrame();
    if (!samePage && this.curFrame === "store") StorePage.enterFrame();

    const plate = pagePlate(this.curFrame) ?? platefor(this.curFrame);
    this.plateSprite = plate;
    if (plate) this.plateLayer.addChild(plate);

    if (this.bgSpot === null || BG_SPOT_FRAMES.has(this.curFrame)) {
      this.bgSpot = this.curFrame;
    }
    const spot = frameArt(this.bgSpot)?.bgX;
    if (spot !== null && spot !== undefined) {
      if (this.bgReady) this.bg.slideTo(spot);
      else this.bg.snap(spot);
    }
    this.bgReady = true;

    const vig = vignetteFor(this.curFrame);
    this.vignette.visible = vig !== null;
    if (vig) this.vignette.texture = vig;
    this.layoutEdges();

    this.page = this.makePage(this.curFrame);
    this.pageHolder.addChild(this.page.view);
    this.pageHolder.y = PAGE_TOP;
    this.page.build(DESIGN_WIDTH, PAGE_BOTTOM - PAGE_TOP);

    this.refreshChrome();
    this.grantAkq();
    this.drainRewards();
  }

  private grantAkq(): void {
    if (this.curFrame !== "missions") return;
    if (SD.gotAkq || SD.stages.length <= 3) return;
    SD.gotAkq = true;
    SD.mapItem.push("$akq");
    SD.save();
  }

  private drainRewards(): void {
    if (this.getItem.isOpen) return;
    const head: [unknown, "mapItem" | "storeItem" | "workshopItem"] | null =
      SD.mapItem.length ? [SD.mapItem[0], "mapItem"]
        : SD.storeItem ? [SD.storeItem, "storeItem"]
          : SD.workshopItem ? [SD.workshopItem, "workshopItem"]
            : null;
    if (!head) return;
    this.getItem.open(head[0], head[1], () => {
      this.refreshChrome();
      this.drainRewards();
    });
  }

  private makePage(frame: string): MenuPage {
    switch (pageKindFor(frame)) {
      case "heroes":
        return new HeroesPage(this.host);
      case "options":
        return new OptionsPage(this.host);
      case "optionsTut":
        return new OptionsTutPage(this.host);
      case "appstore":
        return new AppstorePage(this.host);
      case "inventory":
        return new InventoryPage(this.host);
      case "heroesInv":
        return new HeroesInvPage(this.host);
      case "workshopInv":
        return new WorkshopInvPage(this.host);
      case "store":
        return new StorePage(this.host);
      case "workshop":
        return new WorkshopPage(this.host);
      case "missions":
        return new MissionsPage(this.host);
      case "medals":
        return new MedalsPage(this.host);
      case "tips":
        return new TipsPage(this.host);
      case "credits":
        return new CreditsPage(this.host);
      case "deploy":
        return new DeployPage(this.host);
      case "multiplayer":
        return new MultiplayerPage(this.host);
      case "mapBrowser":
        return new MapBrowserPage(this.host);
      default:
        return new StubPage(this.host, STUBS[frame] ?? UNKNOWN_FRAME);
    }
  }

  private startMatch(): void {
    const mission =
      MatchSettings.matchType === 0 ? Missions.getMission(SD.curStage)
        : MatchSettings.matchType === 2 ? Missions.daily
          : null;
    MatchSettings.setupMatch({
      squad: SD.squad,
      heroes: SD.heroes,
      curStage: SD.curStage,
      curDiff: SD.curDiff,
      bpClasses: SD.bpClasses,
      mission,
    });
    MatchSettings.sandbox = false;
    SD.save();

    const mapId = MatchSettings.useMap.id;
    const frame = this.curFrame;
    this.engine.setScreen(LoaderScreen, {
      title: MatchSettings.useMap.name || mapId,
      run: (p) => preloadMatch(mapId, p),
      done: (r: unknown) => {
        const { map, hero } = r as MatchAssets;
        void import("./GameScreen").then((mod) => {
          this.engine.setScreen(mod.GameScreen, {
            map, hero, roster: MatchSettings.useBots, options: SD.options,
          });
        });
      },
      fail: () => {
        MenuScreen.pendingLoadError = true;
        this.engine.setScreen(MenuScreen, frame);
      },
    });
  }

  private startNetMatch(): void {
    const net = netSession();
    const round = net?.round;
    if (!net || !round) return;

    const { cfg } = round;
    const mode = getGameMode(cfg.mode);
    const roster = round.slots.map((s) => {
      const info = heroFromWire(s.info);
      info.team = s.team;
      info.name = s.name;
      if (s.extra) info.extra = structuredClone(s.extra);
      return info;
    });

    MatchSettings.matchType = 1;
    MatchSettings.useMap = getMap(cfg.map);
    MatchSettings.useMode = cfg.mode;
    MatchSettings.useScore = cfg.score;
    MatchSettings.useMod = cfg.mod;
    MatchSettings.useTeams = mode.teams;
    MatchSettings.useExtra = structuredClone(cfg.extra ?? {});
    MatchSettings.useBots = roster;
    MatchInfo.matchType = 1;
    MatchInfo.useMode = cfg.mode;
    MatchInfo.useScore = cfg.score;
    MatchInfo.useMod = cfg.mod;
    MatchInfo.useExtra = MatchSettings.useExtra as Record<string, number | boolean>;

    const frame = this.curFrame;
    const cmap = cfg.cmap;
    const run = cmap
      ? async (p: (n: number) => void): Promise<MatchAssets> => {
        const [{ fetchShared }, { loadCustomMap }, { customMapInfo }, { backdropUrls }] =
          await Promise.all([
            import("../editor/store"), import("../editor/art"),
            import("../net/customMap"), import("../game/maps"),
          ]);
        const { map } = await fetchShared(cmap);
        MatchSettings.useMap = customMapInfo(map);
        return preloadCustomMatch(backdropUrls(MatchSettings.useMap),
          () => loadCustomMap(map, cfg.mode), p);
      }
      : (p: (n: number) => void) => preloadMatch(cfg.map, p);
    this.engine.setScreen(LoaderScreen, {
      title: cmap ? "Custom map" : MatchSettings.useMap.name || cfg.map,
      run,
      done: (r: unknown) => {
        const { map, hero } = r as MatchAssets;
        void import("./GameScreen").then((mod) => {
          this.engine.setScreen(mod.GameScreen, {
            map, hero, roster, options: SD.options, net,
          });
        });
      },
      fail: () => {
        setNetSession(null);
        MenuScreen.pendingLoadError = true;
        this.engine.setScreen(MenuScreen, frame);
      },
    });
  }

  private buildChrome(): void {
    this.chrome.removeChildren();
    this.navButtons.clear();
    this.socialButtons = [];

    const app = PAGES.app;
    if (app?.states?.up) {
      this.appButton = new PageButton(app, app.x, app.y);
      this.chrome.addChild(this.appButton);
    }

    for (const id of MAIN_BUTTONS) {
      const it = itemOf("missions", `bt_${id}`);
      const port = PORT_BUTTONS[id];
      const b = it
        ? new ArtButton(it.cid, it.x, it.y, it.sx, it.sy)
        : port ? new ArtButton(port, 0, 30.7) : null;
      if (!b) continue;
      this.chrome.addChild(b);
      this.navButtons.set(id, b);
    }
    this.layoutNav();

    SOCIAL_NAMES.forEach((name, i) => {
      const it = itemOf("missions", name);
      if (!it) return;
      const b = new ArtButton(it.cid, it.x, it.y, it.sx, it.sy);
      this.chrome.addChild(b);
      this.socialButtons.push({ btn: b, go: SOCIAL_LINKS[i].go });
    });

    this.logoSprites = [];
    for (const [x, armor] of [[LOGO_X[0], ARMOR_FIRST],
                              [LOGO_X[1], !ARMOR_FIRST]] as const) {
      const rec = MenuExtras.logo(armor ? "armor" : "notdoppler");
      if (!rec) continue;
      const sp = new Sprite();
      sp.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
      sp.scale.set(1 / EXTRAS_SCALE);
      sp.position.set(x, LOGO_Y);
      this.chrome.addChild(sp);
      this.logoSprites.push({ sp, rec, armor });
    }

    const barFont = ["QTypeSquare-Light", "Verdana", "sans-serif"];
    const funds = itemOf("missions", "txt_funds");
    if (funds) {
      this.fundsTxt = fieldText(funds.cid, funds, "", { fontFamily: barFont });
      this.fundsMaxW = textSpec(funds.cid)?.w ?? 0;
      this.chrome.addChild(this.fundsTxt);
    }
    const day = itemOf("missions", "txt_day");
    if (day) {
      this.dayTxt = fieldText(day.cid, day, "", { fontFamily: barFont });
      this.dayMaxW = textSpec(day.cid)?.w ?? 0;
      this.chrome.addChild(this.dayTxt);
    }

    this.refreshChrome();
  }

  private layoutNav(): void {
    const ids = [...MAIN_BUTTONS].filter((id) => id in NAV_INK_W);
    const ink = ids.reduce((sum, id) => sum + NAV_INK_W[id], 0) * NAV_SCALE;
    const gap = (NAV_X1 - NAV_X0 - ink) / Math.max(1, ids.length - 1);
    let x = NAV_X0;
    for (const id of ids) {
      const b = this.navButtons.get(id);
      if (b) {
        b.scale.set(NAV_SCALE);
        b.position.set(
          x - NAV_INK_OFF_X * NAV_SCALE,
          NAV_MID_Y - NAV_INK_OFF_MID_Y * NAV_SCALE,
        );
      }
      x += NAV_INK_W[id] * NAV_SCALE + gap;
    }
  }

  private showLoadError(): void {
    if (!this.loadErrorTxt) {
      this.loadErrorTxt = new Text({
        roundPixels: true,
        text: "MATCH FAILED TO START — see the console",
        style: {
          fontFamily: ["QTypeSquare-Bold", "Verdana", "sans-serif"],
          fontSize: 14, fill: 0xff3300,
        },
      });
      this.loadErrorTxt.anchor.set(0.5, 0);
      this.loadErrorTxt.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 30);
      this.chrome.addChild(this.loadErrorTxt);
    }
    this.loadErrorTxt.visible = this.loadErrorTimer > 0;
  }

  private fitBar(t: Text, boxW: number): void {
    const room = GAME_WIDTH - t.getGlobalPosition().x - BAR_EDGE_PAD;
    fitText(t, boxW > 0 ? Math.min(boxW, room) : room);
  }

  private refreshChrome(): void {
    const stages = SD.stages.length;
    const visible = (id: string): boolean => {
      if (id === "options") return true;
      if (stages > 3) return true;
      if (stages === 2) return id === "missions" || id === "heroes";
      if (stages === 3) return id === "missions" || id === "heroes" || id === "workshop";
      return false;
    };

    const activeTab = PARENT_TAB[this.curFrame] ?? this.curFrame;
    for (const [id, b] of this.navButtons) {
      b.visible = visible(id);
      b.setState(id === activeTab ? "over" : "up");
    }
    if (this.appButton) this.appButton.visible = this.curFrame === "missions";

    SD.setFunds();
    if (this.fundsTxt) {
      this.fundsTxt.text = `$${UT.addNumCommas(SD.funds)}`;
      this.fitBar(this.fundsTxt, this.fundsMaxW);
    }
    if (this.dayTxt) {
      this.dayTxt.text = UT.addNumCommas(SD.day);
      this.fitBar(this.dayTxt, this.dayMaxW);
    }
    this.applyTutorial();
  }

  private applyTutorial(): void {
    const stages = SD.stages.length;
    const bp = SD.bpBuilt.length;
    const frame = this.curFrame;
    let show = 0;
    if (frame === "missions") {
      if (stages === 1) show = 1;
      else if (stages === 2 && SD.heroes.length === 1) show = 2;
      else if (stages === 3 && bp === 11) show = 4;
    } else if (frame === "heroes") {
      if (stages === 2 && SD.heroes.length === 1) show = 3;
      else if (stages === 3 && bp === 11) show = 4;
    } else if (frame === "deploy") {
      if (stages === 2 && (SD.squad.length < 2 || SD.squad[1] === -1)
          && SD.curStage === 1) show = 6;
    } else if (frame === "workshop") {
      if (stages === 3 && bp === 11) show = 5;
    }

    this.tutorialFrame = show;
    const rec = MenuExtras.tutorial(show);
    this.tutorialArt.visible = !!rec;
    if (!rec) return;
    this.tutorialArt.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
    this.tutorialArt.scale.set(1 / EXTRAS_SCALE);
    this.tutorialArt.position.set(0, 0);
    this.tutorialArt.texture = MenuExtras.texture(rec);
  }

  enterFrame(dt: number): void {
    SH.enterFrame();
    setHitOrigin(0, 0);
    if (this.getItem.isOpen) {
      this.getItem.update();
      if (Input.mousePressed) this.getItem.click();
      return;
    }

    setHitOrigin(this.contentX, this.root.y);
    const activeTab = PARENT_TAB[this.curFrame] ?? this.curFrame;
    for (const [id, b] of this.navButtons) {
      if (id === activeTab) continue;
      b.setState(this.hitButton(b) ? "over" : "up");
    }
    Object.keys(NAV_INK_W).forEach((id, order) => {
      const b = this.navButtons.get(id);
      if (!b?.visible) return;
      focusable(...b.hitBox(), { tab: "nav", order });
      if (id === activeTab) Focus.activeTab("nav", order);
    });
    for (const s of this.socialButtons) {
      s.btn.setState(this.hitButton(s.btn) ? "over" : "up");
    }
    for (const [id, b] of this.navButtons) {
      if (!b.visible || !this.hitButton(b)) continue;
      const [x, y, w, h] = b.hitBox();
      this.tooltipView.show(id, x, y, w, h);
      break;
    }
    if (this.appButton) {
      this.appButton.setState(this.hitButton(this.appButton) ? "over" : "up");
      this.appButton.refresh();
    }
    refreshTex(this.plateLayer);
    this.layoutEdges();
    this.bg.update();

    if (this.loadErrorTimer > 0) {
      this.loadErrorTimer -= dt;
      this.showLoadError();
    }
    for (const { sp, rec } of this.logoSprites) sp.texture = MenuExtras.texture(rec);
    if (this.tutorialFrame) {
      const rec = MenuExtras.tutorial(this.tutorialFrame);
      this.tutorialArt.texture = MenuExtras.texture(rec);
    }

    setHitOrigin(this.contentX, this.root.y + PAGE_TOP);
    this.page?.update(dt);
    setHitOrigin(0, 0);

    this.tooltipView.update();

    if (Input.mousePressed) this.onClick();
  }

  private hitButton(b: {
    visible: boolean;
    hitBox(): [number, number, number, number];
  }): boolean {
    if (!b.visible) return false;
    const [x, y, w, h] = b.hitBox();
    return hitTest(x, y, w, h);
  }

  private onClick(): void {
    setHitOrigin(this.contentX, this.root.y);
    for (const [id, b] of this.navButtons) {
      if (this.hitButton(b)) {
        SH.playSound("S_Empty");
        this.goto(id);
        return;
      }
    }
    for (const s of this.socialButtons) {
      if (this.hitButton(s.btn)) {
        SH.playSound("S_Click");
        s.go();
        return;
      }
    }
    for (const { sp, rec, armor } of this.logoSprites) {
      if (hitTest(sp.x - rec.ox, sp.y - rec.oy, rec.w, rec.h)) {
        if (armor) urlArmor(); else urlNotDoppler();
        return;
      }
    }
    if (this.appButton?.visible && this.hitButton(this.appButton)) {
      SH.playSound("S_Powerup");
      this.goto("appstore");
      return;
    }
    setHitOrigin(this.contentX, this.root.y + PAGE_TOP);
    this.page?.onClick();
    setHitOrigin(0, 0);
  }

  override get padFocus(): boolean {
    return true;
  }

  override get focusKeys(): boolean {
    return true;
  }

  resize(): void {
    this.anchor();
    this.page?.layout(DESIGN_WIDTH, PAGE_BOTTOM - PAGE_TOP);
    this.getItem.layout();
    this.refreshChrome();
  }

  destructor(): void {
    this.page?.destroy();
    super.destructor();
  }
}
