import { Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import { yMoveToRot } from "./Geom";
import type { Arena, NodeCtfFlag, NodeHoldpoint, NodePickup } from "./Arena";
import type { Fx } from "./fx/Fx";
import rig from "../assets/nodeRig.json";

interface NodeCell {
  p?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lx: number;
  ly: number;
}

interface NodePart {
  cid: number;
  files: string[];
  cells: NodeCell[];
  labels?: Record<string, number>;
}

interface Placement {
  part: string;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

interface NodeRig {
  parts: Record<string, NodePart>;
  placements: Record<string, Record<string, Placement>>;
}

const RIG = rig as unknown as NodeRig;
const DEG = Math.PI / 180;

const pages = new Map<string, Texture>();
const cuts = new Map<string, Texture>();
const loading = new Set<string>();

export function nodeArtUrls(): string[] {
  const out = new Set<string>();
  for (const def of Object.values(RIG.parts)) {
    for (const file of def.files) out.add(`${ASSET_BASE}/nodes/${file}?v=${ASSET_V}`);
  }
  return [...out];
}

export async function loadNodeArt(): Promise<void> {
  await Promise.all(Object.entries(RIG.parts).map(async ([part, def]) => {
    await Promise.all(def.files.map(async (file, page) => {
      const key = `${part}#${page}`;
      if (pages.has(key) || loading.has(key)) return;
      loading.add(key);
      try {
        pages.set(key, await Assets.load<Texture>(
          `${ASSET_BASE}/nodes/${file}?v=${ASSET_V}`,
        ));
      } catch {
      } finally {
        loading.delete(key);
      }
    }));
  }));
}

export class NodeArt {
  readonly root = new Container();

  private pickups: PickupView[] = [];
  private holdpoints: HoldView[] = [];
  private flags: FlagView[] = [];
  private arrows: Sprite[] = [];

  async load(): Promise<void> {
    await loadNodeArt();
  }

  build(arena: Arena): void {
    this.root.removeChildren();
    this.pickups = arena.pickups.map((node) => {
      const view: PickupView = {
        node,
        box: new Container(),
        base: new Sprite(Texture.EMPTY),
        rim: new Sprite(Texture.EMPTY),
        rimFrame: 0,
        pos: placement("pickup", "rim"),
      };
      view.box.addChild(view.base, view.rim);
      this.root.addChild(view.box);
      return view;
    });
    this.holdpoints = arena.holdpoints.map((node) => {
      const view: HoldView = {
        node,
        box: new Container(),
        base: new Sprite(Texture.EMPTY),
        flag: new Sprite(Texture.EMPTY),
        rim: new Sprite(Texture.EMPTY),
        rimFrame: 0,
        flagPos: placement("holdpoint", "flag"),
        rimPos: placement("holdpoint", "rim"),
      };
      view.box.addChild(view.base, view.rim, view.flag);
      this.root.addChild(view.box);
      return view;
    });
    this.flags = arena.ctfflags.map((node) => {
      const view: FlagView = {
        node,
        box: new Container(),
        base: new Sprite(Texture.EMPTY),
        flag: new Sprite(Texture.EMPTY),
        rim: new Sprite(Texture.EMPTY),
        rimFrame: 0,
        flagPos: placement("ctf", "flag"),
        rimPos: placement("ctf", "rim"),
      };
      view.box.addChild(view.base, view.rim, view.flag);
      this.root.addChild(view.box);
      return view;
    });
    this.arrows = arena.downarrows.map((node) => {
      const s = new Sprite(Texture.EMPTY);
      s.position.set(node.x, node.y);
      s.visible = false;
      this.root.addChild(s);
      return s;
    });
  }

  enterFrame(arena: Arena, fx: Fx): void {
    for (const v of this.pickups) {
      const node = v.node;
      v.box.position.set(node.x, node.y);
      v.box.rotation = (node.rotation ?? 0) * DEG;
      placeBase(v.base, "pickupBase", label("pickupBase", node.rimColor));
      v.rim.visible = true;
      placeChild(v.rim, v.pos, rimFrame(v));
      if (!node.taken) {
        v.box.alpha = 1;
      } else {
        v.box.alpha = 0.5;
      }
      if (!node.taken) {
        const bob = 30 + yMoveToRot(node.yRot, 4);
        fx.bitScreen.paint(
          node.x + arena.x + (node.rotation ?? 0) * 0.5,
          node.y + arena.y - bob,
          true, "pickups0", node.id, 1,
        );
      }
    }

    for (const v of this.holdpoints) {
      const node = v.node;
      v.box.position.set(node.x, node.y);
      v.box.rotation = (node.rotation ?? 0) * DEG;
      placeBase(v.base, "holdpointBase", Math.min(node.curTeam, 3));
      placeChild(
        v.flag, v.flagPos,
        Math.min(node.curTeam, RIG.parts.holdpointFlag.cells.length - 1),
        node.flagPos,
      );
      placeChild(v.rim, v.rimPos, rimFrame(v));
    }

    for (const v of this.flags) {
      const node = v.node;
      v.box.position.set(node.x, node.y);
      v.box.rotation = (node.rotation ?? 0) * DEG;
      placeBase(v.base, "ctfBase", node.team - 1);
      const carried = node.unitCaptured !== null;
      v.flag.visible = !carried;
      if (!carried) {
        placeChild(v.flag, v.flagPos, label("ctfFlag", `flag${node.team}`));
      }
      v.box.alpha = carried ? 0.7 : 1;
      placeChild(v.rim, v.rimPos, rimFrame(v, !carried));
    }
  }
}

function rimFrame(v: { rimFrame: number }, play = true): number {
  const n = RIG.parts.rim.cells.length;
  const frame = v.rimFrame % n;
  if (play) v.rimFrame = (frame + 1) % n;
  return frame;
}

interface PickupView {
  node: NodePickup;
  box: Container;
  base: Sprite;
  rim: Sprite;
  rimFrame: number;
  pos: Placement;
}

interface HoldView {
  node: NodeHoldpoint;
  box: Container;
  base: Sprite;
  flag: Sprite;
  rim: Sprite;
  rimFrame: number;
  flagPos: Placement;
  rimPos: Placement;
}

interface FlagView {
  node: NodeCtfFlag;
  box: Container;
  base: Sprite;
  flag: Sprite;
  rim: Sprite;
  rimFrame: number;
  flagPos: Placement;
  rimPos: Placement;
}

function placement(node: string, child: string): Placement {
  const p = RIG.placements[node]?.[child];
  if (!p) throw new Error(`nodeRig: no ${child} placement for ${node}`);
  return p;
}

function label(part: string, name: string): number {
  return RIG.parts[part].labels?.[name] ?? 0;
}

function placeBase(sprite: Sprite, part: string, frame: number): void {
  const c = RIG.parts[part].cells[frame];
  if (!c) return;
  sprite.texture = cell(part, frame);
  sprite.position.set(c.lx, c.ly);
  sprite.visible = c.w > 0 && c.h > 0;
}

function placeChild(
  sprite: Sprite, place: Placement, frame: number, overrideY?: number,
): void {
  const c = RIG.parts[place.part].cells[frame];
  if (!c) return;
  sprite.texture = cell(place.part, frame);
  sprite.position.set(
    place.tx + c.lx * place.sx,
    (overrideY ?? place.ty) + c.ly * place.sy,
  );
  sprite.scale.set(place.sx, place.sy);
  sprite.visible = c.w > 0 && c.h > 0;
}

function cell(part: string, index: number): Texture {
  const def = RIG.parts[part];
  const c = def?.cells[index];
  if (!def || !c || !c.w || !c.h) return Texture.EMPTY;
  const key = `${part}#${index}`;
  const hit = cuts.get(key);
  if (hit) return hit;
  const sheet = pages.get(`${part}#${c.p ?? 0}`);
  if (!sheet) return Texture.EMPTY;
  const tex = new Texture({
    source: sheet.source,
    frame: new Rectangle(c.x, c.y, c.w, c.h),
  });
  cuts.set(key, tex);
  return tex;
}
