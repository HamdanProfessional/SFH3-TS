import { Movement } from "../game/Movement";
import type { Unit } from "../game/Unit";
import { EDGE, YF, type YouState } from "./protocol";

export interface PendingInput {
  seq: number;
  keys: number;
  edges: number;
}

const SNAP = 120;
const DECAY = 0.6;
const DEAD = 0.1;
const MAX_PENDING = 45;

interface WallLike {
  getPixel32(x: number, y: number): number;
}

interface MovementActor {
  keys: number;
  x: number;
  y: number;
  flip: boolean;
  human: boolean;
  canRotate: boolean;
  constAnim: string;
  nextAnim: string;
  aimX: number;
  aimY: number;
  readonly UP: number;
  readonly DOWN: number;
  readonly LEFT: number;
  readonly RIGHT: number;
  readonly status: { sSpawn: boolean };
  readonly unitInfo: { extra: Record<string, unknown>; runType: number };
  readonly MC: { rotation: number; goto(anim: string): void };
  readonly game: {
    readonly gameStarted: boolean;
    readonly arena: { readonly wall: WallLike; setShake(a: number, b: number): void };
    createParticle(...args: unknown[]): void;
  };
}

class Ghost implements MovementActor {
  keys = 0;
  x = 0;
  y = 0;
  flip = false;
  readonly human = false;
  canRotate = false;
  constAnim = "";
  nextAnim = "idle";
  aimX = 0;
  aimY = 0;
  readonly UP = 1;
  readonly DOWN = 2;
  readonly LEFT = 4;
  readonly RIGHT = 8;
  readonly status = { sSpawn: false };
  readonly unitInfo: { extra: Record<string, unknown>; runType: number };
  readonly MC = { rotation: 0, goto(_anim: string): void {} };
  readonly game: MovementActor["game"];

  constructor(real: Unit) {
    this.canRotate = real.canRotate;
    this.unitInfo = { extra: { ...real.unitInfo.extra }, runType: real.unitInfo.runType };
    const game = real.game;
    this.game = {
      get gameStarted(): boolean { return game.gameStarted; },
      get arena() { return game.arena as MovementActor["game"]["arena"]; },
      createParticle: () => {},
    };
  }
}

export class Predictor {
  get x(): number { return this.ghost.x; }
  get y(): number { return this.ghost.y; }
  get rotation(): number { return this.ghost.MC.rotation; }
  get jumping(): boolean { return this.mov.jumping; }

  errX = 0;
  errY = 0;
  aimX = 0;
  aimY = 0;

  live = false;

  private readonly ghost: Ghost;
  private readonly mov: Movement;
  private readonly pending: PendingInput[] = [];
  private baseT = -1;
  private seq = 0;

  constructor(real: Unit) {
    this.ghost = new Ghost(real);
    this.mov = new Movement(this.ghost as unknown as Unit);
    this.follow(real);
  }

  stamp(): number {
    return ++this.seq;
  }

  follow(u: Unit): void {
    this.ghost.x = u.x;
    this.ghost.y = u.y;
    this.aimX = u.aimX;
    this.aimY = u.aimY;
    this.errX = 0;
    this.errY = 0;
  }

  advance(base: YouState | null, sent: PendingInput,
    aimTargetX: number, aimTargetY: number): void {
    if (base && base.t !== this.baseT) this.rebase(base);
    if (!this.live) return;

    this.pending.push(sent);
    while (this.pending.length > MAX_PENDING) this.pending.shift();
    this.run(sent);

    this.errX = Math.abs(this.errX) < DEAD ? 0 : this.errX * DECAY;
    this.errY = Math.abs(this.errY) < DEAD ? 0 : this.errY * DECAY;

    this.aimX += (aimTargetX - this.aimX) * 0.5;
    this.aimY += (aimTargetY - this.aimY) * 0.5;
  }

  private rebase(base: YouState): void {
    this.baseT = base.t;

    if (base.fl & YF.NO_SIM) {
      this.live = false;
      this.pending.length = 0;
      this.errX = 0;
      this.errY = 0;
      return;
    }

    const wasX = this.ghost.x + this.errX;
    const wasY = this.ghost.y + this.errY;
    const had = this.live;

    this.load(base);
    while (this.pending.length && this.pending[0].seq <= base.q) this.pending.shift();
    for (const inp of this.pending) this.run(inp);
    this.live = true;

    if (!had) {
      this.errX = 0;
      this.errY = 0;
      return;
    }
    const dx = wasX - this.ghost.x;
    const dy = wasY - this.ghost.y;
    const far = Math.abs(dx) > SNAP || Math.abs(dy) > SNAP;
    this.errX = far ? 0 : dx;
    this.errY = far ? 0 : dy;
  }

  private load(b: YouState): void {
    const g = this.ghost;
    const m = this.mov;
    g.x = b.x;
    g.y = b.y;
    g.status.sSpawn = !!(b.fl & YF.SPAWN);
    m.xVel = b.xVel;
    m.yVel = b.yVel;
    m.jumping = !!(b.fl & YF.JUMPING);
    m.crouching = !!(b.fl & YF.CROUCHING);
    m.landHard = !!(b.fl & YF.LAND_HARD);
    m.jumpClimb = !!(b.fl & YF.JUMP_CLIMB);
    m.parachute = !!(b.fl & YF.PARACHUTE);
    m.falltimer = b.ft;
    m.climb = b.cl;
    m.climbSize = b.cs;
  }

  private run(inp: PendingInput): void {
    this.ghost.keys = inp.keys & 15;
    if (inp.edges & EDGE.JUMP) this.mov.doJump();
    this.mov.resetMods();
    this.mov.EnterFrame();
  }
}
