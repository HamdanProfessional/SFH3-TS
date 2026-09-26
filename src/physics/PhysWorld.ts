import { Box, Vec2, World } from "planck";
import type { Body } from "planck";
import { Container } from "pixi.js";
import { PTM } from "../core/Config";
import { getRotation, xMoveToRot, yMoveToRot } from "../game/Geom";
import type { CorpseLike, GunLike, HitExtra, PhysWorldLike } from "../game/types";
import type { Unit } from "../game/Unit";
import { PhysActor } from "./PhysActor";

export interface PhysWall {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface PhysWorldOptions {
  walls?: readonly PhysWall[];
  phys?: string;
  mod?: string;
  blood?: number;
}

type CorpseExtra = HitExtra & { hitX?: number; hitY?: number };

interface LimbPose {
  px: number;
  py: number;
  pr: number;
  cx: number;
  cy: number;
  cr: number;
}

const TIME_STEP = 1 / 30;
const VELOCITY_ITERS = 10;
const POSITION_ITERS = 10;

export class PhysWorld implements PhysWorldLike {
  readonly world: World;
  readonly view = new Container();
  readonly actors: PhysActor[] = [];

  readonly phys: string;
  readonly mod: string;
  readonly blood: number;

  private ground: Body | null = null;

  private readonly pose = new WeakMap<Container, LimbPose>();

  constructor(opts: PhysWorldOptions = {}) {
    this.phys = opts.phys ?? "";
    this.mod = opts.mod ?? "";
    this.blood = opts.blood ?? 2;
    this.world = new World(new Vec2(0, 10));
    if (this.phys === "space") this.world.setGravity(new Vec2(0, 0));
    if (opts.walls?.length) this.generateWorld(opts.walls);
  }

  private generateWorld(walls: readonly PhysWall[]): void {
    this.ground = this.world.createBody();
    for (const b of walls) {
      const center = new Vec2(b.x / PTM, b.y / PTM);
      const angle = ((b.rotation ?? 0) * Math.PI) / 180;
      this.ground.createFixture({
        shape: new Box(b.width / 60, b.height / 60, center, angle),
        friction: 0.3,
        density: 0,
      });
    }
  }

  createCorpse(
    unit: Unit, shooter: Unit | null, weapon: GunLike, extra: HitExtra,
  ): PhysActor {
    const actor = new PhysActor(this, unit, weapon);
    this.actors.push(actor);
    actor.impulseAll();
    actor.impulseBody(new Vec2(unit.mov.xVel, unit.mov.yVel));

    let force = weapon.force;
    if (this.mod === "sky9") {
      force += 40;
      if (force > 80) force = 80;
    }
    if (force) {
      const hit = extra as CorpseExtra;
      let shotRot: number;
      if (weapon.splash) {
        if (hit.hitX === unit.x && hit.hitY === unit.y) hit.hitY = (hit.hitY ?? 0) + 1;
        shotRot = getRotation(hit.hitX ?? 0, hit.hitY ?? 0, unit.x, unit.y - 40);
      } else {
        const kx = shooter ? shooter.x : unit.x;
        const ky = shooter ? shooter.y : unit.y;
        if (kx === unit.x && ky === unit.y) unit.y -= 5;
        shotRot = getRotation(kx, ky, unit.x, unit.y);
      }
      if (Number.isNaN(shotRot)) shotRot = 0;
      actor.impulseBody(
        new Vec2(xMoveToRot(shotRot, force), yMoveToRot(shotRot, force)),
      );
    }

    if (extra.headMult) {
      const kx = shooter ? shooter.x : unit.x;
      const ky = shooter ? shooter.y : unit.y;
      if (kx === unit.x && ky === unit.y - 10) unit.y -= 1;
      let rot = getRotation(kx, ky, unit.x, unit.y - 10);
      if (Number.isNaN(rot)) rot = 0;
      actor.impulseHead(new Vec2(xMoveToRot(rot, 8), yMoveToRot(rot, 8)));
    }
    return actor;
  }

  hitCorpse(
    corpse: CorpseLike, shooter: Unit, weapon: GunLike, extra: HitExtra,
  ): void {
    const actor = corpse as PhysActor;
    if (actor.isDestroyed) return;
    actor.impulseAll(null, -0.5, 0.5);
    let force = weapon.force;
    if (this.mod === "sky9") force *= 1.5;
    if (!force) return;

    const hit = extra as CorpseExtra;
    const body = actor.rdBody.getUserData() as Container | null;
    if (!body) return;
    let shotRot: number;
    if (weapon.splash) {
      if (hit.hitX === body.x && hit.hitY === body.y) hit.hitY = (hit.hitY ?? 0) + 1;
      shotRot = getRotation(hit.hitX ?? 0, hit.hitY ?? 0, body.x, body.y - 40);
    } else {
      if (shooter.x === body.x && shooter.y === body.y) body.y -= 1;
      shotRot = getRotation(shooter.x, shooter.y, body.x, body.y);
    }
    if (Number.isNaN(shotRot)) shotRot = 0;
    actor.impulseBody(new Vec2(xMoveToRot(shotRot, force), yMoveToRot(shotRot, force)));
  }

  step(): void {
    this.world.step(TIME_STEP, VELOCITY_ITERS, POSITION_ITERS);
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const view = b.getUserData() as Container | null;
      if (view) {
        const p = b.getPosition();
        const x = p.x * PTM;
        const y = p.y * PTM;
        const r = b.getAngle();
        let q = this.pose.get(view);
        if (!q) {
          q = { px: x, py: y, pr: r, cx: x, cy: y, cr: r };
          this.pose.set(view, q);
        } else {
          q.px = q.cx; q.py = q.cy; q.pr = q.cr;
          q.cx = x; q.cy = y; q.cr = r;
        }
        view.x = x;
        view.y = y;
        view.rotation = r;
      }
    }
    for (let i = 0; i < this.actors.length; i++) this.actors[i].enterFrame();
  }

  renderFrame(alpha: number): void {
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const view = b.getUserData() as Container | null;
      if (!view) continue;
      const q = this.pose.get(view);
      if (!q) continue;
      view.x = q.px + (q.cx - q.px) * t;
      view.y = q.py + (q.cy - q.py) * t;
      view.rotation = q.pr + (q.cr - q.pr) * t;
    }
  }

  freezeLerp(): void {
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const view = b.getUserData() as Container | null;
      const q = view && this.pose.get(view);
      if (!q) continue;
      q.px = q.cx; q.py = q.cy; q.pr = q.cr;
    }
  }

  removeActor(actor: PhysActor): void {
    const i = this.actors.indexOf(actor);
    if (i >= 0) this.actors.splice(i, 1);
  }

  destroy(): void {
    for (const actor of [...this.actors]) actor.destroy();
    this.actors.length = 0;
    if (this.ground) {
      this.world.destroyBody(this.ground);
      this.ground = null;
    }
    this.view.destroy({ children: true });
  }
}

export function createPhysWorld(opts: PhysWorldOptions = {}): PhysWorld {
  return new PhysWorld(opts);
}
