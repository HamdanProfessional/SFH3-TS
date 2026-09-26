import { Container } from "pixi.js";
import type { Tooltip } from "../../ui/Tooltip";
import type { InvItem } from "../../state/SD";
import type { CustomMap } from "../../editor/format";

export interface PageHost {
  goto(frame: string): void;
  readonly tooltip: Tooltip;
  refresh(): void;
  openTransaction(item: InvItem, mode: "buy" | "sell"): void;
  openHire(): void;
  openFire(): void;
  openBuild(bpNum: number): void;
  showHireReveal(unit: unknown): void;
  startMatch(): void;
  startNetMatch(): void;
  openEditor(arg?: unknown): void;
  playCustom(m: CustomMap): Promise<string | null>;
}

export abstract class MenuPage {
  readonly view = new Container();

  constructor(protected host: PageHost) {}

  abstract build(w: number, h: number): void;

  update(_dt: number): void {}

  onClick(): void {}

  layout(w: number, h: number): void {
    this.view.removeChildren();
    this.build(w, h);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
