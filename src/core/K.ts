export const K = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  MOUSE: 16,
} as const;

export type KFlag = (typeof K)[keyof typeof K];
