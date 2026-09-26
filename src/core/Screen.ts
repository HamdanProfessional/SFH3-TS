import { Container } from "pixi.js";
import type { Engine } from "./Engine";

export abstract class Screen {
  readonly view = new Container();
  protected engine: Engine;

  constructor(engine: Engine, _arg?: unknown) {
    this.engine = engine;
  }

  abstract enterFrame(dt: number): void;

  resize?(): void;

  renderFrame?(alpha: number): void;

  get padFocus(): boolean {
    return false;
  }

  get focusKeys(): boolean {
    return false;
  }

  destroyedView = false;

  destructor(): void {
    this.destroyedView = true;
    this.view.destroy({ children: true });
  }
}

export type ScreenClass = new (engine: Engine, arg?: unknown) => Screen;
