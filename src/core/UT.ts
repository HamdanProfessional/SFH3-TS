let curDate = 0;

export const UT = {
  rotateDistance(from: number, to: number): number {
    return UT.fixRotation(to - from);
  },

  fixRotation(a: number): number {
    if (a > 180) a -= 360;
    if (a < -180) a += 360;
    return a;
  },

  getRotation(x1: number, y1: number, x2: number, y2: number): number {
    return UT.fixRotation((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90);
  },

  rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  },

  fixFloat(n: number): number {
    return Math.round(n * 10) / 10;
  },

  getOrdinal(n: number): string {
    const mod100 = n % 100;
    let suffix: string;
    if (mod100 > 10 && mod100 < 14) {
      suffix = "th";
    } else {
      switch (n % 10) {
        case 1:
          suffix = "st";
          break;
        case 2:
          suffix = "nd";
          break;
        case 3:
          suffix = "rd";
          break;
        default:
          suffix = "th";
      }
    }
    return n + suffix;
  },

  rotateDirection(from: number, to: number): number {
    return UT.fixRotation(to - from) <= 0 ? -1 : 1;
  },

  getDist(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  },

  getRatio(a: number, b: number): string {
    if (!a && !b) return "0 : 0";
    if (!a) return "0 : " + b;
    if (!b) return a + " : 0";
    if (a === b) return "1 : 1";
    if (a > b) return Math.round((a / b) * 100) / 100 + " : 1";
    return "1 : " + Math.round((b / a) * 100) / 100;
  },

  irand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  randEl<T>(ar: readonly T[]): T {
    return ar[UT.irand(0, ar.length - 1)];
  },

  getLinearRange(
    val: number,
    valMax: number,
    rangeMin: number,
    rangeMax: number,
  ): number {
    return rangeMin + ((rangeMax - rangeMin) / (valMax - 1)) * (val - 1);
  },

  getCurvedRange(
    val: number,
    valMax: number,
    rangeMin: number,
    rangeMax: number,
  ): number {
    const valMid = valMax - 1;
    const useVal = val - 1;
    return rangeMin + ((rangeMax - rangeMin) / (valMid * valMid)) * (useVal * useVal);
  },

  inBox(
    x: number, y: number,
    bx: number, by: number, bw: number, bh: number,
  ): boolean {
    return x > Math.min(bx, bx + bw) && x < Math.max(bx, bx + bw)
      && y > Math.min(by, by + bh) && y < Math.max(by, by + bh);
  },

  between(val: number, min: number, max: number): boolean {
    return val >= min && val <= max;
  },

  addNumCommas(n: number): string {
    const neg = n < 0;
    const digits = Math.abs(Math.trunc(n)).toString();
    let out = "";
    for (let i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
      out += digits[i];
    }
    return neg ? "-" + out : out;
  },

  setDate(): void {
    curDate = Date.now();
  },

  getOscillation(speed: number, size: number, offset = 0): number {
    return Math.cos((curDate + offset) * (speed * 0.001)) * size;
  },

  replaceString(src: string, find: string, replace: string): string {
    return src.split(find).join(replace);
  },
} as const;
