export const DESIGN_WIDTH = 800;
export const DESIGN_HEIGHT = 600;

export let GAME_WIDTH: number = DESIGN_WIDTH;
export let GAME_HEIGHT: number = DESIGN_HEIGHT;

export function computeStageSize(
  vw: number,
  vh: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(vw / DESIGN_WIDTH, vh / DESIGN_HEIGHT);
  return {
    width: Math.max(DESIGN_WIDTH, Math.round(vw / scale)),
    height: Math.max(DESIGN_HEIGHT, Math.round(vh / scale)),
    scale,
  };
}

const stageResizeHandlers = new Set<() => void>();

export function onStageResize(fn: () => void): () => void {
  stageResizeHandlers.add(fn);
  return () => {
    stageResizeHandlers.delete(fn);
  };
}

export function setStageSize(w: number, h: number): void {
  if (w === GAME_WIDTH && h === GAME_HEIGHT) return;
  GAME_WIDTH = w;
  GAME_HEIGHT = h;
  for (const fn of [...stageResizeHandlers]) fn();
}

export const FPS = 30;
export const MS_PER_FRAME = 1000 / FPS;

export const PTM = 30;

export const VERSION = "v20.8s";

export const ASSET_BASE = "assets";

export const ASSET_V: string =
  typeof __ASSET_V__ === "string" ? __ASSET_V__ : "dev";

export const CAMERA_ZOOM = 1;

declare const __ASSET_V__: string | undefined;
