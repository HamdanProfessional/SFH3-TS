import * as Config from "../core/Config";
import { UT } from "../core/UT";
import { getMap, type MapInfo } from "../data/StatsMaps";
import { MatchSettings } from "./MatchSettings";

export interface WallMask {
  readonly width: number;
  readonly height: number;
  getPixel32(x: number, y: number): number;
}

export class BitmapWallMask implements WallMask {
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly data: Uint32Array,
  ) {}

  static empty(width: number, height: number): BitmapWallMask {
    return new BitmapWallMask(width, height, new Uint32Array(width * height));
  }

  static fromRGBA(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array):
    BitmapWallMask {
    const out = new Uint32Array(width * height);
    for (let i = 0, p = 0; p < out.length; i += 4, p++) {
      out[p] = ((rgba[i + 3] << 24) | (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]) >>> 0;
    }
    return new BitmapWallMask(width, height, out);
  }

  getPixel32(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return 0;
    return this.data[iy * this.width + ix];
  }
}

export function isSolidPixel(pixel: number): boolean {
  if (!pixel) return false;
  const hex = (pixel >>> 0).toString(16);
  return hex.substring(0, 2) === "ff" && hex.substring(2).indexOf("00000") === -1;
}

export function surfaceKey(pixel: number): string {
  return (pixel >>> 0).toString(16).substring(2);
}

export const SURFACE_NAMES: Readonly<Record<string, string>> = {
  "33cc99": "Ladder", "32cb99": "Ladder",
  "ff9900": "Secret (secret2)", "ff9800": "Secret (secret2)", "ff9700": "Secret (secret2)",
  "ff6699": "Bounce (strong)",
  "ff6666": "Bounce (weak)",
  "999966": "Conveyor x2",
  "666666": "Conveyor x5",
  "0066ff": "Force Jump + factory sparks", "0069ff": "Force Jump + factory sparks",
  "0077ff": "Force Jump 1.4", "0079ff": "Force Jump 1.4",
  "0096ff": "Force Jump 2", "0099ff": "Force Jump 2",
  "3360ff": "Jump 1.15",
  "3363ff": "Low gravity 0.5", "3262ff": "Low gravity 0.5",
  "3366ff": "Jump 1.4", "3369ff": "Jump 1.4",
  "600060": "Updraft (weak)", "620060": "Updraft (weakest)",
  "6600ff": "Updraft (strong)", "6200ff": "Updraft (medium)",
  "6699ff": "Water",
  "ffffff": "Snow",
  "00ffff": "Jump 1.8",
  "330000": "Instant death", "320000": "Instant death", "2c0000": "Instant death",
  "2a0000": "Instant death", "2e0000": "Instant death", "2b0000": "Instant death",
  "2f0000": "Instant death", "2d0000": "Instant death",
  "660000": "Inert (no-op case)", "620000": "Inert (no-op case)",
  "630000": "Inert (no-op case)", "640000": "Inert (no-op case)",
  "990000": "Mech laser (human only)",
};

export const PIT_SURFACES: ReadonlySet<string> = new Set(
  Object.keys(SURFACE_NAMES).filter((k) => SURFACE_NAMES[k] === "Instant death"),
);

export interface RawNode {
  kind:
    | "spawn" | "waypoint" | "aiaction" | "physbox" | "pickup"
    | "holdpoint" | "ctfflag" | "light" | "downarrow";
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface ArenaDef {
  wall: WallMask;
  nodes: readonly RawNode[];
}

export class NodeSpawn {
  readonly id: string;
  readonly team: number;
  waypoint: NodeWaypoint | null = null;
  initialSpawned = false;

  constructor(readonly x: number, readonly y: number, readonly name: string) {
    const t = name.split("_");
    this.id = t[0];
    this.team = t[1] ? Number(t[1]) || 0 : 0;
  }
}

export class NodeWaypoint {
  readonly id: string;
  readonly con: string;
  readonly connects: NodeWaypoint[] = [];
  readonly actionBoxes: NodeAiAction[] = [];

  constructor(readonly x: number, readonly y: number, readonly name: string) {
    const t = name.split("_");
    this.id = t[0];
    this.con = t[1] ?? "";
  }

  setConnectors(ob: Readonly<Record<string, NodeWaypoint>>): void {
    for (const ch of this.con) {
      const wp = ob[ch];
      if (wp) this.connects.push(wp);
    }
  }

  setActionBox(ab: NodeAiAction): void {
    this.actionBoxes.push(ab);
  }
}

export function linkStrandedWaypoints(waypoints: readonly NodeWaypoint[]): void {
  const inbound = new Set<NodeWaypoint>();
  for (const wp of waypoints) for (const to of wp.connects) inbound.add(to);
  for (const wp of waypoints) {
    if (inbound.has(wp)) continue;
    for (const to of wp.connects) {
      if (!to.connects.includes(wp)) to.connects.push(wp);
    }
  }
}

export class NodeAiAction {
  readonly action: string;
  readonly con: string;
  readonly width: number;
  readonly height: number;

  constructor(
    readonly x: number, readonly y: number, readonly name: string,
    width = 0, height = 0,
  ) {
    const t = name.split("_");
    this.action = t[0];
    this.con = t[1] ?? "";
    this.width = width;
    this.height = height;
  }

  static readonly LABELS: Readonly<Record<string, string>> = {
    c: "Crouch", j: "Jump", fp: "Fix P", fc: "Fix C", fd: "Fix D",
  };
}

export type PickupId =
  | "ammo" | "ammobig" | "armor" | "armorbig" | "health" | "healthbig" | string;

export class NodePickup {
  id: PickupId;
  readonly spawnTime: number;
  taken = 0;
  yRot = 0;
  readonly rimColor: string;

  constructor(
    readonly x: number, readonly y: number, readonly name: string,
    readonly rotation = 0,
  ) {
    const t = name.split("_");
    this.id = t[0];
    this.spawnTime = Number(t[1]);
    switch (this.id) {
      case "ammo": case "ammobig": this.rimColor = "yellow"; break;
      case "armor": case "armorbig": this.rimColor = "white"; break;
      case "health": case "healthbig": this.rimColor = "green"; break;
      default:
        this.id = this.id.substring(1);
        this.rimColor = "none";
    }
  }

  get boxX(): number { return this.x - 40; }
  get boxY(): number { return this.y - 80; }
  static readonly BOX_W = 80;
  static readonly BOX_H = 150;

  markTaken(): void {
    this.taken = this.spawnTime * 30;
  }

  enterFrame(): void {
    if (this.taken) --this.taken;
    else this.yRot += 5;
  }
}

export interface HoldpointCaptor {
  pscore: number;
}

export class NodeHoldpoint {
  curTeam = 0;
  unitCaptured: HoldpointCaptor | null = null;
  flagPos = -65;
  readonly flagSpd = 1;
  letter = "X";

  constructor(
    readonly x: number, readonly y: number, readonly name: string,
    readonly rotation = 0,
  ) {}

  get boxX(): number { return this.x - 120; }
  get boxY(): number { return this.y - 100; }
  static readonly BOX_W = 240;
  static readonly BOX_H = 200;

  capture(unitTeam: number, unit: HoldpointCaptor): boolean {
    if (unitTeam !== this.curTeam) {
      this.flagPos += this.flagSpd;
      if (this.flagPos >= -10) {
        this.curTeam = unitTeam;
        this.unitCaptured = unit;
        this.flagPos = -15;
        return true;
      }
    } else {
      this.flagPos -= this.flagSpd;
      if (this.flagPos < -65) this.flagPos = -65;
    }
    return false;
  }
}

export interface FlagCarrier {
  readonly team: number;
  hasFlag: NodeCtfFlag | null;
  readonly gun: { resetFrame(): void; swapGuns(): void };
  readonly status: { sInvis: number };
}

export type FlagCaptureResult = "none" | "taken" | "scored";

export class NodeCtfFlag {
  readonly id: string;
  team: number;
  unitCaptured: FlagCarrier | null = null;
  present = true;

  constructor(
    readonly x: number, readonly y: number, readonly name: string,
    readonly rotation = 0,
  ) {
    const t = name.split("__");
    this.id = t[0];
    this.team = Number(t[1]);
  }

  get boxX(): number { return this.x - 40; }
  get boxY(): number { return this.y - 70; }
  static readonly BOX_W = 80;
  static readonly BOX_H = 95;

  setTeam(num: number): void {
    this.team = num;
  }

  capture(unit: FlagCarrier): FlagCaptureResult {
    if (this.team !== unit.team) {
      if (this.unitCaptured) return "none";
      this.unitCaptured = unit;
      this.present = false;
      unit.status.sInvis = 0;
      unit.hasFlag = this;
      unit.gun.resetFrame();
      unit.gun.swapGuns();
      return "taken";
    }
    if (unit.hasFlag) {
      unit.gun.resetFrame();
      unit.hasFlag.reset();
      return "scored";
    }
    return "none";
  }

  reset(): void {
    const unit = this.unitCaptured;
    if (unit) {
      unit.hasFlag = null;
      unit.gun.swapGuns();
    }
    this.unitCaptured = null;
    this.present = true;
  }
}

export class NodePhysBox {
  constructor(
    readonly x: number, readonly y: number,
    readonly width: number, readonly height: number,
    readonly rotation = 0,
  ) {}
}

export class DownArrowNode {
  visible = false;
  constructor(readonly x: number, readonly y: number) {}
}

export type DeadBody = { readonly x: number; readonly y: number } | null;

export interface CamTarget {
  readonly x: number;
  readonly y: number;
  readonly human: boolean;
  readonly dead: DeadBody;
}

export interface BgOffset {
  x: number;
  y: number;
}

export class Arena {
  x = 0;
  y = 0;

  readonly wall: WallMask;
  readonly map: MapInfo;

  readonly spawns: NodeSpawn[] = [];
  readonly spawnsT1: NodeSpawn[] = [];
  readonly spawnsT2: NodeSpawn[] = [];
  readonly waypoints: NodeWaypoint[] = [];
  readonly aiactions: NodeAiAction[] = [];
  readonly physboxes: NodePhysBox[] = [];
  readonly pickups: NodePickup[] = [];
  readonly holdpoints: NodeHoldpoint[] = [];
  readonly ctfflags: NodeCtfFlag[] = [];
  readonly lights: { visible: boolean; x: number; y: number }[] = [];
  readonly downarrows: DownArrowNode[] = [];
  wpOb: Record<string, NodeWaypoint> = {};

  flag1: NodeCtfFlag | null = null;
  flag2: NodeCtfFlag | null = null;

  readonly bg1: BgOffset = { x: 0, y: 0 };
  readonly bg2: BgOffset = { x: 0, y: 0 };
  bg1Size: BgOffset = { x: 0, y: 0 };
  bg2Size: BgOffset = { x: 0, y: 0 };

  camFocus: CamTarget | null = null;
  camIntenseX = 0.5;
  camIntenseY = 0.5;

  private shakeX = 0;
  private shakeY = 0;
  private shkOffX = 0;
  private shkOffY = 0;

  screenShake = true;
  graphLights = true;

  constructor(def: ArenaDef, mode: string = MatchSettings.useMode, map?: MapInfo) {
    this.wall = def.wall;
    this.map = map ?? MatchSettings.useMap ?? getMap("");
    this.init(def.nodes, mode);
  }

  private init(nodes: readonly RawNode[], mode: string): void {
    let ctfFlip1 = 1;
    let ctfFlip2 = 2;
    if (mode === "ctf" && Math.random() < 0.5) {
      ctfFlip1 = 2;
      ctfFlip2 = 1;
    }

    for (const raw of nodes) {
      switch (raw.kind) {
        case "light":
          this.lights.push({ visible: true, x: raw.x, y: raw.y });
          break;
        case "downarrow":
          this.downarrows.push(new DownArrowNode(raw.x, raw.y));
          break;
        case "spawn": {
          const s = new NodeSpawn(raw.x, raw.y, raw.name);
          if (s.team === 0) this.spawns.push(s);
          if (s.team === ctfFlip1) this.spawnsT1.push(s);
          if (s.team === ctfFlip2) this.spawnsT2.push(s);
          break;
        }
        case "waypoint":
          this.waypoints.push(new NodeWaypoint(raw.x, raw.y, raw.name));
          break;
        case "aiaction":
          this.aiactions.push(
            new NodeAiAction(raw.x, raw.y, raw.name, raw.width ?? 0, raw.height ?? 0),
          );
          break;
        case "physbox":
          this.physboxes.push(
            new NodePhysBox(raw.x, raw.y, raw.width ?? 0, raw.height ?? 0, raw.rotation ?? 0),
          );
          break;
        case "pickup":
          this.pickups.push(
            new NodePickup(raw.x, raw.y, raw.name, raw.rotation ?? 0),
          );
          break;
        case "holdpoint":
          if (mode === "dom") {
            this.holdpoints.push(
              new NodeHoldpoint(raw.x, raw.y, raw.name, raw.rotation ?? 0),
            );
          }
          break;
        case "ctfflag": {
          if (mode !== "ctf") break;
          const f = new NodeCtfFlag(raw.x, raw.y, raw.name, raw.rotation ?? 0);
          this.ctfflags.push(f);
          const n = f.team === 1 ? ctfFlip1 : ctfFlip2;
          if (n === 1) this.flag1 = f;
          else this.flag2 = f;
          f.setTeam(n);
          break;
        }
      }
    }

    this.holdpoints.sort((a, b) => a.x - b.x);
    for (let i = 0; i < this.holdpoints.length; i++) {
      this.holdpoints[i].letter = ["A", "B", "C", "D", "E"][i] ?? "X";
    }

    this.wpOb = {};
    for (const wp of this.waypoints) this.wpOb[wp.id] = wp;
    for (const wp of this.waypoints) wp.setConnectors(this.wpOb);
    linkStrandedWaypoints(this.waypoints);

    for (const ab of this.aiactions) {
      for (const ch of ab.con) this.wpOb[ch]?.setActionBox(ab);
    }

    for (const s of [...this.spawns, ...this.spawnsT1, ...this.spawnsT2]) {
      s.waypoint = this.wpOb[s.id] ?? null;
    }

    this.toggleLights();
  }

  toggleLights(): void {
    for (const l of this.lights) l.visible = this.graphLights;
  }

  setShake(shakeX: number, shakeY: number): void {
    if (!this.screenShake) return;
    if (shakeX > this.shakeX) this.shakeX = shakeX;
    if (shakeY > this.shakeY) this.shakeY = shakeY;
  }

  setFocus(unit: CamTarget | null, intense = 0.5): void {
    this.camFocus = unit;
    this.camIntenseX = intense;
    this.camIntenseY = intense;
  }

  enterFrame(mouseX: number, mouseY: number): void {
    const W = Config.GAME_WIDTH;
    const H = Config.GAME_HEIGHT;

    if (this.shakeX) {
      this.shkOffX = UT.rand(-this.shakeX, this.shakeX);
      this.shakeX -= 0.2;
      if (this.shakeX < 0) this.shakeX = 0;
    } else {
      this.shkOffX = 0;
    }
    if (this.shakeY) {
      this.shkOffY = UT.rand(-this.shakeY, this.shakeY);
      this.shakeY -= 0.2;
      if (this.shakeY < 0) this.shakeY = 0;
    } else {
      this.shkOffY = 0;
    }

    if (this.camFocus) {
      const f = this.camFocus;
      const focusX = !f.dead ? f.x : f.dead.x;
      const focusY = !f.dead ? f.y : f.dead.y + 50;

      let toX: number;
      let toY: number;
      if (f.human) {
        toX = W * 0.5 - focusX - (mouseX - W * 0.5) * this.camIntenseX;
        toY = H * 0.5 - focusY - (mouseY - H * 0.5) * this.camIntenseY + 20;
      } else {
        toX = W * 0.5 - focusX;
        toY = H * 0.5 - focusY + 20;
      }

      if (this.map.extra === "frigate") toY += oscillation(0.5, 25);
      if (this.map.extra === "cqc") toY += oscillation(0.5, 5);

      this.x += (toX - this.x) * 0.7;
      this.y += (toY - this.y) * 0.7;

      if (this.x > 0) this.x = 0;
      if (this.y > 5) this.y = 0;
      if (this.x < -this.wall.width + W) this.x = -this.wall.width + W;
      if (this.y < -this.wall.height + H) this.y = -this.wall.height + H;
    }

    const ratioX = this.x / (W - this.wall.width);
    const ratioY = this.y / (H - this.wall.height);
    this.bg1.x = (W - this.bg1Size.x) * ratioX;
    this.bg1.y = (H - this.bg1Size.y) * ratioY;
    this.bg2.x = (W - this.bg2Size.x) * ratioX;
    this.bg2.y = (H - this.bg2Size.y) * ratioY;

    this.x += this.shkOffX;
    this.y += this.shkOffY;
  }

  getPixel(x: number, y: number): number {
    return this.wall.getPixel32(x, y);
  }

  hitTest(x: number, y: number): number {
    const pixel = this.wall.getPixel32(x, y);
    return isSolidPixel(pixel) ? pixel : 0;
  }

  surfaceAt(x: number, y: number): string {
    return surfaceKey(this.wall.getPixel32(x, y + 1));
  }

  outOfBounds(x: number, y: number): boolean {
    return x < 0 || y < 0 || x > this.wall.width || y > this.wall.height;
  }

  spawnsFor(team: number): NodeSpawn[] {
    if (team === 1) return this.spawnsT1;
    if (team === 2) return this.spawnsT2;
    return this.spawns;
  }
}

export function oscillation(speed: number, size: number, offset = 0): number {
  return Math.cos((Date.now() + offset) * (speed * 0.001)) * size;
}

export function emptyArenaDef(width = 2400, height = 1200): ArenaDef {
  return { wall: BitmapWallMask.empty(width, height), nodes: [] };
}
