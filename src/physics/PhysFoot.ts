import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysFoot extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("foot", costume, flip, scale);
  }
}
