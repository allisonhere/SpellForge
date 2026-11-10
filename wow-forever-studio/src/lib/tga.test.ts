import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { decodeTga } from "./tga";

const hdr = (type: number, w: number, h: number, bpp: number, desc: number) => { const b = new Uint8Array(18); b[2] = type; b[12] = w & 255; b[13] = w >> 8; b[14] = h & 255; b[15] = h >> 8; b[16] = bpp; b[17] = desc; return b; };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

describe("TGA decoder", () => {
  it("decodes 32-bit BGRA, top-left origin", () => {
    const t = decodeTga(cat(hdr(2, 2, 1, 32, 0x28), new Uint8Array([10, 20, 30, 255, 1, 2, 3, 128])));
    expect([t.width, t.height]).toEqual([2, 1]);
    expect(Array.from(t.data)).toEqual([30, 20, 10, 255, 3, 2, 1, 128]);
  });
  it("flips bottom-left origin images to top-down", () => {
    const t = decodeTga(cat(hdr(2, 1, 2, 24, 0x00), new Uint8Array([1, 1, 1, 9, 9, 9])));
    expect(Array.from(t.data.slice(0, 4))).toEqual([9, 9, 9, 255]); // file's last row is the top
  });
  it("decodes RLE runs and raw packets", () => {
    const t = decodeTga(cat(hdr(10, 4, 1, 24, 0x20), new Uint8Array([0x82, 5, 6, 7, 0x00, 1, 2, 3])));
    expect(Array.from(t.data)).toEqual([7, 6, 5, 255, 7, 6, 5, 255, 7, 6, 5, 255, 3, 2, 1, 255]);
  });
  it("decodes greyscale", () => { expect(Array.from(decodeTga(cat(hdr(3, 1, 1, 8, 0x20), new Uint8Array([77]))).data)).toEqual([77, 77, 77, 255]); });
  it("rejects what it cannot render instead of drawing garbage", () => {
    expect(() => decodeTga(hdr(1, 1, 1, 8, 0))).toThrow(/not supported|unsupported/);
    expect(() => decodeTga(cat(hdr(2, 2, 2, 32, 0), new Uint8Array(4)))).toThrow(/truncated/);
    expect(() => decodeTga(new Uint8Array(5))).toThrow(/short/);
  });
  const real = process.env.HOME + "/Projects/Tempus/media";
  it.skipIf(!existsSync(real + "/bar-tempus.tga"))("decodes Tempus's real textures with the right sizes and real alpha", () => {
    const expected: Record<string, [number, number]> = { "bar-tempus.tga": [256, 32], "glow.tga": [64, 64], "icon.tga": [128, 128], "header-base.tga": [1024, 64], "icon-minimap.tga": [32, 32] };
    for (const [f, [w, h]] of Object.entries(expected)) {
      const t = decodeTga(readFileSync(`${real}/${f}`));
      expect([t.width, t.height], f).toEqual([w, h]);
      let nonBlank = 0; for (let i = 0; i < t.data.length; i += 4) if (t.data[i + 3]! > 0) nonBlank++;
      expect(nonBlank, `${f} should contain visible pixels`).toBeGreaterThan(0);
    }
  });
});
