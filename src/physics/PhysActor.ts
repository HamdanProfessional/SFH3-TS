import { Box, Circle, RevoluteJoint, Vec2 } from "planck";
import type { Body } from "planck";
import { Container } from "pixi.js";
import { PTM } from "../core/Config";
import { UT } from "../core/UT";
import { MatchSettings } from "../game/MatchSettings";
import { combatHooks } from "../game/combatHooks";
import type { GunLike } from "../game/types";
import type { Unit } from "../game/Unit";
import { PhysBody } from "./PhysBody";
import { PhysFoot } from "./PhysFoot";
import { PhysHand } from "./PhysHand";
import { PhysHead } from "./PhysHead";
import { PhysLowerArm } from "./PhysLowerArm";
import { PhysLowerLeg } from "./PhysLowerLeg";
import type { PhysPart } from "./PhysPart";
import { PhysUpperArm } from "./PhysUpperArm";
import { PhysUpperLeg } from "./PhysUpperLeg";
import { holsterView, type Costume, type HolsterView, type PartKind } from "./RagdollArt";
import type { PhysWorld } from "./PhysWorld";

type PartCtor = new (costume: Costume, flip: number, scale: number) => PhysPart;

export const CORPSE_LIFE = 5 * 30;

const secret1Hook = (): void => combatHooks.secret1();
export function setSecret1AchievementHook(fn: () => void): void {
  combatHooks.secret1 = fn;
}

export class PhysActor {
  unit: Unit;
  weapon: GunLike;
  x: number;
  y: number;
  readonly flip: number;

  readonly parts: Body[] = [];

  readonly view = new Container();

  rdBody!: Body;
  rdHead!: Body;
  rdLeg1!: Body;

  fc = 0;

  private holster: HolsterView | null = null;

  private readonly physWorld: PhysWorld;
  private readonly costume: Costume;
  private readonly scale: number;
  private physMod: string;
  private destroyed = false;

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  constructor(physWorld: PhysWorld, unit: Unit, weapon: GunLike) {
    this.physWorld = physWorld;
    this.unit = unit;
    this.weapon = weapon;
    this.x = unit.x;
    this.y = unit.y - 40;
    this.scale = unit.scale;
    this.physMod = physWorld.phys;
    this.flip = unit.scaleX > 0 ? 1 : -1;

    const info = unit.unitInfo;
    this.costume = {
      head: info.head + info.color - 1,
      body: info.body + info.color - 1,
      hair: info.hair,
      face: info.face,
      skin: info.skin,
    };

    const body = this.createPart(0, 0, 0.1, 24, 36, PhysBody, true);
    const head = this.createPart(5, -16, 0.05, 24, 24, PhysHead, false);
    this.createJoint(body, head, 2, -5, -0.1, 0.03);

    const legUp1 = this.createPart(-14, 22, 0, 13, 26, PhysUpperLeg, true);
    this.createJoint(body, legUp1, -14, 16, -0.5, 0.2);
    const legLow1 = this.createPart(-14, 39, 0, 11, 22, PhysLowerLeg, true);
    this.createJoint(legUp1, legLow1, -14, 39 - 10, 0, 0.5);
    const foot1 = this.createPart(-10, 47, 0, 17, 7, PhysFoot, true);
    this.createJoint(legLow1, foot1, -10 - 4, 47, -0.1, 0.2);

    const legUp2 = this.createPart(-5, 22, 0, 13, 26, PhysUpperLeg, true);
    this.createJoint(body, legUp2, -5, 16, -0.5, 0.2);
    const legLow2 = this.createPart(-5, 39, 0, 11, 22, PhysLowerLeg, true);
    this.createJoint(legUp2, legLow2, -5, 39 - 10, 0, 0.5);
    const foot2 = this.createPart(-1, 47, 0, 17, 7, PhysFoot, true);
    this.createJoint(legLow2, foot2, -1 - 4, 47, -0.1, 0.2);

    const armUp1 = this.createPart(-1, -3, -0.2, 10, 17, PhysUpperArm, true);
    this.createJoint(body, armUp1, -1, -4, 0, 0);
    const armLow1 = this.createPart(9, 4, -0.5, 9, 17, PhysLowerArm, true);
    this.createJoint(armUp1, armLow1, 7, 4, -0.4, 0.3);
    const hand1 = this.createPart(20, 4, 0, 10, 10, PhysHand, false);
    this.createJoint(armLow1, hand1, 17, 4, -0.2, 0.2);

    const armUp2 = this.createPart(-1, -3, -0.2, 10, 17, PhysUpperArm, true);
    this.createJoint(body, armUp2, -1, -4, 0, 0);
    const armLow2 = this.createPart(9, 4, -0.5, 8, 17, PhysLowerArm, true);
    this.createJoint(armUp2, armLow2, 7, 4, -0.4, 0.3);
    const hand2 = this.createPart(20, 4, 0, 10, 10, PhysHand, false);
    this.createJoint(armLow2, hand2, 17, 4, -0.2, 0.2);

    this.parts.push(
      armUp2, armLow2, hand2,
      legLow2, legUp2, foot2,
      body,
      head,
      legLow1, legUp1, foot1,
      armUp1, armLow1, hand1,
    );

    this.rdBody = body;
    this.rdHead = head;
    this.rdLeg1 = legUp1;

    physWorld.view.addChild(this.view);
    for (const part of this.parts) {
      this.view.addChild(part.getUserData() as PhysPart);
    }

    this.mountHolster();

    if (this.physMod === "canyon") this.forceAll(-2, 0);
    if (this.physMod === "frigate") this.forceAll(-1, -1);
  }

  enterFrame(): void {
    ++this.fc;
    this.holster?.tick();
    const view = this.rdBody.getUserData() as Container;
    this.x = view.x;
    this.y = view.y;
    if (this.physMod === "frigate" && this.y > 1030) {
      this.physMod = "";
      this.forceAll(-8, 4);
      this.impulseAll(new Vec2(-5, 1));
    }
    if (
      MatchSettings.useMap.map === "gorge" && this.unit.human
      && UT.inBox(this.x, this.y, 300, -1000, 130, 1060)
    ) {
      secret1Hook();
    }
    if (this.fc === CORPSE_LIFE) {
      this.physWorld.removeActor(this);
      this.destroy();
    }
  }

  private mountHolster(): void {
    const other = this.unit.gun.otherGun;
    if (!other) return;
    let kind: PartKind;
    let body: Body;
    if (other.unequip === "body") {
      kind = "body";
      body = this.rdBody;
    } else if (other.unequip === "legup1") {
      kind = "upperLeg";
      body = this.rdLeg1;
    } else {
      return;
    }
    const h = holsterView(kind, this.costume.body, String(other.sprite));
    if (!h) return;
    (body.getUserData() as PhysPart).addChild(h.root);
    this.holster = h;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const part of this.parts) {
      part.setUserData(null);
      this.physWorld.world.destroyBody(part);
    }
    this.physWorld.view.removeChild(this.view);
    this.view.destroy({ children: true });
  }

  impulseBody(force: Vec2): void {
    this.rdBody.applyLinearImpulse(force, this.rdBody.getWorldCenter(), true);
  }

  impulseHead(force: Vec2): void {
    this.rdHead.applyLinearImpulse(force, this.rdBody.getWorldCenter(), true);
  }

  impulseAll(force?: Vec2 | null, min = -1, max = 1): void {
    for (const part of this.parts) {
      const f = force ?? new Vec2(UT.rand(min, max), UT.rand(min, max));
      part.applyLinearImpulse(f, part.getWorldCenter(), true);
    }
  }

  forceAll(fx: number, fy: number): void {
    for (const part of this.parts) {
      part.applyForce(new Vec2(fx, fy), part.getWorldCenter(), true);
    }
  }

  createVec(x: number, y: number): Vec2 {
    return new Vec2((this.x + x * this.flip) / PTM, (this.y + y) / PTM);
  }

  createJoint(
    baseBod: Body, attachBod: Body, ax: number, ay: number,
    lowAng: number, highAng: number,
  ): void {
    if (this.physWorld.mod === "bodypop") return;
    if ((Math.random() < this.weapon.bodBreak || this.unit.status.sFrozen)
        && this.physWorld.blood === 2) {
      return;
    }
    if (this.flip === -1) {
      const holdAng = lowAng;
      lowAng = highAng * this.flip;
      highAng = holdAng * this.flip;
    }
    const anchor = this.createVec(ax, ay);
    this.physWorld.world.createJoint(new RevoluteJoint(
      {
        lowerAngle: lowAng * Math.PI,
        upperAngle: highAng * Math.PI,
        enableLimit: Boolean(lowAng) || Boolean(highAng),
        maxMotorTorque: 0.02,
        motorSpeed: 0,
        enableMotor: true,
      },
      baseBod,
      attachBod,
      anchor,
    ));
  }

  private createPart(
    xPos: number, yPos: number, rot: number, width: number, height: number,
    part: PartCtor, isBox: boolean,
  ): Body {
    xPos *= this.scale;
    yPos *= this.scale;
    xPos *= this.flip;
    rot *= this.flip;
    xPos += this.x;
    yPos += this.y;

    const view = new part(this.costume, this.flip, this.scale);
    const body = this.physWorld.world.createDynamicBody({
      position: new Vec2(xPos / PTM, yPos / PTM),
      angle: rot * Math.PI,
    });
    view.x = xPos;
    view.y = yPos;
    view.rotation = rot * Math.PI;
    body.createFixture({
      shape: isBox ? new Box(width / 60, height / 60) : new Circle(width / 60),
      density: part === PhysBody ? 1.5 : 1,
      friction: 0.5,
      restitution: 0.2,
      filterGroupIndex: -1,
    });
    body.setUserData(view);
    return body;
  }
}
