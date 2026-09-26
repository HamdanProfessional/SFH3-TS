import { Graphics } from "pixi.js";
import type { LineSink } from "../game/types";

type Op =
  | { k: "m"; x: number; y: number }
  | { k: "l"; x: number; y: number }
  | { k: "q"; cx: number; cy: number; x: number; y: number };

export class LineLayer extends Graphics implements LineSink {
  private readonly ops: Op[] = [];
  private drawable = false;
  private lineWidth = 1;
  private lineColor = 0xffffff;
  private lineAlpha = 1;

  lineStyle(thickness: number, color: number, alpha: number): this {
    this.flush();
    this.lineWidth = thickness;
    this.lineColor = color;
    this.lineAlpha = Math.max(0, Math.min(1, alpha));
    return this;
  }

  moveTo(x: number, y: number): this {
    this.ops.push({ k: "m", x, y });
    return this;
  }

  lineTo(x: number, y: number): this {
    this.ops.push({ k: "l", x, y });
    this.drawable = true;
    return this;
  }

  curveTo(cx: number, cy: number, x: number, y: number): this {
    this.ops.push({ k: "q", cx, cy, x, y });
    this.drawable = true;
    return this;
  }

  flush(): void {
    if (this.drawable && this.ops.length >= 2) {
      let open = false;
      for (const op of this.ops) {
        if (op.k === "m") {
          super.moveTo(op.x, op.y);
          open = true;
        } else if (op.k === "l") {
          if (open) super.lineTo(op.x, op.y);
        } else {
          if (open) super.quadraticCurveTo(op.cx, op.cy, op.x, op.y);
        }
      }
      super.stroke({
        width: this.lineWidth,
        color: this.lineColor,
        alpha: this.lineAlpha,
        cap: "round",
        join: "round",
      });
    }
    this.ops.length = 0;
    this.drawable = false;
  }

  override clear(): this {
    super.clear();
    this.ops.length = 0;
    this.drawable = false;
    return this;
  }
}
