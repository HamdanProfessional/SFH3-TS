import { BULLET_CLASSES, Bullet } from "./Bullet";
import type { BulletCtor, BulletExtra } from "./Bullet";
import {
  Bullet_Line_Basic,
  Bullet_Line_Bend,
  Bullet_Line_Electric,
  Bullet_Line_Laser,
  Bullet_Line_Sniper,
  Bullet_Line_Zapper,
} from "./lines";
import {
  Bullet_Proj_Basic,
  Bullet_Proj_Bounce,
  Bullet_Proj_Follow,
  Bullet_Proj_Frames,
  Bullet_Proj_Stick,
} from "./projectiles";
import { Bullet_Melee_Basic, Bullet_Splash } from "./misc";
import type { GameLike, GunLike } from "../types";
import type { Unit } from "../Unit";

const REGISTRY: Readonly<Record<string, BulletCtor>> = {
  Bullet_Line_Basic,
  Bullet_Line_Bend,
  Bullet_Line_Electric,
  Bullet_Line_Laser,
  Bullet_Line_Sniper,
  Bullet_Line_Zapper,
  Bullet_Melee_Basic,
  Bullet_Proj_Basic,
  Bullet_Proj_Bounce,
  Bullet_Proj_Follow,
  Bullet_Proj_Frames,
  Bullet_Proj_Stick,
  Bullet_Splash,
};

for (const [name, ctor] of Object.entries(REGISTRY)) BULLET_CLASSES[name] = ctor;

export { BULLET_CLASSES, Bullet, REGISTRY as BULLET_REGISTRY };
export type { BulletCtor, BulletExtra };
export {
  Bullet_Line_Basic, Bullet_Line_Bend, Bullet_Line_Electric,
  Bullet_Line_Laser, Bullet_Line_Sniper, Bullet_Line_Zapper,
};
export {
  Bullet_Proj_Basic, Bullet_Proj_Bounce, Bullet_Proj_Follow,
  Bullet_Proj_Frames, Bullet_Proj_Stick,
};
export { Bullet_Melee_Basic, Bullet_Splash };

export function makeBullet(
  game: GameLike,
  unit: Unit,
  rotation: number,
  x: number,
  y: number,
  dist: number,
  gun: GunLike,
  extra: BulletExtra | null = null,
): Bullet | null {
  if (!gun.cls) return null;
  const Ctor = REGISTRY[gun.cls];
  if (!Ctor) return null;
  return new Ctor(game, unit, rotation, x, y, dist, gun, extra);
}
