import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysBody extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("body", costume, flip, scale);
  }
}
