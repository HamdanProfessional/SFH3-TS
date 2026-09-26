import { inflateSync } from "node:zlib";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Buffer): DecodedPng {
  for (let i = 0; i < SIG.length; i++) {
    if (buf[i] !== SIG[i]) throw new Error("not a PNG");
  }

  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  let seenIhdr = false;

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const body = off + 8;
    if (type === "IHDR") {
      width = buf.readUInt32BE(body);
      height = buf.readUInt32BE(body + 4);
      const depth = buf[body + 8];
      const colour = buf[body + 9];
      const interlace = buf[body + 12];
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error(
          `unsupported PNG: depth ${depth}, colour type ${colour}, `
          + `interlace ${interlace} (want 8/6/0)`,
        );
      }
      seenIhdr = true;
    } else if (type === "IDAT") {
      idat.push(buf.subarray(body, body + len));
    } else if (type === "IEND") {
      break;
    }
    off = body + len + 4;
  }

  if (!seenIhdr) throw new Error("PNG has no IHDR");
  if (!idat.length) throw new Error("PNG has no IDAT");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (raw.length < height * (stride + 1)) {
    throw new Error(`PNG short by ${height * (stride + 1) - raw.length} bytes`);
  }

  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x];
      const a = x >= 4 ? out[row + x - 4] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= 4 && y > 0 ? out[prev + x - 4] : 0;
      let v: number;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: v = cur + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
      out[row + x] = v & 0xff;
    }
    src += stride;
  }

  return { width, height, data: out };
}
