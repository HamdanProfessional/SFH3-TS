import { Container, Graphics, Sprite, type Text } from "pixi.js";
import { Screen, type ScreenClass } from "../core/Screen";
import type { Engine } from "../core/Engine";
import * as Config from "../core/Config";
import { Input } from "../core/Input";
import { SD } from "../state/SD";
import { COLOR, label, setHitOrigin } from "../ui/kit";
import {
  Arena, emptyArenaDef, type ArenaDef, type CamTarget, type NodeHoldpoint,
} from "../game/Arena";
import type { LoadedMap, BgLayer, SkyLayer } from "../game/maps";
import type { HeroArt, HeroSprite } from "../game/unitArt";
import { LABELS } from "../game/unitLabels";
import { SH } from "../audio/SH";
import { UT } from "../core/UT";
import {
  MatchSettings, MatchState, getGameMode, type MatchHost,
} from "../game/MatchSettings";
import { type AIHost, type AIKillstreak } from "../game/AI";
import { CombatWorld, tickBullets } from "../game/CombatWorld";
import {
  deviceViews, KillstreakArt, type DeviceView,
} from "../game/killstreaks/KillstreakArt";
import { createPhysWorld, type PhysWorld } from "../physics/PhysWorld";
import { loadRagdollArt } from "../physics/RagdollArt";
import type { Unit } from "../game/Unit";
import type { UnitInfo } from "../game/UnitInfo";
import type { HudLike } from "../game/types";
import { MatchInfo } from "../game/types";
import { Fx } from "../game/fx/Fx";
import { MapParticles } from "../data/StatsMapParticles";
import { NodeArt } from "../game/nodeArt";
import { FxArt } from "../assets/FxArt";
import { FxLayer } from "../ui/FxLayer";
import { LineLayer } from "../ui/LineLayer";
import { Hud, type HudHead, type HudOptions } from "../ui/Hud";
import type { NetClient } from "../net/NetClient";
import { setNetSession } from "../net/NetClient";
import { NetMatch, type SpecCam } from "../net/NetMatch";
import { TabBoard } from "../ui/TabBoard";
import { DevScript } from "../game/devScript";
import { drawBar } from "../game/plateStyle";

export type MatchUnit = Unit;

interface UnitLerp {
  px: number;
  py: number;
  cx: number;
  cy: number;
}

const TELEPORT_DIST = 150;

export interface GameScreenArg {
  map?: LoadedMap;
  hero?: HeroArt;
  arena?: ArenaDef;
  roster?: readonly UnitInfo[];
  options?: HudOptions;
  net?: NetClient;
  exitTo?: { screen: ScreenClass; arg?: unknown };
  script?: MatchScript;
}

export interface MatchScript {
  tick(host: MatchScriptHost): void;
  allowEnd(won: boolean): boolean;
  ended(won: boolean): void;
  readonly caption: string;
}

export interface MatchScriptHost {
  readonly units: readonly Unit[];
  readonly player: Unit | null;
  readonly gameStarted: boolean;
  readonly team1score: number;
  readonly team2score: number;
  say(speaker: Unit | null, text: string): void;
  endGame(won: boolean): void;
}

export class GameScreen extends Screen {
  private bgSky = new Graphics();
  private bgFar = new Container();
  private bgNear = new Container();
  readonly world = new Container();
  private mapArt: Container | null = null;
  private skySprite: Sprite | null = null;
  private skyLayer: SkyLayer | null = null;
  private bg1Layer: BgLayer | null = null;
  private bg2Layer: BgLayer | null = null;
  private readonly camPrev = { x: 0, y: 0, b1x: 0, b1y: 0, b2x: 0, b2y: 0 };
  private readonly camCur = { x: 0, y: 0, b1x: 0, b1y: 0, b2x: 0, b2y: 0 };
  private camPrimed = false;
  private demo: HeroSprite | null = null;
  private demoDir = 1;
  private demoFrame = 1;
  private demoAnim = "run1";
  private nodeGfx = new Graphics();
  private readonly nodeArt = new NodeArt();
  readonly unitCont = new Container();
  readonly bulletCont = new Container();
  readonly lineCont = new LineLayer();
  private readonly fxLayer = new FxLayer();
  private readonly fx: Fx;
  private readonly mapParticles: MapParticles;
  private readonly hpBars = new Graphics();
  private readonly ksArt = new KillstreakArt();
  readonly hud = new Hud();
  private aimer = new Graphics();
  private readonly aimerPos = { x: 0, y: 0 };

  readonly arena: Arena;
  readonly match: MatchState;
  readonly units: MatchUnit[] = [];
  readonly killstreaks: AIKillstreak[] = [];

  private combat: CombatWorld | null = null;
  private phys: PhysWorld | null = null;
  private unitViews = new Map<Unit, HeroSprite>();
  private seenSquad = -1;
  private readonly unitLerp = new Map<Unit, UnitLerp>();

  player: MatchUnit | null = null;
  private changeHero: MatchUnit | null = null;
  private _gameStarted = false;
  get gameStarted(): boolean { return this._gameStarted; }
  set gameStarted(v: boolean) {
    this._gameStarted = v;
    if (this.combat) this.combat.gameStarted = v;
  }
  gameEnded = false;
  paused = false;
  destroyed = false;
  private leaving = false;
  private endTimer = 0;
  private won = false;

  private fc = 0;
  private script = 0;
  private devScript: DevScript | null = null;
  private introTimer = 61;
  private showNodes = false;

  private readonly net: NetMatch | null = null;
  private readonly conn: NetClient | null = null;
  private readonly exitTo: GameScreenArg["exitTo"] | null = null;
  private readonly custom: MatchScript | null = null;
  private scriptHost: MatchScriptHost | null = null;
  private captionLabel: Text | null = null;

  private readonly host: MatchHost & AIHost;

  constructor(engine: Engine, arg?: unknown) {
    super(engine, arg);
    const a = (arg ?? {}) as GameScreenArg;
    const self = this;
    this.conn = a.net ?? null;
    this.exitTo = a.exitTo ?? null;
    this.custom = a.net ? null : a.script ?? null;

    this.arena = new Arena(
      a.map?.def ?? a.arena ?? emptyArenaDef(), MatchSettings.useMode, a.map?.info,
    );
    this.view.addChild(this.bgSky, this.bgFar, this.bgNear, this.world);
    this.world.addChild(
      this.nodeGfx, this.nodeArt.root, this.unitCont, this.bulletCont, this.lineCont,
    );
    this.view.addChild(this.fxLayer.root);
    this.fx = new Fx(this.fxLayer, {
      get destroyed() { return self.destroyed; },
      arena: this.arena,
      get player() { return self.player; },
      get units() { return self.units; },
    });
    this.mapParticles = new MapParticles(this.fx, MatchSettings.useMap.particles);
    this.nodeArt.build(this.arena);
    void FxArt.load();
    void this.nodeArt.load();
    if (a.map) {
      if (a.map.sky) {
        this.skyLayer = a.map.sky;
        this.skySprite = new Sprite(a.map.sky.tex);
        this.skySprite.position.set(a.map.sky.x, a.map.sky.y);
        this.view.addChildAt(this.skySprite, 1);
      }
      if (a.map.bg1) {
        this.bg1Layer = a.map.bg1;
        const s = new Sprite(a.map.bg1.tex);
        s.position.set(a.map.bg1.x, a.map.bg1.y);
        this.bgNear.addChild(s);
      }
      if (a.map.bg2) {
        this.bg2Layer = a.map.bg2;
        const s = new Sprite(a.map.bg2.tex);
        s.position.set(a.map.bg2.x, a.map.bg2.y);
        this.bgFar.addChild(s);
      }
      this.fitBackdrops();
      if (a.map.artTiles?.length) {
        this.mapArt = new Container();
        for (const t of a.map.artTiles) {
          const s = new Sprite(t.tex);
          s.position.set(t.x, t.y);
          this.mapArt.addChild(s);
        }
      } else {
        this.mapArt = new Sprite(a.map.art);
      }
      this.mapArt.position.set(a.map.artX, a.map.artY);
      this.world.addChildAt(this.mapArt, 0);
      this.hud.radar.setMap(a.map.radarTex);
    }
    if (a.map && a.hero && !a.roster?.length) {
      const d = a.hero.sprite();
      d.x = 250;
      d.y = 500;
      d.facing = 1;
      this.demo = d;
      this.unitCont.addChild(d);
    }

    if (a.roster?.length) {
      void loadRagdollArt();
      this.phys = createPhysWorld({
        walls: this.arena.physboxes.map((b) => ({
          x: b.x, y: b.y, width: b.width, height: b.height, rotation: b.rotation,
        })),
        phys: MatchSettings.useMap.phys,
        mod: MatchSettings.useMod,
        blood: SD.options.blood,
      });
      this.world.addChild(this.phys.view);
      this.combat = new CombatWorld({
        arena: this.arena,
        hud: hudSink(this.hud),
        bitscreen: this.fx.bitScreen,
        lineCont: this.lineCont,
        physWorld: this.phys,
        aimer: this.aimerPos,
        createEffect: (x, y, name) => this.fx.createEffect(x, y, name),
        createEffectAtFrame: (x, y, name, sub, frame) =>
          this.fx.createEffectAtFrame(x, y, name, sub, frame),
        createParticle: (x, y, type, rot, data, style, text, frame) =>
          this.fx.createParticle(x, y, type, rot ?? 0, data, style, text, frame),
        playScreenSound: (name) => SH.playSound(name),
      });
      MatchInfo.matchType = MatchSettings.matchType;
      MatchInfo.useMode = MatchSettings.useMode;
      MatchInfo.useScore = MatchSettings.useScore;
      MatchInfo.useMod = MatchSettings.useMod;
      MatchInfo.useExtra = MatchSettings.useExtra as Record<string, number | boolean>;

      void this.ksArt.load();
      this.combat.build(a.roster, a.net?.round?.you ?? 0);
      this.combat.spawnAll(false);
      for (const u of this.combat.units) {
        this.units.push(u);
        if (a.hero) {
          const s = a.hero.sprite();
          s.bindUnit(u);
          s.x = u.x;
          s.y = u.y;
          this.unitViews.set(u, s);
          this.unitCont.addChild(s);
        }
      }
      this.unitCont.addChild(this.ksArt.root);
      this.player = this.combat.player;
    }
    this.unitCont.addChild(this.hpBars);

    this.view.addChild(this.hud, this.aimer);

    if (a.options) {
      this.hud.setPauseText(a.options);
      this.arena.screenShake = a.options.screenShake;
      this.arena.graphLights = a.options.graphLights;
      this.arena.toggleLights();
    }

    this.host = {
      get units(): MatchUnit[] { return self.units; },
      get player(): MatchUnit | null { return self.player; },
      get holdpoints(): readonly NodeHoldpoint[] { return self.arena.holdpoints; },
      endGame: (won: boolean) => this.endGame(won),
      setScoreBar: (t1: number, s1: number, t2: number, s2: number) =>
        this.hud.setScoreBar(t1, s1, t2, s2, MatchSettings.useScore),
      get destroyed(): boolean { return self.destroyed; },
      get gameStarted(): boolean { return self.gameStarted; },
      get arena(): Arena { return self.arena; },
      get killstreaks(): readonly AIKillstreak[] { return self.killstreaks; },
      get aiEnabled(): boolean { return self.combat?.aiEnabled ?? true; },
    };

    this.match = new MatchState(this.host);
    this.match.init();

    if (this.combat) this.mapParticles.mapInit();

    const mode = getGameMode(MatchSettings.useMode);
    this.hud.setHudStuff(
      this.player?.unitInfo.cls ?? "", this.player?.unitInfo.level ?? 1, mode.name,
      this.player?.unitInfo.streak ?? "",
    );
    this.hud.setMode("start");
    this.createHeads();

    if (this.player) {
      this.arena.setFocus(this.player, this.player.gun.curGun?.vision ?? 0.5);
    }
    this.layout();

    SH.inMatch = true;
    SH.msgTimer = false;
    SH.playMusic((MatchSettings.useSong as string | null) ?? UT.randEl(SH.songList));

    if (a.net && this.combat) {
      this.net = new NetMatch(a.net, {
        get units(): readonly MatchUnit[] { return self.units; },
        get player(): MatchUnit | null { return self.player; },
        get hud(): Hud { return self.hud; },
        get fx(): Fx { return self.fx; },
        get lineCont(): LineLayer { return self.lineCont; },
        get arena(): Arena { return self.arena; },
        get phys(): PhysWorld | null { return self.phys; },
        get paused(): boolean { return self.paused; },
        setScoreBar: (t1, s1, t2, s2) =>
          self.hud.setScoreBar(t1, s1, t2, s2, MatchSettings.useScore),
        follow: (u: MatchUnit) => {
          self.player = u;
          self.arena.setFocus(u, u.gun.curGun?.vision ?? 0.5);
          self.hud.setHudStuff(u.unitInfo.cls, u.unitInfo.level,
            getGameMode(MatchSettings.useMode).name, u.unitInfo.streak);
        },
        spectating: (name: string | null, cam?: SpecCam) => self.showWatching(name, cam),
        overview: (on: boolean) => { self.overview = on; },
        notice: (text: string | null) => self.showNotice(text),
        setStarted: (started: boolean) => {
          if (started && !self.gameStarted) self.gameStarted = true;
        },
        endMatch: () => self.endGame(self.netWon()),
        heroChanged: (u: MatchUnit) => {
          if (u !== self.player) return;
          self.hud.setHudStuff(u.unitInfo.cls, u.unitInfo.level,
            getGameMode(MatchSettings.useMode).name, u.unitInfo.streak);
        },
      });
    }
  }

  private watchLabel: Text | null = null;
  private tabBoard: TabBoard | null = null;

  private tickTabBoard(): void {
    const show = Input.isDown("Tab") && this.gameStarted && !this.paused && !this.gameEnded;
    if (!show) {
      if (this.tabBoard) this.tabBoard.root.visible = false;
      return;
    }
    if (!this.tabBoard) {
      this.tabBoard = new TabBoard();
      this.view.addChild(this.tabBoard.root);
    }
    const b = this.tabBoard;
    if (!b.root.visible || this.fc % 6 === 0) {
      b.update(this.match.showScores(), this.conn ? this.conn.room?.players ?? [] : null);
    }
    b.root.visible = true;
    this.view.setChildIndex(b.root, this.view.children.length - 1);
  }


  private noticeLabel: Text | null = null;

  private showNotice(text: string | null): void {
    if (!text) {
      if (this.noticeLabel) this.noticeLabel.visible = false;
      return;
    }
    if (!this.noticeLabel) {
      this.noticeLabel = label("", 0, 0, {
        fontFamily: ["QTypeSquare-Bold", "Verdana", "sans-serif"], fontSize: 22,
        fill: 0xff5040, stroke: { color: 0x000000, width: 5 }, align: "center",
      });
      this.noticeLabel.anchor.set(0.5, 0.5);
      this.view.addChild(this.noticeLabel);
    }
    this.noticeLabel.text = text;
    this.noticeLabel.x = Config.GAME_WIDTH / 2;
    this.noticeLabel.y = Config.GAME_HEIGHT / 2 - 60;
    this.noticeLabel.visible = true;
  }

  private overview = false;

  private showWatching(name: string | null, cam: SpecCam = "follow"): void {
    if (name === null) {
      if (this.watchLabel) this.watchLabel.visible = false;
      return;
    }
    if (!this.watchLabel) {
      this.watchLabel = label("", 0, 58, {
        fontFamily: ["QTypeSquare-Bold", "Verdana", "sans-serif"], fontSize: 15,
        fill: 0xffffff, stroke: { color: 0x000000, width: 4 }, align: "center",
      });
      this.watchLabel.anchor.set(0.5, 0);
      this.view.addChild(this.watchLabel);
    }
    const touch = Input.device === "touch";
    const hint = cam === "killcam" ? (touch ? "tap to skip" : "click or Space to skip")
      : touch ? "tap to switch"
        : cam === "free" ? "WASD to move, click a player to follow   F follow   O overview"
        : "A / D or click to switch   F free camera   O overview";
    const head = cam === "killcam" ? `KILL CAM${name ? ` - ${name.toUpperCase()}` : ""}`
      : cam === "free" ? "FREE CAMERA"
      : cam === "overview" ? `OVERVIEW${name ? ` - ${name.toUpperCase()}` : ""}`
        : `WATCHING ${name.toUpperCase()}`;
    this.watchLabel.text = `${head}\n${hint}`;
    this.watchLabel.x = Config.GAME_WIDTH / 2;
    this.watchLabel.visible = true;
  }

  private netWon(): boolean {
    const p = this.player;
    const snap = this.conn?.snapshot;
    if (!p) return false;
    if (snap && (snap.s1 || snap.s2)) {
      return p.team === 1 ? snap.s1 >= snap.s2 : snap.s2 >= snap.s1;
    }
    return !this.units.some((u) => u !== p && u.pscore > p.pscore);
  }

  private layout(): void {
    const W = Config.GAME_WIDTH;
    const H = Config.GAME_HEIGHT;
    this.bgSky.clear();
    this.bgSky.rect(0, 0, W, H).fill({ color: 0x0b1016 });
    this.fitBackdrops();
    this.hud.layout();
  }

  private fitBackdrops(): void {
    const W = Config.GAME_WIDTH;
    const H = Config.GAME_HEIGHT;

    if (this.skySprite && this.skyLayer) {
      const t = this.skyLayer.tex;
      const k = Math.max(1, (W - this.skyLayer.x) / t.width,
        (H - this.skyLayer.y) / t.height);
      this.skySprite.scale.set(k);
    }

    this.arena.bg1Size = this.fitLayer(this.bgNear, this.bg1Layer, W, H);
    this.arena.bg2Size = this.fitLayer(this.bgFar, this.bg2Layer, W, H);
  }

  private fitLayer(cont: Container, layer: BgLayer | null,
                   W: number, H: number): { x: number; y: number } {
    if (!layer) return { x: 0, y: 0 };
    const t = layer.tex;
    const spanX = Math.min(layer.x + t.width, layer.useW - layer.x);
    const spanY = Math.min(layer.y + t.height, layer.useH - layer.y);
    const k = Math.max(1,
      spanX >= Config.DESIGN_WIDTH ? W / spanX : 0,
      spanY >= Config.DESIGN_HEIGHT ? H / spanY : 0);
    cont.scale.set(k);
    return { x: layer.useW * k, y: layer.useH * k };
  }

  resize(): void {
    this.layout();
  }

  enterFrame(_dt: number): void {
    if (this.destroyed || this.leaving) {
      Input.playing = false;
      this.freezeLerp();
      return;
    }
    const me = this.combat?.player ?? this.player;
    const watching = !!this.net && this.net.slot < 0;
    Input.playing = !!me && !me.dead && !watching && this.gameStarted && !this.paused
      && !this.gameEnded;
    SH.msgTimer = this.hud.storyMsgOpen;
    SH.enterFrame();
    setHitOrigin(0, 0);

    this.tickInputEvents();
    this.tickTabBoard();

    if (this.gameEnded && ++this.endTimer > 150) {
      this.goPostGame();
      return;
    }

    if (this.paused) {
      this.hud.enterFrame();
      this.tickPauseInput();
      if (!this.net) {
        this.freezeLerp();
        return;
      }
    }

    if (Input.wasPressed("Enter")) this.endGame(true);

    ++this.fc;

    this.lineCont.clear();
    this.fx.clear();

    if (!this.gameStarted && !this.net) {
      if (--this.introTimer <= 0) this.gameStarted = true;
    }

    this.tickMissionScript();
    if (this.custom) this.tickScript(this.custom);

    if (this.combat) {
      this.mapParticles.enterFrame();
      this.phys?.step();
      if (me) Input.setAimOrigin(me.x + this.arena.x, me.y - 30 + this.arena.y);
      this.aimerPos.x = Input.mouseX - this.arena.x;
      this.aimerPos.y = Input.mouseY - this.arena.y;
      if (this.net) {
        this.net.tick();
      } else {
        this.combat.update((u) => {
          if (u.human) this.tickHuman(u);
        });
        for (const p of this.arena.pickups) p.enterFrame();
        tickBullets(this.combat.bullets);
      }
      this.tickHeadInput();
      this.ksArt.enterFrame(this.net
        ? this.net.devices as unknown as DeviceView[]
        : deviceViews(this.combat.killstreaks));
      this.updateUnitViews();
      this.fx.enterFrame();
      this.lineCont.flush();
    }

    if (this.demo) this.tickDemo();

    if (!this.net) this.match.enterFrame();

    this.nodeArt.enterFrame(this.arena, this.fx);

    this.arena.enterFrame(Input.mouseX, Input.mouseY);
    this.applyCamera();

    this.tickHudObjectives();
    if (this.combat?.player) {
      this.hud.setHeadVisibility(
        !!this.combat.player.dead, this.combat.player.human);
    }
    this.hud.enterFrame();
    this.hud.radar.update(this.player, this.units, this.radarObjectives());
    this.drawAimer();
    if (Input.showHitboxes !== this.showNodes) {
      this.showNodes = Input.showHitboxes;
      this.drawNodes();
    }
  }

  private tickInputEvents(): void {
    const u = this.combat?.player ?? null;

    if (Input.wasPressed("Escape") || Input.wasPressed("KeyP")) this.togglePause();

    if (Input.wasPressed("KeyB")) this.toggleBots();

    if (u?.human && !this.net) {
      if (Input.mousePressed && this.gameStarted && !this.paused
        && !u.status.sFrozen && !u.unitInfo.extra.noShoot) {
        u.mDown = true;
      }
      if (Input.mouseReleased) {
        u.mDown = false;
        u.gun.releaseMouse();
      }
    }

    if (Input.wheelDelta) Input.wheelDelta = 0;

    if (Input.blurred && this.gameStarted && !this.gameEnded && !this.paused) {
      this.togglePause();
    }
  }

  private toggleBots(): void {
    const c = this.combat;
    if (!c) return;
    c.aiEnabled = !c.aiEnabled;
    SH.playSound(c.aiEnabled ? "S_Skill" : "S_Error");
    const u = this.player ?? c.units[0];
    if (u) this.hud.addCustomFeed(u, c.aiEnabled ? "Bots enabled" : "Bots disabled");
  }

  private tickHuman(u: MatchUnit): void {
    if (u.dead) {
      u.tickDead();
      return;
    }
    if (u.status.sFrozen) {
      u.status.EnterFrame();
      return;
    }
    u.tickArmClips();
    if (!this.gameStarted) {
      u.unitEnterFrame();
      return;
    }
    const worldX = Input.mouseX - this.arena.x;
    const worldY = Input.mouseY - this.arena.y;
    if (!u.unitInfo.extra.noAim) {
      u.aimX += (worldX - u.aimX) * 0.5;
      u.aimY += (worldY - u.aimY) * 0.5;
    }

    u.keys = 0;
    if (Input.isDown("KeyA") || Input.isDown("ArrowLeft")) u.keys |= 4;
    if (Input.isDown("KeyD") || Input.isDown("ArrowRight")) u.keys |= 8;
    if (Input.isDown("KeyS") || Input.isDown("ArrowDown")) u.keys |= 2;
    if (Input.isDown("KeyW") || Input.isDown("ArrowUp") || Input.isDown("Space")) {
      u.keys |= 1;
      if (Input.wasPressed("KeyW") || Input.wasPressed("ArrowUp")
        || Input.wasPressed("Space")) u.mov.doJump();
    }
    if (Input.wasPressed("KeyR")) u.gun.manualReload();
    if (Input.wasPressed("KeyQ") || Input.wasPressed("ShiftLeft")) u.gun.swapGuns();
    if (Input.wasPressed("KeyE") || Input.wasPressed("ControlLeft")) u.useKillstreak();
    if (Input.rightPressed) {
      if (SD.options.rightclick === 0) u.gun.manualReload();
      else if (SD.options.rightclick === 1) u.useKillstreak();
      else u.gun.swapGuns();
    }
    if (u.mDown) u.gun.shoot();

    u.unitEnterFrame();
  }

  private updateUnitViews(): void {
    for (const u of this.units) {
      let l = this.unitLerp.get(u);
      if (!l) {
        l = { px: u.x, py: u.y, cx: u.x, cy: u.y };
        this.unitLerp.set(u, l);
      }
      l.px = l.cx;
      l.py = l.cy;
      l.cx = u.x;
      l.cy = u.y;
      if (!u.visible
        || Math.abs(l.cx - l.px) > TELEPORT_DIST
        || Math.abs(l.cy - l.py) > TELEPORT_DIST) {
        l.px = l.cx;
        l.py = l.cy;
      }
      const s = this.unitViews.get(u);
      if (!s) continue;
      s.visible = u.visible;
      s.facing = u.scaleX;
      s.setState(u.MC.curAnim, u.MC.currentFrame);
    }
  }

  private drawHpBars(alpha: number): void {
    const g = this.hpBars;
    g.clear();
    for (const u of this.units) {
      if (!u.visible || u.dead) continue;
      const st = u.status;
      const l = this.unitLerp.get(u);
      const ux = l ? l.px + (l.cx - l.px) * alpha : u.x;
      const uy = l ? l.py + (l.cy - l.py) * alpha : u.y;
      const x0 = ux - 27.05;
      const y0 = uy - 87.35;
      const a = u.alpha;
      if (a <= 0) continue;

      const hpLen = st.healthBar.max;
      const arLen = Number.isFinite(st.armorBar.max) ? st.armorBar.max : 0;
      if (!(hpLen > 0)) continue;
      const width = hpLen + arLen;
      const k = width / hpLen;
      const ar = st.armorBar.cur;
      drawBar(g, x0, y0, {
        width,
        hp: st.healthBar.cur * k,
        hurt: st.hurtBar.cur * k,
        step: st.barNotchWidth * k,
        armor: arLen > 0 && Number.isFinite(ar) ? (ar / arLen) * width : 0,
        color: st.healthColor,
        alpha: a,
      });
    }
  }

  private tickDemo(): void {
    const d = this.demo;
    if (!d) return;
    const range = LABELS[this.demoAnim];
    if (++this.demoFrame > range[1]) this.demoFrame = range[0];
    d.x += this.demoDir * 2.2;
    const w = this.arena.wall.width;
    if (d.x > w - 80) { this.demoDir = -1; this.demoAnim = "runback1"; }
    else if (d.x < 80) { this.demoDir = 1; this.demoAnim = "run1"; }
    d.facing = this.demoDir;
    d.setState(this.demoAnim, this.demoFrame);
  }

  private applyCamera(): void {
    const a = this.arena;
    const p = this.camPrev, c = this.camCur;
    p.x = c.x; p.y = c.y;
    p.b1x = c.b1x; p.b1y = c.b1y;
    p.b2x = c.b2x; p.b2y = c.b2y;
    c.x = a.x;
    c.y = a.y;
    if (isFinite(a.bg1.x)) c.b1x = a.bg1.x;
    if (isFinite(a.bg1.y)) c.b1y = a.bg1.y;
    if (isFinite(a.bg2.x)) c.b2x = a.bg2.x;
    if (isFinite(a.bg2.y)) c.b2y = a.bg2.y;
    if (!this.camPrimed) {
      this.camPrimed = true;
      p.x = c.x; p.y = c.y;
      p.b1x = c.b1x; p.b1y = c.b1y;
      p.b2x = c.b2x; p.b2y = c.b2y;
    }
    this.renderFrame(1);
  }

  renderFrame(alpha: number): void {
    if (this.destroyed) return;
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const p = this.camPrev, c = this.camCur;
    const x = p.x + (c.x - p.x) * t;
    const y = p.y + (c.y - p.y) * t;
    if (this.overview) {
      const W = Config.GAME_WIDTH;
      const H = Config.GAME_HEIGHT;
      const ww = this.arena.wall.width;
      const wh = this.arena.wall.height;
      const s = Math.min(W / ww, H / wh, 1);
      const ox = (W - ww * s) / 2;
      const oy = (H - wh * s) / 2;
      this.world.scale.set(s);
      this.world.position.set(ox, oy);
      this.fxLayer.root.scale.set(s);
      this.fxLayer.root.position.set(ox - c.x * s, oy - c.y * s);
    } else if (this.world.scale.x !== 1) {
      this.world.scale.set(1);
      this.fxLayer.root.scale.set(1);
    }
    if (!this.overview) this.world.position.set(x, y);
    this.bgNear.position.set(p.b1x + (c.b1x - p.b1x) * t,
      p.b1y + (c.b1y - p.b1y) * t);
    this.bgFar.position.set(p.b2x + (c.b2x - p.b2x) * t,
      p.b2y + (c.b2y - p.b2y) * t);
    if (!this.overview) this.fxLayer.root.position.set(x - c.x, y - c.y);
    for (const [u, s] of this.unitViews) {
      if (s.visible) s.renderPose(t);
      const l = this.unitLerp.get(u);
      if (!l) continue;
      s.position.set(l.px + (l.cx - l.px) * t, l.py + (l.cy - l.py) * t);
    }
    this.phys?.renderFrame(t);
    if (this.combat) this.drawHpBars(t);
  }

  private freezeLerp(): void {
    const p = this.camPrev, c = this.camCur;
    p.x = c.x; p.y = c.y;
    p.b1x = c.b1x; p.b1y = c.b1y;
    p.b2x = c.b2x; p.b2y = c.b2y;
    for (const l of this.unitLerp.values()) {
      l.px = l.cx;
      l.py = l.cy;
    }
    for (const u of this.units) {
      u.MC.stepped = false;
      u.MC.arm1.stepped = false;
      u.MC.arm2.stepped = false;
    }
    for (const s of this.unitViews.values()) s.renderPose(1);
    this.phys?.freezeLerp();
  }

  private createHeads(): void {
    const heads: (HudHead | null)[] = [];
    if (this.conn) {
      const sq = this.conn.squad;
      this.seenSquad = this.conn.squadVersion;
      for (let i = 0; i < 5; i++) {
        const h = sq?.heroes[i];
        heads.push(h
          ? {
            hero: {
              head: Number(h.head) || 0, body: Number(h.body) || 0,
              color: Number(h.color) || 1, face: Number(h.face) || 1,
              skin: Number(h.skin) || 1, hair: Number(h.hair) || 1,
            },
            cls: String(h.cls ?? ""),
            status: 400,
          }
          : null);
      }
      this.hud.setSquadHeads(heads, sq && sq.heroes.length > 1 ? sq.next : -1);
      return;
    }
    for (let i = 0; i < 5; i++) {
      const idx = SD.squad[i] ?? -1;
      const info = i < SD.squad.length && idx >= 0 ? SD.heroes[idx] : null;
      heads.push(info
        ? {
          hero: {
            head: info.head, body: info.body, color: info.color,
            face: info.face, skin: info.skin, hair: info.hair,
          },
          cls: info.cls,
          status: info.status,
        }
        : null);
    }
    this.hud.setSquadHeads(heads, this.headSlotOf(this.player));
  }

  private headSlotOf(u: MatchUnit | null): number {
    if (!u) return -1;
    for (let i = 0; i < 5 && i < SD.squad.length; i++) {
      const idx = SD.squad[i] ?? -1;
      if (idx >= 0 && SD.heroes[idx] === u.unitInfo) return i;
    }
    return -1;
  }

  private tickHeadInput(): void {
    const c = this.combat;
    if (this.net && this.conn) {
      if (this.conn.squadVersion !== this.seenSquad) this.createHeads();
      if (!Input.mousePressed || (this.net.slot < 0)) return;
      const i = this.hud.hitHead();
      const sq = this.conn.squad;
      if (i >= 0 && sq && i < sq.heroes.length && sq.heroes.length > 1) {
        this.conn.chooseHero(i);
        this.hud.setHeadSelected(i);
      }
      return;
    }
    if (!c || this.net || !Input.mousePressed) return;

    const i = this.hud.hitHead();
    if (i >= 0) {
      const info = SD.heroes[SD.squad[i] ?? -1];
      const unit = c.units.find((u) => u.unitInfo === info);
      if (unit) {
        this.changeHero = unit;
        c.setPlayer(unit, false);
        this.player = unit;
        this.hud.setHeadSelected(i);
      }
      return;
    }

    if (this.hud.hitSelect() && this.changeHero) {
      const u = this.changeHero;
      c.setPlayer(u, true);
      this.player = u;
      this.hud.setHudStuff(u.unitInfo.cls, u.unitInfo.level,
        getGameMode(MatchSettings.useMode).name, u.unitInfo.streak);
      this.changeHero = null;
    }
  }

  private tickMissionScript(): void {
    const e = MatchSettings.useExtra as { tut1?: number; tut2?: number; developers?: unknown };
    if (e.developers && !this.net) {
      const self = this;
      (this.devScript ??= new DevScript()).tick({
        get units(): readonly Unit[] { return self.units; },
        get team1score(): number {
          return MatchSettings.useTeams ? self.match.team1score : self.player?.pscore ?? 0;
        },
        say: (u: Unit, text: string) => { self.hud.setMsg(u.unitInfo.name, text, 4, false, u.unitInfo); },
      });
    }
    if (e.tut1) {
      switch (this.script) {
        case 0:
          if (this.match.team1score === 0 && this.gameStarted
              && this.hud.mode === "idle") {
            this.hud.setMode("tutmove");
            ++this.script;
          }
          break;
        case 1:
          if (this.match.team1score >= 1) {
            this.hud.setMode("tutswitch");
            ++this.script;
          }
          break;
        case 2:
          if (this.match.team1score >= 2) {
            this.hud.setMode("idle");
            ++this.script;
          }
          break;
        case 3:
          if (this.match.team1score >= 5) {
            this.hud.setMode("tutstreak");
            ++this.script;
          }
        case 4:
          if (this.match.team1score >= 6) {
            this.hud.setMode("idle");
            ++this.script;
          }
      }
    }
    if (e.tut2) {
      switch (this.script) {
        case 0:
          if (this.match.team1score >= 5) {
            this.hud.setMode("tutmember");
            ++this.script;
          }
          break;
        case 1:
          if (this.match.team1score >= 20) {
            this.hud.setMode("idle");
            ++this.script;
          }
      }
    }
  }

  private tickScript(script: MatchScript): void {
    const self = this;
    this.scriptHost ??= {
      get units(): readonly Unit[] { return self.units; },
      get player(): Unit | null { return self.player; },
      get gameStarted(): boolean { return self.gameStarted; },
      get team1score(): number { return self.match.team1score; },
      get team2score(): number { return self.match.team2score; },
      say: (speaker: Unit | null, text: string) => {
        const u = speaker ?? this.player;
        if (u) this.hud.setMsg(u.unitInfo.name, text, 5, false, u.unitInfo);
      },
      endGame: (won: boolean) => this.endGame(won),
    };
    script.tick(this.scriptHost);
    const text = script.caption;
    if (!text && !this.captionLabel) return;
    if (!this.captionLabel) {
      this.captionLabel = label("", 0, 58, {
        fontFamily: ["QTypeSquare-Bold", "Verdana", "sans-serif"], fontSize: 15,
        fill: 0xffffff, stroke: { color: 0x000000, width: 4 }, align: "center",
      });
      this.captionLabel.anchor.set(0.5, 0);
      this.view.addChild(this.captionLabel);
    }
    if (this.captionLabel.text !== text) this.captionLabel.text = text;
    this.captionLabel.x = Config.GAME_WIDTH / 2;
    this.captionLabel.visible = !!text;
  }

  private tickHudObjectives(): void {
    if (MatchSettings.useMode === "dom") {
      this.hud.setDomination(this.arena.holdpoints.map((h) => h.curTeam));
    } else if (MatchSettings.useMode === "ctf") {
      this.hud.setCtf(
        this.arena.flag1?.team ?? 1, !!this.arena.flag1?.unitCaptured,
        this.arena.flag2?.team ?? 2, !!this.arena.flag2?.unitCaptured,
      );
    } else {
      this.hud.clearFlags();
    }
  }

  private radarObjectives(): { x: number; y: number; team: number }[] {
    if (MatchSettings.useMode === "dom") {
      return this.arena.holdpoints.map((h) => ({ x: h.x, y: h.y, team: h.curTeam }));
    }
    if (MatchSettings.useMode === "ctf") {
      return this.arena.ctfflags
        .filter((f) => !f.unitCaptured)
        .map((f) => ({ x: f.x, y: f.y, team: f.team }));
    }
    return [];
  }

  private drawAimer(): void {
    const g = this.aimer;
    g.clear();
    const u = this.player;
    if (!u || u.dead || !this.gameStarted || this.paused) return;
    if (u.unitInfo.extra.noAim) return;

    const recoil = (u.gun as { dynRecoilMod?: number }).dynRecoilMod ?? 0;
    const raw = Math.hypot(Input.mouseX - (u.x + this.arena.x), Input.mouseY - (u.y + this.arena.y));
    const dist = raw * raw * 2;
    const lineDist = Math.sqrt(Math.max(0, dist - dist * Math.cos((recoil * Math.PI) / 180)));

    const x = Input.mouseX;
    const y = Input.mouseY;
    g.circle(x, y, lineDist).stroke({ color: 0xffffff, width: 1, alpha: 0.35 });
    g.moveTo(x, y - lineDist).lineTo(x, y - lineDist - 6);
    g.moveTo(x, y + lineDist).lineTo(x, y + lineDist + 6);
    g.moveTo(x - lineDist, y).lineTo(x - lineDist - 6, y);
    g.moveTo(x + lineDist, y).lineTo(x + lineDist + 6, y);
    g.stroke({ color: 0xffffff, width: 1.5 });
  }

  private drawNodes(): void {
    const g = this.nodeGfx;
    g.clear();
    if (!this.showNodes) return;
    for (const wp of this.arena.waypoints) {
      for (const c of wp.connects) {
        g.moveTo(wp.x, wp.y - 20)
          .lineTo((wp.x + c.x) * 0.5, (wp.y + c.y) * 0.5 - 20);
      }
    }
    g.stroke({ color: 0xffff00, width: 3, alpha: 0.3 });
    for (const wp of this.arena.waypoints) {
      g.circle(wp.x, wp.y, 5).fill({ color: 0xffff00, alpha: 0.6 });
    }
    for (const ab of this.arena.aiactions) {
      g.rect(ab.x, ab.y, ab.width, ab.height)
        .stroke({ color: 0xff66ff, width: 2, alpha: 0.5 });
    }
    for (const s of [...this.arena.spawns, ...this.arena.spawnsT1, ...this.arena.spawnsT2]) {
      const col = s.team === 1 ? 0x6699ff : s.team === 2 ? 0xff6600 : 0xffffff;
      g.circle(s.x, s.y, 8).stroke({ color: col, width: 2 });
    }
  }

  override get padFocus(): boolean {
    return this.paused;
  }

  togglePause(): void {
    if (!this.gameStarted || this.gameEnded) return;
    this.paused = !this.paused;
    this.aimer.visible = !this.paused;
    if (this.paused) {
      this.hud.setMode("pause");
      this.hud.showScores(this.match.showScores());
      if (this.hud.options) this.hud.setPauseText(this.hud.options);
    } else {
      this.hud.setMode("idle");
    }
    SD.save();
  }

  private tickPauseInput(): void {
    if (!Input.mousePressed) return;
    if (this.hud.hitResume()) {
      if (this.hud.quitConfirm) this.quit();
      else this.togglePause();
      return;
    }
    if (this.hud.hitQuit()) {
      this.hud.setQuitConfirm(!this.hud.quitConfirm);
      return;
    }
    if (this.hud.hitSongNext()) {
      SH.cycleSong(1);
      if (this.hud.options) this.hud.setPauseText(this.hud.options);
      return;
    }
    if (this.hud.hitSongPrev()) {
      SH.cycleSong(-1);
      if (this.hud.options) this.hud.setPauseText(this.hud.options);
      return;
    }
    const row = this.hud.hitPauseRow();
    const o = this.hud.options;
    if (!row || !o) return;
    if (row === "song") return;
    cyclePauseOption(o, row);
    this.hud.setPauseText(o);
    this.arena.screenShake = o.screenShake;
  }

  private quit(): void {
    this.destroyed = true;
    if (this.exitTo) {
      this.engine.setScreen(this.exitTo.screen, this.exitTo.arg);
      return;
    }
    if (this.conn) {
      setNetSession(null);
      void import("./MenuScreen").then((m) => {
        this.engine.setScreen(m.MenuScreen, "multiplayer");
      });
      return;
    }
    void import("./MenuScreen").then((m) => {
      this.engine.setScreen(m.MenuScreen, "missions");
    });
  }

  endGame(won: boolean): void {
    if (this.gameEnded) return;
    if (this.custom && !this.custom.allowEnd(won)) return;
    this.gameEnded = true;
    this.custom?.ended(won);
    this.won = won;
    this.endTimer = 0;
    this.hud.showScores(this.match.showScores());
    this.hud.setEndCard(won);
    SD.save();
  }

  private goPostGame(): void {
    if (this.leaving) return;
    this.leaving = true;
    const won = this.won;
    if (this.exitTo) {
      this.engine.setScreen(this.exitTo.screen, this.exitTo.arg);
      return;
    }
    if (this.conn) {
      void import("./MenuScreen").then((m) => {
        this.engine.setScreen(m.MenuScreen, "multiplayer");
      });
      return;
    }
    if (!won) {
      void import("./MenuScreen").then((m) => {
        this.engine.setScreen(m.MenuScreen, "missions");
      });
      return;
    }
    void import("./PostGameScreen").then((m) => {
      this.engine.setScreen(m.PostGameScreen, { won });
    });
  }

  destructor(): void {
    this.destroyed = true;
    Input.playing = false;
    SH.inMatch = false;
    this.match.dispose();
    this.phys?.destroy();
    this.phys = null;
    super.destructor();
  }
}

export function cyclePauseOption(o: HudOptions, row: string): void {
  switch (row) {
    case "qual": o.graphQual = (o.graphQual + 1) % 3; break;
    case "eff": o.graphPart = (o.graphPart + 1) % 3; break;
    case "glow": o.graphLights = !o.graphLights; break;
    case "music": o.music = !o.music; break;
    case "sound": o.sound = !o.sound; break;
    case "voice": o.voices = !o.voices; break;
    case "shake": o.screenShake = !o.screenShake; break;
    case "bloody": o.screenBlood = !o.screenBlood; break;
    case "gore": o.blood = (o.blood + 1) % 3; break;
    case "right": o.rightclick = (o.rightclick + 1) % 3; break;
  }
}

function hudSink(hud: Hud): HudLike {
  return {
    setHealth: (cur, max) => hud.setHealth(cur, max),
    setArmor: (cur, max) => hud.setArmor(cur, max),
    setBloodyScreen: (alpha) => hud.setBloodyScreen(alpha),
    resetBloodyScreen: (sx, sy, frame) => hud.resetBloodyScreen(sx, sy, frame),
    addKillFeed: (killer, victim, weaponId) =>
      hud.addKillFeed(killer as never, victim as never, weaponId),
    addCustomFeed: (unit, text) => hud.addCustomFeed(unit as never, text),
    setDebug: (slot, text) => hud.setDebug(slot, text),
    setAmmoCount: (gun) => hud.setAmmoCount(gun as never),
    setGuns: (cur, next) => hud.setGuns(cur as never, next as never),
    setRespawnText: (text, color) => hud.setRespawnText(text, color),
    setPlayerInfo: (cls, level) => hud.setPlayerInfo(cls, level),
    setKillstreakNum: (amt, val) => hud.setKillstreakNum(amt, val),
    setStreakReady: (name) => hud.setStreakReady(name),
    clearStreak: () => hud.clearStreak(),
    setStreakInProgress: (label) => hud.setStreakInProgress(label),
    addKillstreakFeed: (user, name) => hud.addKillstreakFeed(user as never, name),
  };
}

export function emptyMatchNotice(): Container {
  const c = new Container();
  c.addChild(label("No units — combat core not wired in yet.", 20, 20, {
    fontSize: 12, fill: COLOR.dim,
  }));
  return c;
}
