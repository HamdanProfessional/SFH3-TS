export interface ControlOptions {
  touchLayout: number;
  touchScale: number;
  touchLeft: boolean;
  touchAutoFire: boolean;
  touchFireAt: number;
  touchPos: Record<string, { x: number; y: number }>;
  stickReach: number;
}

export function defaultControls(): ControlOptions {
  return {
    touchLayout: 0, touchScale: 1, touchLeft: false, touchAutoFire: true, touchFireAt: 0.5,
    touchPos: {}, stickReach: 1,
  };
}

const fallback = defaultControls();
let read: () => ControlOptions = () => fallback;
let write: () => void = () => {};

export function bindControls(get: () => ControlOptions, save: () => void): void {
  read = get;
  write = save;
}

export function controls(): ControlOptions {
  return read();
}

export function saveControls(): void {
  write();
}
