#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { Unit } from "../../src/game/Unit";
import { UnitInfo } from "../../src/game/UnitInfo";
import { createHeadlessGame } from "../../src/game/types";
import type { GunLike } from "../../src/game/types";
import { createPhysWorld } from "../../src/physics/PhysWorld";

const PART_KINDS = [
  "upperArm", "lowerArm", "hand", "lowerLeg", "upperLeg", "foot",
  "body", "head", "lowerLeg", "upperLeg", "foot", "upperArm", "lowerArm", "hand",
];

const gun: GunLike = {
  id: "test", type: 0, dmg: 0, range: 0, yOff: 0, effShoot: "", force: 0,
  bodBreak: 0, splash: 0, splashMult: 0, crit: 0, critDmg: 0, headDmg: 0,
  noHead: false, noCrit: false, noBlood: true, selfDmg: 1, isExplosive: false,
  isMelee: false, isTurret: false, fire: 0, ice: 0, acid: 0, zap: 0, crap: 0,
  reflectFrames: 0, effHit: "", hitSound: null, cls: null, params: null, extra: {},
};

const info = new UnitInfo();
info.cls = "med";
info.health = 100;
info.head = 1;
info.body = 1;
info.color = 3;
info.skin = 3;
info.face = 3;
info.hair = 3;

const game = createHeadlessGame();
const unit = new Unit(game, info);
unit.x = 160;
unit.y = 380;
unit.status.reset();
game.units.push(unit);

const world = createPhysWorld({
  blood: 2,
  walls: [{ x: 160, y: 540, width: 800, height: 40 }],
});

const orig = Math.random;
Math.random = () => 0.5;
const actor = world.createCorpse(unit, null, gun, {});
Math.random = orig;

const frames: number[][][] = [];
const N = 40;
for (let i = 0; i < N; i++) {
  world.step();
  frames.push(actor.parts.map((b) => {
    const p = b.getPosition();
    return [p.x * 30, p.y * 30, b.getAngle()];
  }));
}

writeFileSync("shots/_ws2_settle.json", JSON.stringify({
  origin: [unit.x, unit.y - 40],
  costume: { head: 3, body: 3, skin: 3, face: 3, hair: 3 },
  parts: PART_KINDS,
  frames,
}));
console.log(`wrote shots/_ws2_settle.json (${N} frames)`);
