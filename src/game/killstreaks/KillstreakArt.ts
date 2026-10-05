import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, TextStyle } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../../core/Config";
import type { KillstreakLike } from "../types";
import type { HpBar } from "./Killstreak";
import type { KillstreakTurretKind } from "./Killstreak_Turret";
import rig from "../../assets/killstreakRig.json";
import { LEVEL_ALPHA, NAME_ALPHA, drawBar, nameTint } from "../plateStyle";

interface Cell {
  p?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lx: number;
  ly: number;
}

interface Part {
  cid: number;
  files: string[];
  cells: Cell[];
}

interface TrackEntry {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

interface DeviceDef {
  rootCid: number;
  headCid: number;
  body: string;
  headPart: string;
  headFirst: number;
  headFrames: number;
  headTrack: TrackEntry[];
  headPlace: TrackEntry;
  hpPlace: TrackEntry;
  namePlace: TrackEntry;
  levelPlace: TrackEntry;
  nameCid: number;
  levelCid: number;
  labels: Record<string, number>;
}

interface TextSpec {
  x?: number;
  y?: number;
  w?: number;
  size?: number;
  font?: string;
  align?: string;
}

interface Rig {
  scale: number;
  parts: Record<string, Part>;
  devices: Record<string, DeviceDef>;
  text?: Record<string, TextSpec>;
}

const RIG = rig as unknown as Rig;

const HP_FILL = 0xffffd9;

export interface DeviceView {
  readonly kind: KillstreakTurretKind;
  readonly x: number;
  readonly y: number;
  readonly frame: number;
  readonly headFrame: number;
  readonly rot: number;
  readonly healthBar: HpBar;
  readonly hpBarDist: number;
  readonly ownerName: string;
  readonly ownerLevel: number;
  readonly healthColor: number;
}

interface View {
  box: Container;
  body: Sprite;
  headBox: Container;
  headPivot: Container;
  head: Sprite;
  hp: Graphics;
  name: Text;
  level: Text;
}

export function deviceViews(list: readonly KillstreakLike[]): DeviceView[] {
  return list.filter(
    (k): k is KillstreakLike & DeviceView => "kind" in k,
  );
}

const DEG = Math.PI / 180;

const pages = new Map<string, Texture>();
const cells = new Map<string, Texture>();

export function killstreakArtUrls(): string[] {
  const out = new Set<string>();
  for (const def of Object.values(RIG.parts)) {
    for (const file of def.files) {
      out.add(`${ASSET_BASE}/killstreaks/${file}?v=${ASSET_V}`);
    }
  }
  return [...out];
}

export async function loadKillstreakArt(): Promise<void> {
  await Promise.all(Object.entries(RIG.parts).map(async ([part, def]) => {
    await Promise.all(def.files.map(async (file, page) => {
      const key = `${part}#${page}`;
      if (pages.has(key)) return;
      try {
        pages.set(key, await Assets.load<Texture>(
          `${ASSET_BASE}/killstreaks/${file}?v=${ASSET_V}`,
        ));
      } catch {
      }
    }));
  }));
}

export class KillstreakArt {
  readonly root = new Container();

  private views = new Map<DeviceView, View>();

  async load(): Promise<void> {
    await loadKillstreakArt();
  }

  enterFrame(devices: readonly DeviceView[]): void {
    for (const device of devices) {
      let view = this.views.get(device);
      if (!view) {
        view = makeView();
        this.views.set(device, view);
        this.root.addChild(view.box);
      }
      updateView(view, device);
    }
    if (this.views.size !== devices.length) {
      for (const [device, view] of this.views) {
        if (!devices.includes(device)) {
          this.root.removeChild(view.box);
          view.box.destroy({ children: true });
          this.views.delete(device);
        }
      }
    }
  }
}

function makeView(): View {
  const view: View = {
    box: new Container(),
    body: new Sprite(Texture.EMPTY),
    headBox: new Container(),
    headPivot: new Container(),
    head: new Sprite(Texture.EMPTY),
    hp: new Graphics(),
    name: labelText(),
    level: labelText(),
  };
  view.box.addChild(view.body, view.headBox, view.hp, view.name, view.level);
  view.headBox.addChild(view.headPivot);
  view.headPivot.addChild(view.head);
  return view;
}

function labelText(): Text {
  return new Text({
    roundPixels: true,
    text: "",
    style: new TextStyle({
      fontFamily: ["QTypeSquare-Bold", "Verdana", "sans-serif"],
      fontSize: 8,
      fill: 0xffffff,
    }),
  });
}

function updateView(view: View, device: DeviceView): void {
  const def = RIG.devices[device.kind];
  view.box.position.set(device.x, device.y);

  const bodyCell = RIG.parts[def.body]?.cells[device.frame - 1];
  if (bodyCell && bodyCell.w) {
    view.body.texture = cell(def.body, device.frame - 1);
    view.body.position.set(bodyCell.lx, bodyCell.ly);
    view.body.visible = true;
  } else {
    view.body.visible = false;
  }

  const hasHead = device.frame >= def.headFirst;
  view.headBox.visible = hasHead;
  if (hasHead) {
    const track = def.headTrack[device.frame - def.headFirst] ?? def.headPlace;
    view.headBox.position.set(track.tx, track.ty);
    view.headBox.rotation = Math.atan2(track.b, track.a);
    view.headBox.scale.set(
      Math.hypot(track.a, track.b), Math.hypot(track.c, track.d),
    );
    view.headPivot.rotation = device.rot * DEG;
    const headCell = RIG.parts[def.headPart]?.cells[device.headFrame - 1];
    if (headCell && headCell.w) {
      view.head.texture = cell(def.headPart, device.headFrame - 1);
      view.head.position.set(headCell.lx, headCell.ly);
      view.head.visible = true;
    } else {
      view.head.visible = false;
    }
  }

  const hp = device.healthBar;
  view.hp.position.set(def.hpPlace.tx, def.hpPlace.ty);
  view.hp.clear();
  if (hp.cur > 0) {
    drawBar(view.hp, hp.min, 0, {
      width: hp.max, hp: hp.cur, hurt: 0, step: device.hpBarDist, armor: 0,
      color: HP_FILL, alpha: 1,
    });
  }

  const nameCfg = RIG.text?.[String(def.nameCid)];
  view.name.text = device.ownerName;
  view.name.tint = nameTint(device.healthColor);
  view.name.alpha = NAME_ALPHA;
  view.name.position.set(
    def.namePlace.tx + (nameCfg?.x ?? 0), def.namePlace.ty + (nameCfg?.y ?? 0),
  );
  const levelCfg = RIG.text?.[String(def.levelCid)];
  view.level.text = String(device.ownerLevel);
  view.level.tint = device.healthColor;
  view.level.alpha = LEVEL_ALPHA;
  view.level.position.set(
    def.levelPlace.tx + (levelCfg?.x ?? 0), def.levelPlace.ty + (levelCfg?.y ?? 0),
  );
}

function cell(part: string, index: number): Texture {
  const def = RIG.parts[part];
  const c = def?.cells[index];
  if (!def || !c || !c.w || !c.h) return Texture.EMPTY;
  const key = `${part}#${index}`;
  const hit = cells.get(key);
  if (hit) return hit;
  const sheet = pages.get(`${part}#${c.p ?? 0}`);
  if (!sheet) return Texture.EMPTY;
  const tex = new Texture({
    source: sheet.source,
    frame: new Rectangle(c.x, c.y, c.w, c.h),
  });
  cells.set(key, tex);
  return tex;
}
