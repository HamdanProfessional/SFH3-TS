import {
  CELL, MATERIALS, ITEM_KINDS, MAX_H, MAX_HOLDS, MAX_ITEMS, MAX_JUMPS, MAX_SPAWNS, MAX_W, MIN_H,
  MIN_W, SIZE_PRESETS,
  blankMap, cleanName, type CustomMap, type EdDecal, type EdFlag, type EdHold, type EdItem, type EdJump,
  type EdSpawn, type ItemKind,
} from "./format";
import { buildNav, checkMap, lift, settle, type NavGraph } from "./build";
import { THEMES, cellTint, shade } from "./art";
import {
  HISTORY_STEPS, History, MIRROR_DIRS, RESIZE_ANCHORS, clearArea, copyArea, flipClip, mirrorMap,
  mirrorPoint, mirrorRect, pasteClip, resizeMap, swapTeam, type CellRect, type Clip, type MirrorDir,
} from "./edit";
import { PIECES, makePiece, type PieceKey } from "./pieces";
import { drawDecal } from "./art";
import { backdropUrls, stockArtRect, type StockArtRect } from "../game/maps";
import { importStockMap, stockMaps } from "./importStock";
import { PLAY_MODES, type PlayOptions } from "./playtest";
import {
  deleteLocal, fetchShared, listLocal, loadLocal, myShared, saveLocal, shareLink, uploadMap,
} from "./store";
import { account } from "../net/account";
import { MAP_ORDER, getMap } from "../data/StatsMaps";
import { QM_DIFF_LABELS } from "../game/MatchSettings";
import {
  BTN, BTN_GO, BTN_ON, HEAD, HINT, INPUT, button as domButton, el, row as domRow,
  select as domSelect,
} from "./dom";
import { sfhCss } from "../ui/sfhCss";
import { MissionPanel, missionCard } from "./MissionPanel";
import { checkMission, type MissionResult } from "./mission";

export interface EditorState {
  map: CustomMap;
  localId: string | null;
  sharedId: string | null;
  author: string;
  dirty: boolean;
  play: PlayOptions;
  view: { zoom: number; x: number; y: number } | null;
  notice?: string;
  brief?: boolean;
  result?: MissionResult | null;
  tab?: "map" | "mission";
  history?: History;
}

export function newEditorState(map: CustomMap = blankMap(240, 120)): EditorState {
  return {
    map, localId: null, sharedId: null, author: "", dirty: false,
    play: { mode: "tdm", enemies: 4, diff: 3 }, view: null,
  };
}

export interface EditorHost {
  play(state: EditorState): void;
  playMission(state: EditorState): void;
  exit(): void;
  browse?(): void;
}

type Tool =
  | "paint" | "erase" | "rect" | "rectErase" | "line" | "ramp" | "fill" | "select" | "move"
  | "spawn1" | "spawn2" | "spawn0" | "item" | "flag1" | "flag2" | "hold" | "jump" | "remove"
  | "pan";

const TOOLS: readonly { key: Tool; label: string; hint: string }[] = [
  { key: "paint", label: "Paint", hint: "Paint the material (B)" },
  { key: "erase", label: "Erase", hint: "Erase to air (E)" },
  { key: "rect", label: "Rect", hint: "Drag a filled rectangle (R)" },
  { key: "rectErase", label: "Rect erase", hint: "Drag a rectangle of air (Shift+R)" },
  { key: "line", label: "Line", hint: "Drag a straight line with the brush (L)" },
  { key: "ramp", label: "Ramp", hint: "Drag a slope: fills solid under the line so units can walk up it" },
  { key: "fill", label: "Bucket", hint: "Flood-fill the touching area (F)" },
  { key: "select", label: "Select", hint: "Drag an area to copy, cut or delete (S). Ctrl+A: all" },
  { key: "move", label: "Move", hint: "Drag a spawn, pickup, flag or zone (M)" },
  { key: "pan", label: "Pan", hint: "Drag the view. Also: right/middle drag, or hold Space" },
  { key: "spawn1", label: "Red spawn", hint: "Team 1 spawn (team modes)" },
  { key: "spawn2", label: "Blue spawn", hint: "Team 2 spawn (team modes)" },
  { key: "spawn0", label: "FFA spawn", hint: "Free-for-all spawn (deathmatch)" },
  { key: "item", label: "Pickup", hint: "Place the pickup chosen below" },
  { key: "flag1", label: "Red flag", hint: "Red team's flag base (Capture the Flag). One per team" },
  { key: "flag2", label: "Blue flag", hint: "Blue team's flag base (Capture the Flag). One per team" },
  { key: "hold", label: "Zone", hint: `Domination zone, up to ${MAX_HOLDS}. Lettered A-E left to right` },
  { key: "jump", label: "Bot jump", hint: "Drag from where bots should jump to where they land, to get them across gaps" },
  { key: "remove", label: "Remove", hint: "Click a spawn, pickup, flag or zone to remove it" },
];

const HOLD_BOX = { dx: -120, dy: -100, w: 240, h: 200 } as const;

const BRUSHES = [1, 2, 3, 5, 8, 12] as const;
const TEAM_COLOR = ["#ffcc33", "#ff5a4a", "#4aa3ff"] as const;
const FIELD_COMMIT_MS = 700;
const CELLS_OVER_ART = 0.35;

const TOUCH_CSS = ".ed-touch .sfh-btn{padding:9px 10px 8px!important;font-size:12px!important}"
  + ".ed-touch input:not([type=checkbox]),.ed-touch select,.ed-touch textarea{font-size:16px!important}"
  + ".ed-touch input[type=checkbox]{width:20px;height:20px;vertical-align:-5px}"
  + ".ed-quick .sfh-btn{padding:8px 9px 7px!important;font-size:11px!important}";

const QUICK_TOOLS: readonly Tool[] = ["paint", "erase", "rect", "line", "fill", "move", "pan"];

function coarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

const STOP = ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click",
  "wheel", "contextmenu", "pointerdown", "pointerup"] as const;

type Sym = "off" | "lr" | "tb";

interface ObjSet { spawns: EdSpawn[]; items: EdItem[]; flags: EdFlag[]; holds: EdHold[]; jumps?: EdJump[] }

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

function paintCells(cells: Uint8Array, img: ImageData, theme: string, alpha = 1): void {
  const d = img.data;
  const back = shade(cellTint(1, theme), 0.45);
  for (let i = 0; i < cells.length; i++) {
    const id = cells[i];
    const o = i * 4;
    if (!id) { d[o + 3] = 0; continue; }
    const rgb = id === 2 ? back : cellTint(id, theme);
    d[o] = (rgb >> 16) & 255;
    d[o + 1] = (rgb >> 8) & 255;
    d[o + 2] = rgb & 255;
    d[o + 3] = Math.round((id === 2 ? 200 : MATERIALS[id]?.solid === false ? 110 : 255) * alpha);
  }
}

function backdropChoices(): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const id of MAP_ORDER) {
    const info = getMap(id);
    if (!backdropUrls(info).length) continue;
    const twin = out.find((c) => {
      const o = getMap(c.id);
      return o.bg1 === info.bg1 && o.bg2 === info.bg2 && o.sky === info.sky;
    });
    const name = info.name.charAt(0).toUpperCase() + info.name.slice(1);
    out.push({ id, label: twin ? `${name} (${twin.label} layers)` : name });
  }
  return out;
}

export class EditorView {
  private readonly root = el("div",
    "position:fixed;inset:0;z-index:40;display:flex;background:#000;user-select:none;");
  private readonly panel = el("div",
    "width:236px;flex:none;overflow-y:auto;padding:8px 10px 16px;box-sizing:border-box;"
    + "background:#1c1c1e;border-right:2px solid #7e7c80;font-size:12px;");
  private readonly main = el("div", "flex:1;position:relative;overflow:hidden;");
  private readonly canvas = el("canvas", "position:absolute;inset:0;width:100%;height:100%;"
    + "touch-action:none;cursor:crosshair;");
  private readonly status = el("div",
    "position:absolute;left:0;right:0;bottom:0;padding:4px 10px;font-size:11px;"
    + "background:rgba(0,0,0,.8);color:#b4b0b6;pointer-events:none;");
  private readonly toast = el("div",
    "position:absolute;left:50%;top:10px;transform:translateX(-50%);padding:6px 12px;"
    + "background:rgba(0,0,0,.85);border-left:4px solid #00ffff;font-size:12px;"
    + "display:none;max-width:70%;text-align:center;");
  private readonly ctx: CanvasRenderingContext2D;

  private grid = el("canvas");
  private gridCtx: CanvasRenderingContext2D;
  private gridImg: ImageData;

  private tool: Tool = "paint";
  private mat = 1;
  private brush = 2;
  private itemKind: ItemKind = "health";
  private showNav = false;
  private showGrid = true;
  private nav: { mode: string; graph: NavGraph } | null = null;

  private history!: History;
  private fieldTimer = 0;
  private fieldLabel = "";
  private sym: Sym = "off";
  private mirrorDir: MirrorDir = "lr";

  private sel: CellRect | null = null;
  private clip: Clip | null = null;
  private ghost: HTMLCanvasElement | null = null;
  private pasting = false;
  private withObjects = true;
  private pasteAir = true;

  private hover: { x: number; y: number } | null = null;
  private drag:
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { kind: "stroke"; lx: number; ly: number }
    | { kind: "rect"; x0: number; y0: number }
    | { kind: "select"; x0: number; y0: number }
    | { kind: "move"; list: { x: number; y: number }[]; i: number; end?: boolean }
    | { kind: "jump"; x: number; y: number }
    | { kind: "line"; x0: number; y0: number }
    | { kind: "ramp"; x0: number; y0: number }
    | null = null;
  private piece: Clip | null = null;
  private resizeUndo: { map: CustomMap; history: History } | null = null;
  private spaceHeld = false;
  private drawQueued = false;
  private issueTimer = 0;
  private toastTimer = 0;
  private view = { zoom: 0.3, x: 0, y: 0 };
  private dpr = 1;

  private nameInput = el("input", INPUT);
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private matBtns = new Map<number, HTMLButtonElement>();
  private brushBtns = new Map<number, HTMLButtonElement>();
  private backdropSel = el("select", INPUT + "width:auto;flex:1;min-width:0;");
  private backdropPreview = el("div", "height:56px;margin-top:4px;border-bottom:2px solid #7e7c80;"
    + "background-color:#000;background-repeat:no-repeat;");
  private themeSel = el("select", INPUT);
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private clipInfo = el("div", HINT);
  private issues = el("div", "font-size:11px;line-height:1.4;margin-top:4px;");
  private header = el("div", "font-size:11px;color:#b4b0b6;margin:6px 0 6px;line-height:1.35;");
  private listBox = el("div", "display:none;margin-top:6px;");
  private stockChk = el("input");
  private stockRow = el("label", "display:none;margin-top:6px;font-size:11px;cursor:pointer;");
  private stockImg: { id: string; img: HTMLImageElement; rect: StockArtRect } | null = null;
  private artImgs = new Map<string, HTMLImageElement>();
  private groundOverArt = false;
  private stockCache = new Map<string, Promise<CustomMap>>();
  private grabBox: HTMLDivElement | null = null;
  private grabRo: ResizeObserver | null = null;
  private linkBox = el("div", "display:none;margin-top:6px;");
  private readonly mapPane = el("div");
  private readonly tabBtns = new Map<"map" | "mission", HTMLButtonElement>();
  private readonly missions = new MissionPanel({
    map: () => this.m,
    changed: () => {
      this.state.dirty = true;
      this.fieldEdit("Mission edit");
      this.updateHeader();
      clearTimeout(this.issueTimer);
      this.issueTimer = window.setTimeout(() => this.refreshIssues(), 250);
      if (this.showNav) this.requestDraw();
    },
    play: () => this.playMission(),
  });
  private card: HTMLDivElement | null = null;

  private readonly onResize = (): void => this.fitCanvas();
  private readonly touch = coarsePointer();
  private panelOpen = true;
  private readonly panelBtn = el("button", "position:absolute;left:8px;top:8px;z-index:3;");
  private readonly quick = el("div", "position:absolute;left:52px;right:8px;top:8px;z-index:2;"
    + "display:none;flex-wrap:wrap;gap:4px;align-items:center;");
  private quickTools = new Map<Tool, HTMLButtonElement>();
  private quickCancel: HTMLButtonElement | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pending: { x: number; y: number; timer: number } | null = null;
  private pinch: { d0: number; mx: number; my: number; zoom: number; vx: number; vy: number } | null = null;
  private gestureHold = false;

  constructor(private state: EditorState, private readonly host: EditorHost) {
    this.ctx = this.canvas.getContext("2d")!;
    this.gridCtx = this.grid.getContext("2d")!;
    this.gridImg = new ImageData(1, 1);
    sfhCss();
    this.root.className = "sfh-ui";

    for (const t of STOP) this.root.addEventListener(t, (e) => e.stopPropagation());
    this.root.addEventListener("keydown", (e) => this.onKey(e, true));
    this.root.addEventListener("keyup", (e) => this.onKey(e, false));
    this.root.tabIndex = -1;

    this.buildPanel();
    this.buildQuick();
    this.main.append(this.canvas, this.status, this.toast, this.panelBtn, this.quick);
    this.root.append(this.panel, this.main);
    if (this.touch) {
      this.root.classList.add("ed-touch");
      if (!document.getElementById("ed-touch-css")) {
        const st = document.createElement("style");
        st.id = "ed-touch-css";
        st.textContent = TOUCH_CSS;
        document.head.appendChild(st);
      }
    }
    this.bindCanvas();
    this.setPanel(!(this.touch && (window.innerWidth < 1000 || window.innerHeight < 560)));
  }

  private buildQuick(): void {
    this.panelBtn.className = "sfh-btn";
    this.panelBtn.type = "button";
    this.panelBtn.style.cssText += "padding:8px 10px 7px;font-size:13px;";
    this.panelBtn.addEventListener("click", (e) => { e.preventDefault(); this.setPanel(!this.panelOpen); });
    this.quick.className = "ed-quick";
    for (const key of QUICK_TOOLS) {
      const t = TOOLS.find((x) => x.key === key);
      if (!t) continue;
      const b = this.button(t.label, () => this.setTool(key), t.hint);
      this.quickTools.set(key, b);
      this.quick.appendChild(b);
    }
    this.quick.appendChild(this.button("↶", () => this.undoStep(false), "Undo"));
    this.quick.appendChild(this.button("↷", () => this.undoStep(true), "Redo"));
    this.quickCancel = this.button("Cancel", () => {
      this.pasting = false;
      this.piece = null;
      this.drag = null;
      this.syncButtons();
      this.requestDraw();
    }, "Stop pasting or placing a piece");
    this.quick.appendChild(this.quickCancel);
    const go = this.button("▶ Play", () => this.play(), "Play this map against bots");
    go.style.cssText += BTN_GO + "width:auto;margin-top:0;padding:8px 12px 7px;";
    this.quick.appendChild(go);
  }

  private setPanel(open: boolean): void {
    this.panelOpen = open;
    this.panel.style.display = open ? "block" : "none";
    this.quick.style.display = open ? "none" : "flex";
    this.panelBtn.textContent = open ? "◀" : "☰";
    this.panelBtn.title = open ? "Hide the panel" : "Show the panel";
    this.fitCanvas();
    this.syncButtons();
  }

  mount(): void {
    document.body.appendChild(this.root);
    window.addEventListener("resize", this.onResize);
    this.loadState(this.state, !this.state.view);
    this.root.focus();
    if (this.state.notice) { this.flash(this.state.notice, true); this.state.notice = undefined; }
    if (this.state.result) this.showResult(this.state.result);
    else if (this.state.brief) this.showBrief();
    this.state.result = null;
    this.state.brief = false;
  }

  unmount(): void {
    window.removeEventListener("resize", this.onResize);
    this.flushField();
    clearTimeout(this.issueTimer);
    clearTimeout(this.toastTimer);
    this.root.remove();
  }

  private get m(): CustomMap {
    return this.state.map;
  }

  private loadState(s: EditorState, fit: boolean): void {
    this.flushField();
    this.state = s;
    this.closeCard();
    if (!s.history || s.history.map !== s.map) s.history = new History(s.map);
    this.history = s.history;
    this.sel = null;
    this.pasting = false;
    this.grid.width = s.map.w;
    this.grid.height = s.map.h;
    this.gridImg = this.gridCtx.createImageData(s.map.w, s.map.h);
    this.syncPanel();
    this.fitCanvas();
    if (fit || !s.view) this.fitView();
    else this.view = { ...s.view };
    this.changed(false);
  }

  private changed(dirty = true): void {
    if (dirty) this.state.dirty = true;
    this.nav = null;
    this.paintGrid();
    this.updateHeader();
    clearTimeout(this.issueTimer);
    this.issueTimer = window.setTimeout(() => this.refreshIssues(), 250);
    this.requestDraw();
  }

  private commit(label: string): void {
    this.flushField();
    const m = this.m;
    for (const list of [m.spawns, m.items, m.flags, m.holds] as { x: number; y: number }[][]) {
      for (const o of list) o.y = lift(m, o.x, o.y);
    }
    this.history.commit(label);
    this.changed();
    this.syncHistory();
  }

  private fieldEdit(label: string): void {
    this.fieldLabel = label;
    clearTimeout(this.fieldTimer);
    this.fieldTimer = window.setTimeout(() => this.flushField(), FIELD_COMMIT_MS);
  }

  private flushField(): void {
    clearTimeout(this.fieldTimer);
    this.fieldTimer = 0;
    if (!this.fieldLabel) return;
    const label = this.fieldLabel;
    this.fieldLabel = "";
    if (this.history.commit(label)) this.syncHistory();
  }

  private undoStep(redo: boolean): void {
    this.flushField();
    this.drag = null;
    if (!redo && !this.history.canUndo && !this.history.pending() && this.resizeUndo) {
      const r = this.resizeUndo;
      this.resizeUndo = null;
      this.loadState({ ...this.state, map: r.map, dirty: true, history: r.history }, true);
      this.flash("Undid: Resize");
      return;
    }
    const label = redo ? this.history.redo() : this.history.undo();
    if (label === null) {
      this.flash(redo ? "Nothing to redo" : "Nothing to undo");
      this.syncHistory();
      return;
    }
    this.syncFields();
    this.changed();
    this.syncHistory();
    this.flash(`${redo ? "Redid" : "Undid"}: ${label}`);
  }

  private syncHistory(): void {
    if (this.undoBtn) this.undoBtn.disabled = !this.history.canUndo && !this.fieldLabel;
    if (this.redoBtn) this.redoBtn.disabled = !this.history.canRedo;
  }

  private section(title: string, into: HTMLElement = this.mapPane): HTMLDivElement {
    const d = el("div", "margin-top:10px;");
    d.appendChild(el("div", HEAD + "font-size:12px;margin-bottom:4px;", title));
    into.appendChild(d);
    return d;
  }

  private button(label: string, run: () => void, hint = ""): HTMLButtonElement {
    return domButton(label, run, hint);
  }

  private row(...kids: HTMLElement[]): HTMLDivElement {
    return domRow(...kids);
  }

  private select(sel: HTMLSelectElement, opts: [string, string][], value: string,
                 on: (v: string) => void): HTMLSelectElement {
    return domSelect(sel, opts, value, on);
  }

  private buildPanel(): void {
    const p = this.panel;
    p.appendChild(el("div",
      "font-family:Xoireqe,QTypeSquare-Bold,Verdana,sans-serif;font-size:20px;color:#ffcc00;"
      + "letter-spacing:1px;",
      "MAP EDITOR"));
    p.appendChild(el("div",
      "font-size:11px;color:#b4b0b6;line-height:1.35;margin-top:2px;",
      "Custom maps are single-player only: play tests pay no funds or EXP, "
      + "and they cannot be hosted on a multiplayer server."));
    p.appendChild(this.header);

    const file = this.section("Map", p);
    this.nameInput.maxLength = 32;
    this.nameInput.addEventListener("input", () => {
      this.m.name = cleanName(this.nameInput.value);
      this.state.dirty = true;
      this.fieldEdit("Rename");
      this.syncHistory();
      this.updateHeader();
    });
    this.nameInput.addEventListener("change", () => this.flushField());
    file.appendChild(this.nameInput);
    const size = el("select", INPUT + "margin-top:4px;");
    this.select(size, SIZE_PRESETS.map((s, i) => [String(i), s.label]), "1", () => {});
    file.appendChild(size);
    file.appendChild(this.row(
      this.button("New", () => {
        if (!this.confirmDiscard()) return;
        const s = SIZE_PRESETS[Number(size.value)] ?? SIZE_PRESETS[1];
        const next = { ...this.state, map: blankMap(s.w, s.h), localId: null, sharedId: null,
          author: "", dirty: false, view: null };
        this.loadState(next, true);
      }, "Start a new map of the size above"),
      this.button("Save", () => this.save(), "Save in this browser"),
      this.button("Open…", () => this.toggleList(), "Your saved and shared maps"),
      this.button("Exit", () => { if (this.confirmDiscard()) this.host.exit(); }),
    ));
    file.appendChild(this.listBox);

    const rw = el("input", INPUT + "width:64px;");
    const rh = el("input", INPUT + "width:64px;");
    for (const [inp, lo, hi] of [[rw, MIN_W, MAX_W], [rh, MIN_H, MAX_H]] as const) {
      inp.type = "number";
      inp.step = String(CELL * 10);
      inp.min = String(lo * CELL);
      inp.max = String(hi * CELL);
    }
    const anchorSel = el("select", INPUT + "margin-top:4px;");
    this.select(anchorSel, RESIZE_ANCHORS.map((a) => [a.key, a.label]), RESIZE_ANCHORS[0].key, () => {});
    const resizeBox = el("div", "display:none;margin-top:6px;");
    const sizeRow = this.row(rw, el("span", "align-self:center;font-size:11px;", "x"), rh,
      this.button("Apply", () => {
        this.doResize(Number(rw.value), Number(rh.value), anchorSel.value);
        resizeBox.style.display = "none";
      }, "Change the map's size; the ground and objects are kept by the anchor below"));
    sizeRow.style.flexWrap = "nowrap";
    resizeBox.append(sizeRow, anchorSel);
    file.appendChild(this.row(this.button("Resize…", () => {
      const open = resizeBox.style.display === "none";
      resizeBox.style.display = open ? "block" : "none";
      rw.value = String(this.m.w * CELL);
      rh.value = String(this.m.h * CELL);
    }, "Make this map bigger or smaller")));
    file.appendChild(resizeBox);

    const stock = el("select", INPUT + "width:auto;flex:1;min-width:0;");
    this.select(stock, stockMaps().map((m) => [m.id, m.name]), "street", () => {});
    const importBtn = this.button("Import", () => {
      importBtn.disabled = true;
      void this.openStock(stock.value).finally(() => { importBtn.disabled = false; });
    }, "Start from a campaign map, with its original art");
    const stockRow = this.row(el("span", "font-size:11px;color:#b4b0b6;align-self:center;",
      "Campaign:"), stock, importBtn);
    stockRow.style.flexWrap = "nowrap";
    file.appendChild(stockRow);

    const tabs = el("div", "display:flex;gap:4px;margin-top:10px;");
    for (const [k, label] of [["map", "MAP"], ["mission", "MISSION"]] as const) {
      const b = this.button(label, () => this.setTab(k));
      this.tabBtns.set(k, b);
      tabs.appendChild(b);
    }
    p.append(tabs, this.mapPane, this.missions.root);

    const edit = this.section("Edit");
    this.undoBtn = this.button("↶ Undo", () => this.undoStep(false),
      `Ctrl+Z. The last ${HISTORY_STEPS} edits, a whole stroke each`);
    this.redoBtn = this.button("↷ Redo", () => this.undoStep(true), "Ctrl+Y or Ctrl+Shift+Z");
    edit.appendChild(this.row(this.undoBtn, this.redoBtn));
    edit.appendChild(this.row(
      this.button("Copy", () => this.copySel(false), "Ctrl+C: copy the selected area"),
      this.button("Cut", () => this.copySel(true), "Ctrl+X"),
      this.button("Paste", () => this.startPaste(), "Ctrl+V: place with a click, Esc cancels"),
      this.button("Delete", () => this.clearSel(), "Del: clear the selected area to air"),
    ));
    edit.appendChild(this.row(
      this.button("Flip ↔", () => this.flip(true), "Mirror the clipboard left-right (H)"),
      this.button("Flip ↕", () => this.flip(false), "Mirror the clipboard top-bottom (V)"),
      this.button("All", () => this.selectAll(), "Ctrl+A: select the whole map"),
    ));
    const objChk = el("input");
    objChk.type = "checkbox";
    objChk.checked = this.withObjects;
    objChk.addEventListener("change", () => { this.withObjects = objChk.checked; });
    const airChk = el("input");
    airChk.type = "checkbox";
    airChk.checked = this.pasteAir;
    airChk.addEventListener("change", () => { this.pasteAir = airChk.checked; this.requestDraw(); });
    edit.append(
      this.checkLabel(objChk, "Include spawns, pickups, flags, zones"),
      this.checkLabel(airChk, "Paste the air too"),
      this.clipInfo,
    );
    this.updateClipInfo();

    const tools = this.section("Tools");
    const tr = this.row();
    for (const t of TOOLS) {
      const b = this.button(t.label, () => this.setTool(t.key), t.hint);
      this.toolBtns.set(t.key, b);
      tr.appendChild(b);
    }
    tools.appendChild(tr);
    const itemSel = el("select", INPUT + "margin-top:4px;");
    this.select(itemSel, ITEM_KINDS.map((k) => [k, `Pickup: ${k}`]), this.itemKind, (v) => {
      this.itemKind = v as ItemKind;
      this.setTool("item");
    });
    tools.appendChild(itemSel);

    const pieces = this.section("Pieces");
    const pieceSel = el("select", INPUT + "width:auto;flex:1;min-width:0;");
    this.select(pieceSel, PIECES.map((p) => [p.key, p.label]), PIECES[0].key, () => {});
    const placeRow = this.row(pieceSel, this.button("Place", () => this.startPiece(pieceSel.value as PieceKey),
      "Stamp a ready-made piece in the chosen material. H / V flip it before placing"));
    placeRow.style.flexWrap = "nowrap";
    pieces.appendChild(placeRow);
    const grabSel = el("select", INPUT + "width:auto;flex:1;min-width:0;");
    this.select(grabSel, stockMaps().map((s) => [s.id, s.name]), "forest", () => {});
    const grabRow = this.row(grabSel, this.button("Grab…", () => void this.openGrab(grabSel.value),
      "Take a rock, platform or any part of a campaign map, with its art, and stamp it here"));
    grabRow.style.flexWrap = "nowrap";
    pieces.append(el("div", HINT, "Or grab a piece of a campaign map, art and all:"), grabRow);

    const brush = this.section("Brush");
    const br = this.row();
    for (const n of BRUSHES) {
      const b = this.button(String(n), () => { this.brush = n; this.syncButtons(); },
        `${n * CELL}px square`);
      this.brushBtns.set(n, b);
      br.appendChild(b);
    }
    brush.appendChild(br);
    const symSel = el("select", INPUT + "margin-top:4px;");
    this.select(symSel, [
      ["off", "Symmetry: off"], ["lr", "Symmetry: left ↔ right"], ["tb", "Symmetry: top ↕ bottom"],
    ], this.sym, (v) => { this.sym = v as Sym; this.requestDraw(); });
    symSel.title = "Mirror every stroke, rectangle, fill and placed object across the middle. "
      + "Spawns and flags swap teams on the other side";
    brush.appendChild(symSel);

    const mats = this.section("Material");
    const mr = el("div", "display:grid;grid-template-columns:1fr 1fr;gap:4px;");
    for (const mt of MATERIALS) {
      if (mt.id === 0 || mt.legacy) continue;
      const b = this.button("", () => {
        this.mat = mt.id;
        if (this.tool !== "rect" && this.tool !== "fill") this.setTool("paint");
        this.syncButtons();
      }, mt.hint);
      const sw = el("span", `display:inline-block;width:10px;height:10px;margin-right:5px;`
        + `vertical-align:-1px;border:1px solid #000;background:${hex(mt.tint)};`);
      b.append(sw, document.createTextNode(mt.label));
      this.matBtns.set(mt.id, b);
      mr.appendChild(b);
    }
    mats.appendChild(mr);

    const look = this.section("Look");
    look.appendChild(el("div", "font-size:11px;color:#b4b0b6;", "Backdrop, sky and weather"));
    const choices = backdropChoices();
    this.select(this.backdropSel, choices.map((c) => [c.id, c.label]), this.m.backdrop,
      (v) => this.setBackdrop(v));
    const cycle = (k: number) => () => {
      const i = choices.findIndex((c) => c.id === this.m.backdrop);
      this.setBackdrop(choices[(i + k + choices.length) % choices.length].id);
    };
    const bdRow = this.row(this.button("◀", cycle(-1), "Previous backdrop"), this.backdropSel,
      this.button("▶", cycle(1), "Next backdrop"));
    bdRow.style.flexWrap = "nowrap";
    look.append(bdRow, this.backdropPreview);
    look.appendChild(el("div", "font-size:11px;color:#b4b0b6;margin-top:4px;", "Ground colour"));
    this.select(this.themeSel, THEMES.map((t) => [t.key, t.label]), this.m.theme,
      (v) => { this.m.theme = v; this.commit("Ground colour"); });
    look.appendChild(this.themeSel);
    this.stockChk.type = "checkbox";
    this.stockChk.addEventListener("change", () => {
      this.m.stockArt = this.stockChk.checked;
      this.commit(this.m.stockArt ? "Campaign art on" : "Campaign art off");
      this.requestDraw();
    });
    this.stockRow.append(this.stockChk, document.createTextNode(" Campaign art (the map's original painting)"));
    look.appendChild(this.stockRow);

    const mirror = this.section("Mirror");
    const dirSel = el("select", INPUT);
    this.select(dirSel, MIRROR_DIRS.map((d) => [d.key, d.label]), this.mirrorDir,
      (v) => { this.mirrorDir = v as MirrorDir; });
    mirror.append(dirSel, this.row(this.button("Make symmetric", () => this.mirror(),
      "Copy one half over the other, mirrored. Spawns and flags swap teams across. Ctrl+Z undoes it")));

    const view = this.section("View");
    const navChk = el("input");
    navChk.type = "checkbox";
    navChk.addEventListener("change", () => { this.showNav = navChk.checked; this.requestDraw(); });
    const gridChk = el("input");
    gridChk.type = "checkbox";
    gridChk.checked = true;
    gridChk.addEventListener("change", () => { this.showGrid = gridChk.checked; this.requestDraw(); });
    view.append(
      this.row(
        this.button("−", () => this.zoomBy(1 / 1.25)),
        this.button("+", () => this.zoomBy(1.25)),
        this.button("Fit", () => { this.fitView(); this.requestDraw(); }),
      ),
      this.checkLabel(navChk, "Show bot paths"),
      this.checkLabel(gridChk, "Grid"),
    );
    const overChk = el("input");
    overChk.type = "checkbox";
    overChk.addEventListener("change", () => { this.groundOverArt = overChk.checked; this.requestDraw(); });
    view.appendChild(this.checkLabel(overChk, "Show ground over props"));

    const play = this.section("Play test");
    const mode = el("select", INPUT);
    this.select(mode, PLAY_MODES.map((m) => [m.key, m.label]), this.state.play.mode, (v) => {
      this.state.play.mode = v;
      this.nav = null;
      this.refreshIssues();
      this.requestDraw();
    });
    const enemies = el("select", INPUT + "margin-top:4px;");
    this.select(enemies, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), `${n} enemies`]),
      String(this.state.play.enemies), (v) => { this.state.play.enemies = Number(v); });
    const diff = el("select", INPUT + "margin-top:4px;");
    this.select(diff, QM_DIFF_LABELS.map((l, i) => [String(i + 1), l]),
      String(this.state.play.diff), (v) => { this.state.play.diff = Number(v); });
    const go = this.button("▶  PLAY", () => this.play(), "Play this map against bots");
    go.style.cssText = BTN_GO;
    play.append(mode, enemies, diff, go, this.issues);
    play.appendChild(el("div", "font-size:10px;color:#9a979c;margin-top:4px;line-height:1.3;",
      "Team modes cap at 5 enemies. Capture the Flag needs both flags, Domination a zone. "
      + "Quick match rules: your squad against bots, nothing is earned or saved."));

    const share = this.section("Share", p);
    share.appendChild(this.button("Upload & get link", () => void this.share(),
      "Needs an online account (Multiplayer page). A mission is shared with its map"));
    share.appendChild(this.linkBox);
    const browse = this.host.browse;
    if (browse) {
      share.appendChild(this.button("Browse shared maps", () => {
        if (this.confirmDiscard()) browse();
      }, "Everybody's maps: play, rate, or edit a copy"));
    }
  }

  private checkLabel(c: HTMLInputElement, t: string): HTMLLabelElement {
    const l = el("label", "display:block;margin-top:3px;cursor:pointer;");
    l.append(c, document.createTextNode(` ${t}`));
    return l;
  }

  private syncPanel(): void {
    this.syncFields();
    this.linkBox.style.display = "none";
    this.listBox.style.display = "none";
    this.setTab(this.state.tab ?? "map");
    this.syncHistory();
    this.updateClipInfo();
  }

  private syncFields(): void {
    this.nameInput.value = this.m.name;
    this.backdropSel.value = this.m.backdrop;
    this.themeSel.value = this.m.theme;
    this.stockRow.style.display = this.m.stock ? "block" : "none";
    this.stockChk.checked = !!this.m.stockArt;
    this.showBackdrop();
    this.missions.sync();
  }

  private setBackdrop(id: string): void {
    this.m.backdrop = id;
    this.backdropSel.value = id;
    this.showBackdrop();
    this.commit("Backdrop");
  }

  private showBackdrop(): void {
    const info = getMap(this.m.backdrop);
    const only = (k: "bg1" | "bg2" | "sky"): string | undefined => backdropUrls({
      ...info, bg1: k === "bg1" ? info.bg1 : "", bg2: k === "bg2" ? info.bg2 : "",
      sky: k === "sky" ? info.sky : "",
    })[0];
    const layers = [
      { url: only("bg1"), pos: "center bottom", size: "100% auto" },
      { url: only("bg2"), pos: "center bottom", size: "100% auto" },
      { url: only("sky"), pos: "center", size: "cover" },
    ].filter((l) => l.url);
    const s = this.backdropPreview.style;
    s.backgroundImage = layers.map((l) => `url("${l.url}")`).join(", ");
    s.backgroundPosition = layers.map((l) => l.pos).join(", ");
    s.backgroundSize = layers.map((l) => l.size).join(", ");
    this.backdropPreview.title = layers.length ? info.name : "No backdrop";
  }

  private setTab(t: "map" | "mission"): void {
    this.state.tab = t;
    this.mapPane.style.display = t === "map" ? "block" : "none";
    this.missions.root.style.display = t === "mission" ? "block" : "none";
    this.syncButtons();
    clearTimeout(this.issueTimer);
    this.issueTimer = window.setTimeout(() => this.refreshIssues(), 0);
    this.requestDraw();
  }

  private navMode(): string {
    const mis = this.m.mission;
    return this.state.tab === "mission" && mis ? mis.mode : this.state.play.mode;
  }

  private syncButtons(): void {
    for (const [k, b] of this.tabBtns) {
      b.style.cssText = BTN + "flex:1;text-align:center;" + (k === (this.state.tab ?? "map") ? BTN_ON : "");
    }
    for (const [k, b] of this.toolBtns) b.style.cssText = BTN + (k === this.tool ? BTN_ON : "");
    for (const [k, b] of this.matBtns) {
      b.style.cssText = BTN + (k === this.mat ? BTN_ON : "");
    }
    for (const [k, b] of this.brushBtns) {
      b.style.cssText = BTN + "min-width:26px;text-align:center;" + (k === this.brush ? BTN_ON : "");
    }
    for (const [k, b] of this.quickTools) b.style.cssText = BTN + (k === this.tool ? BTN_ON : "");
    this.canvas.style.cursor = this.tool === "pan" ? "grab" : "crosshair";
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.pasting = false;
    this.piece = null;
    this.syncButtons();
    this.requestDraw();
  }

  private updateHeader(): void {
    const s = this.state;
    const bits = [`${s.map.w * CELL} x ${s.map.h * CELL}px`];
    if (s.sharedId) bits.push(s.author ? `shared by ${s.author}` : "shared");
    bits.push(s.dirty ? "unsaved" : s.localId ? "saved" : "not saved");
    this.header.textContent = bits.join(" · ");
  }

  private refreshIssues(): void {
    const nav = this.navGraph();
    if (this.state.tab === "mission") {
      this.missions.refresh(nav);
      if (this.showNav) this.requestDraw();
      return;
    }
    const list = checkMap(this.m, this.state.play.mode, nav);
    this.issues.innerHTML = "";
    const jumps = nav.boxes.length;
    this.issues.appendChild(el("div", "color:#9a979c;",
      `Bot graph: ${nav.points.length} waypoints, ${jumps} jumps`));
    for (const i of list) {
      this.issues.appendChild(el("div", `color:${i.level === "error" ? "#ff6666" : "#ffcc33"};`,
        `${i.level === "error" ? "✖" : "!"} ${i.text}`));
    }
    if (this.showNav) this.requestDraw();
  }

  private navGraph(): NavGraph {
    if (!this.nav || this.nav.mode !== this.navMode()) {
      this.nav = { mode: this.navMode(), graph: buildNav(this.m, this.navMode()) };
    }
    return this.nav.graph;
  }

  private flash(text: string, bad = false): void {
    this.toast.textContent = text;
    this.toast.style.display = "block";
    this.toast.style.borderColor = bad ? "#ff4444" : "#00ffff";
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast.style.display = "none"; }, 3500);
  }

  private confirmDiscard(): boolean {
    return !this.state.dirty || window.confirm("Discard the unsaved changes to this map?");
  }

  private save(): void {
    const r = saveLocal(this.state.localId, this.m, this.state.sharedId ?? undefined);
    if ("error" in r) { this.flash(r.error, true); return; }
    this.state.localId = r.id;
    this.state.dirty = false;
    this.updateHeader();
    this.flash(`Saved "${this.m.name}"`);
  }

  private async openStock(id: string): Promise<void> {
    if (!this.confirmDiscard()) return;
    try {
      const map = await importStockMap(id);
      const next = { ...this.state, map, localId: null, sharedId: null,
        author: "", dirty: true, view: null };
      this.loadState(next, true);
      this.flash(`Opened ${map.name}: its art, ground, spawns, pickups and objectives.`);
    } catch {
      this.flash("Could not load that campaign map.", true);
    }
  }

  private artImage(src: string): HTMLImageElement | null {
    let img = this.artImgs.get(src);
    if (!img) {
      const r = stockArtRect(src);
      if (!r) return null;
      img = new Image();
      img.onload = () => this.requestDraw();
      img.src = r.url.replace(/\.png(?=\?|$)/, ".webp");
      this.artImgs.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private drawDecals(g: CanvasRenderingContext2D, decals: readonly EdDecal[]): void {
    for (const d of decals) {
      const img = this.artImage(d.src);
      if (img) drawDecal(g, img, d);
    }
  }

  private stockMap(id: string): Promise<CustomMap> {
    let p = this.stockCache.get(id);
    if (!p) {
      p = importStockMap(id);
      p.catch(() => this.stockCache.delete(id));
      this.stockCache.set(id, p);
    }
    return p;
  }

  private closeGrab(): void {
    this.grabRo?.disconnect();
    this.grabRo = null;
    this.grabBox?.remove();
    this.grabBox = null;
  }

  private async openGrab(id: string): Promise<void> {
    this.closeGrab();
    const box = el("div", "position:absolute;inset:0;z-index:5;background:rgba(0,0,0,0.95);"
      + "display:flex;flex-direction:column;");
    for (const t of ["pointerdown", "pointermove", "pointerup", "wheel"]) {
      box.addEventListener(t, (e) => e.stopPropagation());
    }
    this.grabBox = box;
    this.main.appendChild(box);
    const bar = el("div", "display:flex;gap:6px;align-items:center;padding:8px;flex-wrap:wrap;");
    const title = el("div", "flex:1;min-width:160px;font-size:12px;color:#fff;",
      "Loading the campaign map…");
    const cancel = this.button("Cancel", () => this.closeGrab());
    const use = this.button("Use it", () => {});
    use.disabled = true;
    use.style.cssText += BTN_GO + "width:auto;margin-top:0;padding:8px 14px 7px;";
    bar.append(title, cancel, use);
    const wrap = el("div", "flex:1;position:relative;min-height:0;");
    const cv = el("canvas", "position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair;");
    wrap.appendChild(cv);
    box.append(bar, wrap);
    let src: CustomMap;
    try {
      src = await this.stockMap(id);
    } catch {
      title.textContent = "Could not load that campaign map.";
      return;
    }
    if (this.grabBox !== box) return;
    title.textContent = `Drag over the part of ${src.name} you want: a rock, a platform, anything.`;
    const rect = stockArtRect(id);
    const img = this.artImage(id);
    const grid = el("canvas");
    grid.width = src.w;
    grid.height = src.h;
    const gctx = grid.getContext("2d")!;
    const gimg = gctx.createImageData(src.w, src.h);
    paintCells(src.cells, gimg, src.theme, 1);
    gctx.putImageData(gimg, 0, 0);
    const W = src.w * CELL;
    const H = src.h * CELL;
    let sel: CellRect | null = null;
    let start: { x: number; y: number } | null = null;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      const k = Math.min((r.width - 16) / W, (r.height - 16) / H);
      return { k, ox: (r.width - W * k) / 2, oy: (r.height - H * k) / 2, dpr };
    };
    let v = fit();
    const cellAt = (e: PointerEvent) => ({
      x: Math.max(0, Math.min(src.w - 1, Math.floor((e.offsetX - v.ox) / v.k / CELL))),
      y: Math.max(0, Math.min(src.h - 1, Math.floor((e.offsetY - v.oy) / v.k / CELL))),
    });
    const paint = () => {
      const g = cv.getContext("2d")!;
      g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.translate(v.ox, v.oy);
      g.scale(v.k, v.k);
      g.fillStyle = "#1b2638";
      g.fillRect(0, 0, W, H);
      const live = this.artImage(id);
      if (live && rect) {
        g.imageSmoothingEnabled = true;
        g.drawImage(live, rect.x, rect.y, rect.w, rect.h);
        g.globalAlpha = 0.25;
      }
      g.imageSmoothingEnabled = false;
      g.drawImage(grid, 0, 0, W, H);
      g.globalAlpha = 1;
      if (sel) {
        const px = 1 / v.k;
        g.fillStyle = "rgba(0,229,255,0.15)";
        g.strokeStyle = "#00e5ff";
        g.lineWidth = 2 * px;
        const x = sel.ax * CELL, y = sel.ay * CELL;
        const w = (sel.bx - sel.ax + 1) * CELL, h = (sel.by - sel.ay + 1) * CELL;
        g.fillRect(x, y, w, h);
        g.strokeRect(x, y, w, h);
      }
    };
    if (!img && rect) {
      const probe = new Image();
      probe.onload = () => paint();
      probe.src = rect.url.replace(/\.png(?=\?|$)/, ".webp");
    }
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      start = cellAt(e);
      sel = { ax: start.x, ay: start.y, bx: start.x, by: start.y };
      paint();
    });
    cv.addEventListener("pointermove", (e) => {
      if (!start) return;
      const c = cellAt(e);
      sel = {
        ax: Math.min(start.x, c.x), ay: Math.min(start.y, c.y),
        bx: Math.max(start.x, c.x), by: Math.max(start.y, c.y),
      };
      paint();
    });
    const up = () => {
      start = null;
      use.disabled = !sel || (sel.bx - sel.ax < 1 && sel.by - sel.ay < 1);
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    use.onclick = (e) => {
      e.preventDefault();
      if (!sel) return;
      const clip = copyArea(src, sel, false, rect);
      this.closeGrab();
      this.piece = clip;
      this.buildGhost();
      this.pasting = true;
      this.requestDraw();
      this.flash(this.touch ? "Tap to place it. Cancel to stop"
        : "Click to place it (Shift+click places more). H / V flip it, Esc cancels");
    };
    this.grabRo = new ResizeObserver(() => { v = fit(); paint(); });
    this.grabRo.observe(wrap);
    paint();
  }

  private stockArt(): { img: HTMLImageElement; rect: StockArtRect } | null {
    const id = this.m.stock;
    if (!id || !this.m.stockArt) return null;
    if (this.stockImg?.id !== id) {
      const rect = stockArtRect(id);
      if (!rect) return null;
      const img = new Image();
      img.onload = () => this.requestDraw();
      img.src = rect.url.replace(/\.png(?=\?|$)/, ".webp");
      this.stockImg = { id, img, rect };
    }
    const s = this.stockImg;
    return s.img.complete && s.img.naturalWidth ? s : null;
  }

  private toggleList(): void {
    const box = this.listBox;
    if (box.style.display !== "none") { box.style.display = "none"; return; }
    box.style.display = "block";
    box.innerHTML = "";
    box.appendChild(el("div", "color:#b4b0b6;font-size:11px;", "Campaign maps"));
    const grid = el("div", "display:flex;flex-wrap:wrap;gap:4px;margin:3px 0 8px;");
    for (const s of stockMaps()) {
      grid.appendChild(this.button(s.name, () => {
        box.style.display = "none";
        void this.openStock(s.id);
      }, `Open ${s.name} with its original art`));
    }
    box.appendChild(grid);
    const local = listLocal();
    box.appendChild(el("div", "color:#b4b0b6;font-size:11px;", "Saved in this browser"));
    if (!local.length) box.appendChild(el("div", "color:#9a979c;font-size:11px;", "(none yet)"));
    for (const e of local) {
      const name = el("span", "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
        e.name);
      const r = el("div", "display:flex;gap:4px;align-items:center;margin-top:3px;");
      r.append(
        name,
        this.button("Open", () => {
          if (!this.confirmDiscard()) return;
          const got = loadLocal(e.id);
          if (!got) { this.flash("That map could not be read", true); return; }
          this.loadState({
            ...this.state, map: got.map, localId: e.id, sharedId: e.shared ?? null,
            author: "", dirty: false, view: null,
          }, true);
        }),
        this.button("✖", () => {
          if (!window.confirm(`Delete "${e.name}" from this browser?`)) return;
          deleteLocal(e.id);
          if (this.state.localId === e.id) this.state.localId = null;
          box.style.display = "none";
          this.toggleList();
          this.updateHeader();
        }, "Delete"),
      );
      box.appendChild(r);
    }
    if (!account()) return;
    const head = el("div", "color:#b4b0b6;font-size:11px;margin-top:6px;", "Shared by you (loading…)");
    box.appendChild(head);
    void myShared().then((rows) => {
      head.textContent = "Shared by you";
      if (!rows.length) box.appendChild(el("div", "color:#9a979c;font-size:11px;", "(none yet)"));
      for (const row of rows) {
        const r = el("div", "display:flex;gap:4px;align-items:center;margin-top:3px;");
        r.append(
          el("span", "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", row.name),
          this.button("Open", () => void this.openShared(row.id)),
          this.button("Link", () => this.showLink(row.id)),
        );
        box.appendChild(r);
      }
    }, (e: unknown) => {
      head.textContent = `Shared by you: ${e instanceof Error ? e.message : "unavailable"}`;
    });
  }

  private async openShared(id: string): Promise<void> {
    if (!this.confirmDiscard()) return;
    try {
      const s = await fetchShared(id);
      this.loadState({
        ...this.state, map: s.map, localId: null, sharedId: s.id, author: s.author,
        dirty: false, view: null,
      }, true);
    } catch (e) {
      this.flash(e instanceof Error ? e.message : "Could not open that map", true);
    }
  }

  private async share(): Promise<void> {
    if (!account()) {
      this.flash("Sign in on the Multiplayer page to share maps.", true);
      return;
    }
    if (!this.m.spawns.length) { this.flash("Place at least one spawn first.", true); return; }
    this.flash("Uploading…");
    try {
      const id = await uploadMap(this.m);
      this.state.sharedId = id;
      this.state.author = account()?.name ?? "";
      if (this.state.localId) saveLocal(this.state.localId, this.m, id);
      this.updateHeader();
      this.showLink(id);
      this.flash("Uploaded. Anyone with the link can open and play it.");
    } catch (e) {
      this.flash(e instanceof Error ? e.message : "Upload failed", true);
    }
  }

  private showLink(id: string): void {
    const box = this.linkBox;
    box.style.display = "block";
    box.innerHTML = "";
    const input = el("input", INPUT);
    input.readOnly = true;
    input.value = shareLink(id);
    input.addEventListener("focus", () => input.select());
    const copy = this.button("Copy", () => {
      input.select();
      void navigator.clipboard?.writeText(input.value).then(
        () => this.flash("Link copied"), () => this.flash("Select the link and copy it"));
    });
    box.append(input, this.row(copy));
  }

  private play(): void {
    const errors = checkMap(this.m, this.state.play.mode, this.navGraph())
      .filter((i) => i.level === "error");
    if (errors.length) { this.flash(errors[0].text, true); return; }
    this.state.view = { ...this.view };
    this.host.play(this.state);
  }

  private playMission(): void {
    const mis = this.m.mission;
    if (!mis) return;
    const nav = this.navMode() === mis.mode ? this.navGraph() : buildNav(this.m, mis.mode);
    const errors = checkMission(this.m, mis, nav).filter((i) => i.level === "error");
    if (errors.length) {
      this.closeCard();
      this.setTab("mission");
      this.flash(errors[0].text, true);
      return;
    }
    this.closeCard();
    this.state.view = { ...this.view };
    this.state.result = null;
    this.host.playMission(this.state);
  }

  private closeCard(): void {
    this.card?.remove();
    this.card = null;
  }

  private showCard(card: HTMLDivElement): void {
    this.closeCard();
    this.card = card;
    this.main.appendChild(card);
  }

  private showBrief(): void {
    const mis = this.m.mission;
    if (!mis) return;
    this.showCard(missionCard(this.m, mis, {
      author: this.state.author,
      buttons: [
        ["▶  PLAY MISSION", () => this.playMission(), true],
        ["Look at the map", () => this.closeCard(), false],
      ],
    }));
  }

  private showResult(r: MissionResult): void {
    const mis = this.m.mission;
    if (!mis) return;
    this.showCard(missionCard(this.m, mis, {
      author: this.state.author,
      result: r,
      buttons: [
        ["▶  RETRY", () => this.playMission(), true],
        ["Back to the editor", () => this.closeCard(), false],
      ],
    }));
  }

  private fitCanvas(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.main.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.requestDraw();
  }

  private fitView(): void {
    const r = this.main.getBoundingClientRect();
    const W = this.m.w * CELL;
    const H = this.m.h * CELL;
    const zoom = Math.min((r.width - 40) / W, (r.height - 60) / H);
    this.view.zoom = Math.max(0.05, Math.min(3, zoom || 0.3));
    this.view.x = (r.width - W * this.view.zoom) / 2;
    this.view.y = (r.height - 24 - H * this.view.zoom) / 2;
  }

  private zoomBy(k: number, cx?: number, cy?: number): void {
    const r = this.main.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    const z0 = this.view.zoom;
    const z1 = Math.max(0.05, Math.min(3, z0 * k));
    this.view.x = px - ((px - this.view.x) * z1) / z0;
    this.view.y = py - ((py - this.view.y) * z1) / z0;
    this.view.zoom = z1;
    this.requestDraw();
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.view.x) / this.view.zoom, y: (sy - this.view.y) / this.view.zoom };
  }

  private bindCanvas(): void {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
    }, { passive: false });
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      if (e.pointerType === "touch") {
        this.touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (this.touches.size >= 2) { this.startPinch(); return; }
        if (this.gestureHold) return;
        this.hover = this.toWorld(e.offsetX, e.offsetY);
        const x = e.offsetX, y = e.offsetY;
        this.pending = { x, y, timer: window.setTimeout(() => this.flushPending(), 120) };
        return;
      }
      const pan = e.button === 1 || e.button === 2 || this.spaceHeld || this.tool === "pan";
      if (pan) {
        this.drag = { kind: "pan", sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y };
        c.style.cursor = "grabbing";
        return;
      }
      if (e.button !== 0) return;
      this.begin(this.toWorld(e.offsetX, e.offsetY), e.shiftKey);
    });
    c.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") {
        if (!this.touches.has(e.pointerId)) return;
        this.touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (this.pinch) { this.movePinch(); return; }
        if (this.gestureHold) return;
        const p = this.pending;
        if (p) {
          if (Math.hypot(e.offsetX - p.x, e.offsetY - p.y) < 8) return;
          this.flushPending();
        }
      }
      const w = this.toWorld(e.offsetX, e.offsetY);
      this.hover = w;
      const d = this.drag;
      if (d?.kind === "pan") {
        this.view.x = d.vx + e.offsetX - d.sx;
        this.view.y = d.vy + e.offsetY - d.sy;
      } else if (d?.kind === "stroke") {
        this.strokeTo(w);
      } else if (d?.kind === "move") {
        const o = d.list[d.i];
        const p = this.clampPx(w);
        const y = Math.round(settle(this.m, p.x, p.y));
        if (d.end) {
          const j = o as EdJump;
          j.tx = p.x;
          j.ty = y;
        } else {
          o.x = p.x;
          o.y = y;
        }
      }
      this.updateStatus();
      this.requestDraw();
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerType === "touch") {
        this.touches.delete(e.pointerId);
        if (this.pinch || this.gestureHold) {
          if (this.touches.size < 2) this.pinch = null;
          if (!this.touches.size) this.gestureHold = false;
          return;
        }
        if (this.pending) this.flushPending();
      }
      const d = this.drag;
      this.drag = null;
      this.syncButtons();
      const w = this.toWorld(e.offsetX, e.offsetY);
      if (d?.kind === "rect") this.finishRect(d, w);
      else if (d?.kind === "stroke") this.commit(this.tool === "erase" ? "Erase" : "Paint");
      else if (d?.kind === "select") this.finishSelect(d, w);
      else if (d?.kind === "move") this.commit("Move");
      else if (d?.kind === "jump") this.finishJump(d, w);
      else if (d?.kind === "line") this.finishLine(d, w);
      else if (d?.kind === "ramp") this.finishRamp(d, w);
      this.requestDraw();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => { this.hover = null; this.requestDraw(); });
  }

  private flushPending(): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    if (this.tool === "pan") {
      this.drag = { kind: "pan", sx: p.x, sy: p.y, vx: this.view.x, vy: this.view.y };
      return;
    }
    this.begin(this.toWorld(p.x, p.y), false);
  }

  private startPinch(): void {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; }
    const d = this.drag;
    if (d && d.kind !== "pan") {
      this.history.revert();
      this.drag = null;
      this.changed(false);
    } else {
      this.drag = null;
    }
    const [a, b] = [...this.touches.values()];
    this.pinch = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      zoom: this.view.zoom, vx: this.view.x, vy: this.view.y,
    };
    this.gestureHold = true;
  }

  private movePinch(): void {
    const p = this.pinch;
    if (!p || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const z = Math.max(0.05, Math.min(3, (p.zoom * d) / p.d0));
    const wx = (p.mx - p.vx) / p.zoom;
    const wy = (p.my - p.vy) / p.zoom;
    this.view.zoom = z;
    this.view.x = mx - wx * z;
    this.view.y = my - wy * z;
    this.requestDraw();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "SELECT" || t.tagName === "TEXTAREA"
      || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox"));
    if (e.key === " " && !typing) {
      this.spaceHeld = down;
      e.preventDefault();
      return;
    }
    if (!down || typing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod) {
      const run: Record<string, () => void> = {
        z: () => this.undoStep(e.shiftKey),
        y: () => this.undoStep(true),
        s: () => this.save(),
        c: () => this.copySel(false),
        x: () => this.copySel(true),
        v: () => this.startPaste(),
        a: () => this.selectAll(),
      };
      const f = run[k];
      if (f) { e.preventDefault(); f(); }
      return;
    }
    if (k === "escape") {
      if (this.pasting) { this.pasting = false; this.piece = null; }
      else if (this.drag && this.drag.kind !== "pan") this.drag = null;
      else this.sel = null;
      this.requestDraw();
    } else if (k === "delete" || k === "backspace") {
      e.preventDefault();
      this.clearSel();
    } else if (k === "b") this.setTool("paint");
    else if (k === "e") this.setTool("erase");
    else if (k === "r") this.setTool(e.shiftKey ? "rectErase" : "rect");
    else if (k === "l") this.setTool("line");
    else if (k === "f") this.setTool("fill");
    else if (k === "s") this.setTool("select");
    else if (k === "m") this.setTool("move");
    else if (k === "h") this.flip(true);
    else if (k === "v") this.flip(false);
  }

  private cellOf(w: { x: number; y: number }): { x: number; y: number } {
    return { x: Math.floor(w.x / CELL), y: Math.floor(w.y / CELL) };
  }

  private inMap(w: { x: number; y: number }): boolean {
    return w.x >= 0 && w.y >= 0 && w.x < this.m.w * CELL && w.y < this.m.h * CELL;
  }

  private clampPx(w: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.round(Math.max(0, Math.min(this.m.w * CELL, w.x))),
      y: Math.round(Math.max(0, Math.min(this.m.h * CELL, w.y))),
    };
  }

  private placeAt(w: { x: number; y: number }): { x: number; y: number } {
    return { x: Math.round(w.x), y: Math.round(settle(this.m, w.x, w.y)) };
  }

  private twinOf(p: { x: number; y: number }): { x: number; y: number } | null {
    if (this.sym === "off") return null;
    const q = mirrorPoint(this.m, p, this.sym === "lr");
    return Math.abs(q.x - p.x) < CELL && Math.abs(q.y - p.y) < CELL ? null : q;
  }

  private begin(w: { x: number; y: number }, shift: boolean): void {
    this.flushField();
    if (this.pasting) { this.pasteAt(w, shift); return; }
    const c = this.cellOf(w);
    switch (this.tool) {
      case "paint":
      case "erase":
        this.stamp(c.x, c.y);
        this.drag = { kind: "stroke", lx: c.x, ly: c.y };
        this.paintGrid();
        break;
      case "rect":
      case "rectErase":
        this.drag = { kind: "rect", x0: c.x, y0: c.y };
        break;
      case "line":
        this.drag = { kind: "line", x0: c.x, y0: c.y };
        break;
      case "ramp":
        this.drag = { kind: "ramp", x0: c.x, y0: c.y };
        break;
      case "select":
        this.sel = null;
        this.drag = { kind: "select", x0: c.x, y0: c.y };
        break;
      case "move": {
        const hit = this.objectAt(w);
        if (hit) this.drag = { kind: "move", list: hit.list, i: hit.i, end: hit.end };
        break;
      }
      case "fill":
        if (!this.inMap(w)) return;
        this.flood(c.x, c.y, this.mat);
        if (this.sym !== "off") {
          const r = mirrorRect(this.m, { ax: c.x, ay: c.y, bx: c.x, by: c.y }, this.sym === "lr");
          this.flood(r.ax, r.ay, this.mat);
        }
        this.commit("Fill");
        break;
      case "spawn0":
      case "spawn1":
      case "spawn2": {
        if (!this.inMap(w)) return;
        const p = this.placeAt(w);
        const q = this.twinOf(p);
        if (this.m.spawns.length + (q ? 2 : 1) > MAX_SPAWNS) {
          this.flash(`At most ${MAX_SPAWNS} spawns`, true);
          return;
        }
        const team = Number(this.tool.slice(5)) as 0 | 1 | 2;
        this.m.spawns.push({ ...p, team });
        if (q) this.m.spawns.push({ ...q, team: swapTeam(team) });
        this.commit("Spawn");
        break;
      }
      case "item": {
        if (!this.inMap(w)) return;
        const p = this.placeAt(w);
        const q = this.twinOf(p);
        if (this.m.items.length + (q ? 2 : 1) > MAX_ITEMS) {
          this.flash(`At most ${MAX_ITEMS} pickups`, true);
          return;
        }
        this.m.items.push({ ...p, kind: this.itemKind });
        if (q) this.m.items.push({ ...q, kind: this.itemKind });
        this.commit("Pickup");
        break;
      }
      case "flag1":
      case "flag2": {
        if (!this.inMap(w)) return;
        const team = this.tool === "flag1" ? 1 : 2;
        const p = this.placeAt(w);
        const q = this.twinOf(p);
        const other = swapTeam(team);
        this.m.flags = this.m.flags.filter((f) => f.team !== team && (!q || f.team !== other));
        this.m.flags.push({ ...p, team });
        if (q) this.m.flags.push({ ...q, team: other });
        this.commit("Flag");
        break;
      }
      case "hold": {
        if (!this.inMap(w)) return;
        const p = this.placeAt(w);
        const q = this.twinOf(p);
        if (this.m.holds.length + (q ? 2 : 1) > MAX_HOLDS) {
          this.flash(`At most ${MAX_HOLDS} zones`, true);
          return;
        }
        this.m.holds.push(p);
        if (q) this.m.holds.push(q);
        this.commit("Zone");
        break;
      }
      case "jump": {
        if (!this.inMap(w)) return;
        const p = this.placeAt(w);
        this.drag = { kind: "jump", x: p.x, y: p.y };
        break;
      }
      case "remove":
        this.removeAt(w);
        break;
      case "pan":
        break;
    }
  }

  private linePoints(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      out.push({ x: Math.round(x0 + ((x1 - x0) * i) / steps), y: Math.round(y0 + ((y1 - y0) * i) / steps) });
    }
    return out;
  }

  private rampRects(x0: number, y0: number, x1: number, y1: number): CellRect[] {
    const bottom = Math.max(y0, y1);
    const out: CellRect[] = [];
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    for (let x = lo; x <= hi; x++) {
      const t = hi === lo ? 0 : (x - x0) / (x1 - x0);
      const top = Math.round(y0 + (y1 - y0) * t);
      out.push({ ax: x, ay: Math.min(top, bottom), bx: x, by: bottom });
    }
    return out;
  }

  private finishLine(d: { x0: number; y0: number }, w: { x: number; y: number }): void {
    const c = this.cellOf(w);
    for (const p of this.linePoints(d.x0, d.y0, c.x, c.y)) this.stamp(p.x, p.y);
    this.commit("Line");
  }

  private finishRamp(d: { x0: number; y0: number }, w: { x: number; y: number }): void {
    const c = this.cellOf(w);
    const v = this.brushValue();
    for (const r of this.rampRects(d.x0, d.y0, c.x, c.y)) this.fillCells(r, v);
    this.commit("Ramp");
  }

  private activeClip(): Clip | null {
    return this.piece ?? this.clip;
  }

  private startPiece(key: PieceKey): void {
    this.piece = makePiece(key, this.mat);
    this.buildGhost();
    this.pasting = true;
    this.requestDraw();
    const name = PIECES.find((p) => p.key === key)?.label ?? "piece";
    this.flash(`Click to place the ${name.toLowerCase()} (Shift+click places more). H / V flip it, Esc cancels`);
  }

  private doResize(wPx: number, hPx: number, anchor: string): void {
    const w = Math.round(wPx / CELL);
    const h = Math.round(hPx / CELL);
    if (!(w >= MIN_W && w <= MAX_W && h >= MIN_H && h <= MAX_H)) {
      this.flash(`Width ${MIN_W * CELL}-${MAX_W * CELL}px, height ${MIN_H * CELL}-${MAX_H * CELL}px`, true);
      return;
    }
    if (w === this.m.w && h === this.m.h) { this.flash("That is already the size"); return; }
    const a = RESIZE_ANCHORS.find((r) => r.key === anchor) ?? RESIZE_ANCHORS[0];
    this.flushField();
    this.history.commit("Edit");
    const before = this.m;
    const map = resizeMap(before, w, h, a.ax, a.ay);
    this.resizeUndo = { map: before, history: this.history };
    const artOff = !!before.stockArt && !map.stockArt;
    this.loadState({ ...this.state, map, dirty: true, history: undefined }, true);
    this.flash(`Resized to ${w * CELL} x ${h * CELL}px. Ctrl+Z undoes it`
      + (artOff ? ". Campaign art is off: the painting cannot move with the ground" : ""));
  }

  private finishJump(d: { x: number; y: number }, w: { x: number; y: number }): void {
    const t = this.placeAt(this.clampPx(w));
    if (Math.hypot(t.x - d.x, t.y - d.y) < 3 * CELL) {
      this.flash("Drag from the take-off point to where the bot should land", true);
      return;
    }
    const jumps = (this.m.jumps ??= []);
    const a = this.twinOf(d);
    const b = a ? mirrorPoint(this.m, t, this.sym === "lr") : null;
    if (jumps.length + (a ? 2 : 1) > MAX_JUMPS) {
      this.flash(`At most ${MAX_JUMPS} bot jumps and paths`, true);
      return;
    }
    jumps.push({ x: d.x, y: d.y, tx: t.x, ty: t.y });
    if (a && b) jumps.push({ x: a.x, y: a.y, tx: b.x, ty: b.y });
    this.commit("Bot jump");
  }

  private brushValue(): number {
    return this.tool === "erase" || this.tool === "rectErase" ? 0 : this.mat;
  }

  private fillCells(r: CellRect, v: number): void {
    const rects = this.sym === "off" ? [r] : [r, mirrorRect(this.m, r, this.sym === "lr")];
    for (const q of rects) {
      const ax = Math.max(0, q.ax);
      const bx = Math.min(this.m.w - 1, q.bx);
      if (ax > bx) continue;
      for (let y = Math.max(0, q.ay); y <= Math.min(this.m.h - 1, q.by); y++) {
        this.m.cells.fill(v, y * this.m.w + ax, y * this.m.w + bx + 1);
      }
    }
  }

  private stamp(cx: number, cy: number): void {
    const b = this.brush;
    const x0 = cx - Math.floor((b - 1) / 2);
    const y0 = cy - Math.floor((b - 1) / 2);
    this.fillCells({ ax: x0, ay: y0, bx: x0 + b - 1, by: y0 + b - 1 }, this.brushValue());
  }

  private strokeTo(w: { x: number; y: number }): void {
    const d = this.drag;
    if (d?.kind !== "stroke") return;
    const c = this.cellOf(w);
    const steps = Math.max(Math.abs(c.x - d.lx), Math.abs(c.y - d.ly));
    for (let i = 1; i <= steps; i++) {
      this.stamp(Math.round(d.lx + ((c.x - d.lx) * i) / steps),
        Math.round(d.ly + ((c.y - d.ly) * i) / steps));
    }
    d.lx = c.x;
    d.ly = c.y;
    this.paintGrid();
  }

  private rectOf(x0: number, y0: number, x1: number, y1: number): CellRect {
    const clampX = (v: number) => Math.max(0, Math.min(this.m.w - 1, v));
    const clampY = (v: number) => Math.max(0, Math.min(this.m.h - 1, v));
    return {
      ax: clampX(Math.min(x0, x1)), bx: clampX(Math.max(x0, x1)),
      ay: clampY(Math.min(y0, y1)), by: clampY(Math.max(y0, y1)),
    };
  }

  private finishRect(d: { x0: number; y0: number }, w: { x: number; y: number }): void {
    const c = this.cellOf(w);
    this.fillCells(this.rectOf(d.x0, d.y0, c.x, c.y), this.brushValue());
    this.commit(this.tool === "rectErase" ? "Rect erase" : "Rectangle");
  }

  private flood(sx: number, sy: number, v: number): void {
    const { w, h, cells } = this.m;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const from = cells[sy * w + sx];
    if (from === v) return;
    const stack = [sy * w + sx];
    while (stack.length) {
      const i = stack.pop()!;
      if (cells[i] !== from) continue;
      cells[i] = v;
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
  }

  private objectAt(w: { x: number; y: number }):
    { list: { x: number; y: number }[]; i: number; end?: boolean } | null {
    const near = (o: { x: number; y: number }) =>
      Math.abs(o.x - w.x) < 20 && w.y > o.y - 60 && w.y < o.y + 10;
    const lists: { x: number; y: number }[][] = [
      this.m.spawns, this.m.items, this.m.flags, this.m.holds,
    ];
    for (const list of lists) {
      const i = list.findIndex(near);
      if (i >= 0) return { list, i };
    }
    const jumps = this.m.jumps ?? [];
    const dot = (x: number, y: number) => Math.hypot(x - w.x, y - 12 - w.y) < 18;
    for (let i = 0; i < jumps.length; i++) {
      const j = jumps[i];
      if (j.walk) continue;
      if (dot(j.tx, j.ty)) return { list: jumps, i, end: true };
      if (dot(j.x, j.y)) return { list: jumps, i };
    }
    return null;
  }

  private removeAt(w: { x: number; y: number }): void {
    const hit = this.objectAt(w);
    if (!hit) return;
    const [o] = hit.list.splice(hit.i, 1);
    const q = this.twinOf(o);
    if (q) {
      const j = hit.list.findIndex((p) =>
        Math.abs(p.x - q.x) < 2 * CELL && Math.abs(p.y - q.y) < 2 * CELL);
      if (j >= 0) hit.list.splice(j, 1);
    }
    this.commit("Remove");
  }

  private finishSelect(d: { x0: number; y0: number }, w: { x: number; y: number }): void {
    const c = this.cellOf(w);
    this.sel = this.rectOf(d.x0, d.y0, c.x, c.y);
  }

  private selectAll(): void {
    this.setTool("select");
    this.sel = { ax: 0, ay: 0, bx: this.m.w - 1, by: this.m.h - 1 };
    this.requestDraw();
  }

  private needSel(): CellRect | null {
    if (!this.sel) this.flash("Select an area first: the Select tool (S), or Ctrl+A", true);
    return this.sel;
  }

  private copySel(cut: boolean): void {
    const r = this.needSel();
    if (!r) return;
    const c = copyArea(this.m, r, this.withObjects, this.m.stock ? stockArtRect(this.m.stock) : null);
    this.clip = c;
    this.buildGhost();
    this.updateClipInfo();
    const objs = c.spawns.length + c.items.length + c.flags.length + c.holds.length;
    const props = c.decals?.length ?? 0;
    const what = `${c.w} x ${c.h} cells${objs ? `, ${objs} object${objs > 1 ? "s" : ""}` : ""}`
      + (props ? ` and the art` : "");
    if (cut) {
      clearArea(this.m, r, this.withObjects);
      this.commit("Cut");
      this.flash(`Cut ${what}. Ctrl+V to paste`);
    } else {
      this.flash(`Copied ${what}. Ctrl+V to paste`);
    }
  }

  private clearSel(): void {
    const r = this.needSel();
    if (!r) return;
    clearArea(this.m, r, this.withObjects);
    this.commit("Delete area");
  }

  private startPaste(): void {
    this.piece = null;
    if (!this.clip) {
      this.flash("Nothing copied yet: select an area and press Ctrl+C", true);
      return;
    }
    this.buildGhost();
    this.pasting = true;
    this.requestDraw();
    this.flash("Click to paste (Shift+click keeps pasting). H / V flip it, Esc cancels");
  }

  private pasteOrigin(w: { x: number; y: number }, clip: Clip): { x: number; y: number } {
    const c = this.cellOf(w);
    return { x: c.x - (clip.w >> 1), y: c.y - (clip.h >> 1) };
  }

  private pasteAt(w: { x: number; y: number }, keep: boolean): void {
    const clip = this.activeClip();
    if (!clip) { this.pasting = false; return; }
    const piece = clip === this.piece;
    const o = this.pasteOrigin(w, clip);
    const left = pasteClip(this.m, clip, o.x, o.y, piece ? false : this.pasteAir);
    this.sel = piece ? null : this.rectOf(o.x, o.y, o.x + clip.w - 1, o.y + clip.h - 1);
    this.pasting = keep;
    if (!keep) this.piece = null;
    this.commit(piece ? "Piece" : "Paste");
    if (left.length) this.flash(`Pasted. ${left.join("; ")}`, true);
  }

  private flip(horizontal: boolean): void {
    if (this.piece && this.pasting) {
      this.piece = flipClip(this.piece, horizontal);
      this.buildGhost();
      this.requestDraw();
      this.flash(`Piece flipped ${horizontal ? "left-right" : "top-bottom"}`);
      return;
    }
    if (!this.clip) { this.flash("Nothing copied yet", true); return; }
    this.clip = flipClip(this.clip, horizontal);
    this.buildGhost();
    this.requestDraw();
    this.flash(`Clipboard flipped ${horizontal ? "left-right" : "top-bottom"}`);
  }

  private buildGhost(): void {
    const c = this.activeClip();
    if (!c) { this.ghost = null; return; }
    const g = this.ghost ?? el("canvas");
    g.width = c.w;
    g.height = c.h;
    const ctx = g.getContext("2d")!;
    const img = ctx.createImageData(c.w, c.h);
    paintCells(c.cells, img, this.m.theme, 0.7);
    ctx.putImageData(img, 0, 0);
    this.ghost = g;
  }

  private updateClipInfo(): void {
    const c = this.clip;
    this.clipInfo.textContent = c
      ? `Clipboard: ${c.w} x ${c.h} cells, ${c.spawns.length} spawns, ${c.items.length} pickups, `
        + `${c.flags.length} flags, ${c.holds.length} zones. Kept across New and Open.`
      : "Clipboard empty: drag an area with Select (S), then Ctrl+C.";
  }

  private mirror(): void {
    const dir = MIRROR_DIRS.find((d) => d.key === this.mirrorDir)!;
    const left = mirrorMap(this.m, this.mirrorDir);
    this.commit("Make symmetric");
    this.flash(`Mirrored: ${dir.label.toLowerCase()}. ${left.length ? left.join("; ") : "Ctrl+Z undoes it"}`,
      left.length > 0);
  }

  private paintGrid(): void {
    paintCells(this.m.cells, this.gridImg, this.m.theme);
    this.gridCtx.putImageData(this.gridImg, 0, 0);
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  private updateStatus(): void {
    const h = this.hover;
    const bits = [`zoom ${Math.round(this.view.zoom * 100)}%`];
    if (h && this.inMap(h)) {
      bits.unshift(`x ${Math.round(h.x)}  y ${Math.round(h.y)}`);
      const c = this.cellOf(h);
      const mt = MATERIALS[this.m.cells[c.y * this.m.w + c.x]];
      if (mt) bits.push(mt.label);
    }
    const s = this.sel;
    if (s) bits.push(`selection ${s.bx - s.ax + 1} x ${s.by - s.ay + 1}`);
    bits.push(this.touch
      ? (this.pasting ? "tap: place · Cancel to stop" : "one finger: use the tool · two fingers: pan and pinch to zoom")
      : this.pasting
        ? "click: paste · Shift+click: paste again · H / V: flip · Esc: cancel"
        : "wheel: zoom · right-drag / Space: pan · Ctrl+Z / Ctrl+Y: undo / redo");
    this.status.textContent = bits.join("   ·   ");
  }

  private draw(): void {
    if (this.quickCancel) this.quickCancel.style.display = this.pasting ? "" : "none";
    const g = this.ctx;
    const { zoom, x: vx, y: vy } = this.view;
    const W = this.m.w * CELL;
    const H = this.m.h * CELL;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#0b0e13";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    g.save();
    g.translate(vx, vy);
    g.scale(zoom, zoom);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2b3d57");
    sky.addColorStop(1, "#141b26");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const art = this.stockArt();
    if (art) {
      g.imageSmoothingEnabled = true;
      g.drawImage(art.img, art.rect.x, art.rect.y, art.rect.w, art.rect.h);
      g.globalAlpha = CELLS_OVER_ART;
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.grid, 0, 0, W, H);
    g.globalAlpha = 1;
    const decals = this.m.decals ?? [];
    if (decals.length) {
      g.imageSmoothingEnabled = true;
      this.drawDecals(g, decals);
      if (this.groundOverArt) {
        g.imageSmoothingEnabled = false;
        g.globalAlpha = CELLS_OVER_ART;
        g.drawImage(this.grid, 0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    const px = 1 / zoom;
    if (this.showGrid && zoom * CELL >= 6) {
      g.strokeStyle = "rgba(255,255,255,0.06)";
      g.lineWidth = px;
      g.beginPath();
      for (let x = 0; x <= this.m.w; x++) { g.moveTo(x * CELL, 0); g.lineTo(x * CELL, H); }
      for (let y = 0; y <= this.m.h; y++) { g.moveTo(0, y * CELL); g.lineTo(W, y * CELL); }
      g.stroke();
    }
    g.strokeStyle = "#ffcc33";
    g.lineWidth = 2 * px;
    g.strokeRect(0, 0, W, H);

    if (this.sym !== "off") {
      g.strokeStyle = "rgba(255,120,255,0.8)";
      g.lineWidth = 2 * px;
      g.setLineDash([12 * px, 8 * px]);
      g.beginPath();
      if (this.sym === "lr") { g.moveTo(W / 2, 0); g.lineTo(W / 2, H); }
      else { g.moveTo(0, H / 2); g.lineTo(W, H / 2); }
      g.stroke();
      g.setLineDash([]);
    }

    this.drawObjects(g, px, this.m, false, () => { if (this.showNav) this.drawNav(g, px); });

    const h = this.hover;
    const d = this.drag;
    if (d?.kind === "jump" && h) {
      const t = this.placeAt(this.clampPx(h));
      this.drawJump(g, px, { x: d.x, y: d.y, tx: t.x, ty: t.y }, 0.8);
    }
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = px;
    const box = (r: CellRect, fill: string) => {
      const rx = r.ax * CELL;
      const ry = r.ay * CELL;
      const rw = (r.bx - r.ax + 1) * CELL;
      const rh = (r.by - r.ay + 1) * CELL;
      g.fillStyle = fill;
      g.fillRect(rx, ry, rw, rh);
      g.strokeRect(rx, ry, rw, rh);
    };
    if ((d?.kind === "rect" || d?.kind === "select") && h) {
      const c = this.cellOf(h);
      const r = this.rectOf(d.x0, d.y0, c.x, c.y);
      box(r, d.kind === "select" ? "rgba(80,200,255,0.12)"
        : this.tool === "rectErase" ? "rgba(255,80,80,0.25)" : "rgba(255,255,255,0.2)");
      if (d.kind === "rect" && this.sym !== "off") {
        box(mirrorRect(this.m, r, this.sym === "lr"), "rgba(255,120,255,0.12)");
      }
    } else if ((d?.kind === "line" || d?.kind === "ramp") && h) {
      const c = this.cellOf(h);
      const fill = this.tool === "erase" ? "rgba(255,80,80,0.3)" : "rgba(255,255,255,0.28)";
      const rects: CellRect[] = d.kind === "ramp"
        ? this.rampRects(d.x0, d.y0, c.x, c.y)
        : this.linePoints(d.x0, d.y0, c.x, c.y).map((p) => {
          const bw = this.brush;
          const x0 = p.x - Math.floor((bw - 1) / 2);
          const y0 = p.y - Math.floor((bw - 1) / 2);
          return { ax: x0, ay: y0, bx: x0 + bw - 1, by: y0 + bw - 1 };
        });
      g.fillStyle = fill;
      for (const r of rects) {
        g.fillRect(r.ax * CELL, r.ay * CELL, (r.bx - r.ax + 1) * CELL, (r.by - r.ay + 1) * CELL);
        if (this.sym !== "off") {
          const q = mirrorRect(this.m, r, this.sym === "lr");
          g.fillRect(q.ax * CELL, q.ay * CELL, (q.bx - q.ax + 1) * CELL, (q.by - q.ay + 1) * CELL);
        }
      }
    } else if (h && !this.pasting && (this.tool === "paint" || this.tool === "erase")) {
      const c = this.cellOf(h);
      const b = this.brush;
      const x0 = c.x - Math.floor((b - 1) / 2);
      const y0 = c.y - Math.floor((b - 1) / 2);
      const r = { ax: x0, ay: y0, bx: x0 + b - 1, by: y0 + b - 1 };
      box(r, "rgba(0,0,0,0)");
      if (this.sym !== "off") box(mirrorRect(this.m, r, this.sym === "lr"), "rgba(0,0,0,0)");
    }
    if (this.sel && d?.kind !== "select") {
      const s = this.sel;
      g.strokeStyle = "#50c8ff";
      g.lineWidth = 2 * px;
      g.setLineDash([6 * px, 4 * px]);
      g.strokeRect(s.ax * CELL, s.ay * CELL, (s.bx - s.ax + 1) * CELL, (s.by - s.ay + 1) * CELL);
      g.setLineDash([]);
    }
    const clip = this.activeClip();
    if (this.pasting && clip && this.ghost && h) {
      const o = this.pasteOrigin(h, clip);
      const gx = o.x * CELL;
      const gy = o.y * CELL;
      if (this.pasteAir && clip !== this.piece) {
        g.fillStyle = "rgba(10,14,20,0.55)";
        g.fillRect(gx, gy, clip.w * CELL, clip.h * CELL);
      }
      g.drawImage(this.ghost, gx, gy, clip.w * CELL, clip.h * CELL);
      if (clip.decals?.length) {
        g.save();
        g.translate(gx, gy);
        g.globalAlpha = 0.85;
        g.imageSmoothingEnabled = true;
        this.drawDecals(g, clip.decals);
        g.restore();
      }
      g.save();
      g.translate(gx, gy);
      g.globalAlpha = 0.7;
      this.drawObjects(g, px, clip, true);
      g.restore();
      g.strokeStyle = "#50c8ff";
      g.lineWidth = 2 * px;
      g.strokeRect(gx, gy, clip.w * CELL, clip.h * CELL);
    }
    g.restore();
    this.updateStatus();
  }

  private label(g: CanvasRenderingContext2D, t: string, x: number, y: number, px: number,
                color: string): void {
    const size = Math.max(10, 12 * px);
    g.font = `bold ${size}px Verdana, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(t, x, y);
  }

  private drawJump(g: CanvasRenderingContext2D, px: number, j: EdJump, alpha = 1): void {
    const sy = j.y - 12;
    const ty = j.ty - 12;
    const cx = (j.x + j.tx) / 2;
    const cy = Math.min(sy, ty) - Math.max(40, Math.abs(j.tx - j.x) * 0.25);
    const a0 = g.globalAlpha;
    g.globalAlpha = a0 * alpha;
    g.strokeStyle = "#00e5ff";
    g.lineWidth = 3 * px;
    g.setLineDash([10 * px, 6 * px]);
    g.beginPath();
    g.moveTo(j.x, sy);
    g.quadraticCurveTo(cx, cy, j.tx, ty);
    g.stroke();
    g.setLineDash([]);
    const ang = Math.atan2(ty - cy, j.tx - cx);
    const hs = 14 * Math.max(px, 0.6);
    g.fillStyle = "#00e5ff";
    g.beginPath();
    g.moveTo(j.tx, ty);
    g.lineTo(j.tx - hs * Math.cos(ang - 0.45), ty - hs * Math.sin(ang - 0.45));
    g.lineTo(j.tx - hs * Math.cos(ang + 0.45), ty - hs * Math.sin(ang + 0.45));
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(j.x, sy, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#000";
    g.lineWidth = 2 * px;
    g.stroke();
    g.globalAlpha = a0;
  }

  private drawObjects(g: CanvasRenderingContext2D, px: number, o: ObjSet, ghost: boolean,
                      between?: () => void): void {
    for (const j of o.jumps ?? []) if (!j.walk) this.drawJump(g, px, j);
    const zones = [...o.holds].sort((a, b) => a.x - b.x);
    zones.forEach((z, i) => {
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fillRect(z.x + HOLD_BOX.dx, z.y + HOLD_BOX.dy, HOLD_BOX.w, HOLD_BOX.h);
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineWidth = 2 * px;
      g.setLineDash([8 * px, 6 * px]);
      g.strokeRect(z.x + HOLD_BOX.dx, z.y + HOLD_BOX.dy, HOLD_BOX.w, HOLD_BOX.h);
      g.setLineDash([]);
      g.fillStyle = "#e8e8e8";
      g.fillRect(z.x - 16, z.y - 6, 32, 6);
      this.label(g, ghost ? "+" : "ABCDE"[i] ?? "X", z.x, z.y - 30, px * 1.6, "#ffffff");
    });

    between?.();

    for (const f of o.flags) {
      g.fillStyle = "#111";
      g.fillRect(f.x - 2, f.y - 70, 4, 70);
      g.fillStyle = TEAM_COLOR[f.team];
      g.beginPath();
      g.moveTo(f.x + 2, f.y - 70);
      g.lineTo(f.x + 34, f.y - 58);
      g.lineTo(f.x + 2, f.y - 46);
      g.closePath();
      g.fill();
      g.strokeStyle = "#000";
      g.lineWidth = 2 * px;
      g.stroke();
      g.fillRect(f.x - 14, f.y - 4, 28, 4);
    }

    const alpha = g.globalAlpha;
    for (const s of o.spawns) {
      g.fillStyle = TEAM_COLOR[s.team];
      g.globalAlpha = alpha * 0.85;
      g.fillRect(s.x - 10, s.y - 52, 20, 52);
      g.globalAlpha = alpha;
      g.strokeStyle = "#000";
      g.lineWidth = 2 * px;
      g.strokeRect(s.x - 10, s.y - 52, 20, 52);
      this.label(g, s.team === 0 ? "F" : s.team === 1 ? "R" : "B", s.x, s.y - 26, px, "#000");
    }
    for (const it of o.items) {
      g.fillStyle = it.kind.startsWith("health") ? "#33dd66"
        : it.kind.startsWith("armor") ? "#66ccff" : "#ffcc33";
      g.fillRect(it.x - 9, it.y - 18, 18, 18);
      g.strokeStyle = "#000";
      g.lineWidth = 2 * px;
      g.strokeRect(it.x - 9, it.y - 18, 18, 18);
      this.label(g, it.kind[0].toUpperCase() + (it.kind.endsWith("big") ? "+" : ""),
        it.x, it.y - 9, px, "#000");
    }
  }

  private drawNav(g: CanvasRenderingContext2D, px: number): void {
    const nav = this.navGraph();
    const byId = new Map(nav.points.map((p) => [p.id, p]));
    g.fillStyle = "rgba(255,200,0,0.14)";
    g.strokeStyle = "rgba(255,200,0,0.6)";
    g.lineWidth = px;
    for (const b of nav.boxes) {
      g.fillRect(b.x, b.y, b.width, b.height);
      g.strokeRect(b.x, b.y, b.width, b.height);
    }
    g.lineWidth = 2 * px;
    for (const p of nav.points) {
      for (const id of p.links) {
        const q = byId.get(id);
        if (!q) continue;
        const both = q.links.includes(p.id);
        g.strokeStyle = both ? "rgba(80,255,140,0.8)" : "rgba(255,140,60,0.9)";
        g.beginPath();
        g.moveTo(p.x, p.y - 4);
        g.lineTo(q.x, q.y - 4);
        g.stroke();
        if (!both) {
          const a = Math.atan2(q.y - p.y, q.x - p.x);
          const s = 10 * px * 1.5;
          g.beginPath();
          g.moveTo(q.x, q.y - 4);
          g.lineTo(q.x - s * Math.cos(a - 0.4), q.y - 4 - s * Math.sin(a - 0.4));
          g.lineTo(q.x - s * Math.cos(a + 0.4), q.y - 4 - s * Math.sin(a + 0.4));
          g.closePath();
          g.fillStyle = g.strokeStyle;
          g.fill();
        }
      }
    }
    for (const p of nav.points) {
      g.fillStyle = "#50ff8c";
      g.beginPath();
      g.arc(p.x, p.y - 4, 5 * px * 1.4, 0, Math.PI * 2);
      g.fill();
      this.label(g, p.id, p.x, p.y - 18 * px * 1.4, px, "#c8ffd9");
    }
  }
}
