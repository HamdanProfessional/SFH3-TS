const DEG = Math.PI / 180;

export function fixRotation(rot: number): number {
  if (rot > 180) rot -= 360;
  if (rot < -180) rot += 360;
  return rot;
}

export function fixRotation360(rot: number): number {
  if (rot > 360) rot -= 360;
  if (rot < 0) rot += 360;
  return rot;
}

export function getRotation(x1: number, y1: number, x2: number, y2: number): number {
  return fixRotation((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90);
}

export function rotateDistance(cur: number, next: number): number {
  return fixRotation(next - cur);
}

export function rotateDirection(cur: number, next: number): number {
  return fixRotation(next - cur) > 0 ? 1 : -1;
}

export function getDist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

export function getPythagorean(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

export function xMoveToRot(rot: number, spd: number): number {
  return rot === 0 || rot === 180 || rot === -180 ? 0 : Math.sin(rot * DEG) * spd;
}

export function yMoveToRot(rot: number, spd: number): number {
  return rot === 90 || rot === -90 ? 0 : Math.cos(rot * DEG) * -spd;
}

export function rotBounceOff(
  rotation: number,
  x: number,
  y: number,
  impactX: number,
  impactY: number,
): number {
  const rot = getRotation(x, y, impactX, impactY);
  const diff = fixRotation(rotation - rot);
  return fixRotation(rotation - diff + 180);
}

export function coinFlip<T>(a: T, b: T, aChance = 0.5): T {
  return Math.random() < aChance ? a : b;
}

export function randLinePoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const x = Math.random() * (x2 - x1) + x1;
  return { x, y: y1 + ((x - x1) / (x2 - x1)) * (y2 - y1) };
}

export function getPosNegSign(n: number): number {
  return n >= 0 ? 1 : -1;
}

export function inBox(
  findX: number,
  findY: number,
  startX: number,
  startY: number,
  width: number,
  height: number,
): boolean {
  return (
    findX > Math.min(startX, startX + width) &&
    findX < Math.max(startX, startX + width) &&
    findY > Math.min(startY, startY + height) &&
    findY < Math.max(startY, startY + height)
  );
}
