// Minimal TGA decoder: types 2 (uncompressed true-colour), 10 (RLE true-colour), 3 / 11 (greyscale, raw / RLE); 8/16?/24/32 bpp
// as WoW addons use them. Returns top-down RGBA. Unsupported variants throw rather than render garbage.
export interface Rgba8 { width: number; height: number; data: Uint8ClampedArray }

export function decodeTga(buf: ArrayBuffer | Uint8Array): Rgba8 {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 18) throw new Error("TGA: file too short");
  const idLen = b[0]!, cmType = b[1]!, type = b[2]!;
  const w = b[12]! | (b[13]! << 8), h = b[14]! | (b[15]! << 8), bpp = b[16]!, desc = b[17]!;
  if (cmType !== 0) throw new Error("TGA: colour-mapped images are not supported");
  if (![2, 3, 10, 11].includes(type)) throw new Error(`TGA: unsupported image type ${type}`);
  if (![8, 24, 32].includes(bpp) || (type === 3 || type === 11 ? bpp !== 8 : bpp === 8)) throw new Error(`TGA: unsupported ${bpp} bpp for type ${type}`);
  if (w === 0 || h === 0 || w * h > 64 * 1024 * 1024) throw new Error("TGA: bad dimensions");
  const bytes = bpp / 8, rle = type === 10 || type === 11, grey = type === 3 || type === 11;
  const px = new Uint8Array(w * h * bytes);
  let p = 18 + idLen;
  if (!rle) {
    if (b.length - p < px.length) throw new Error("TGA: truncated pixel data");
    px.set(b.subarray(p, p + px.length));
  } else {
    let o = 0;
    while (o < px.length) {
      if (p >= b.length) throw new Error("TGA: truncated RLE data");
      const head = b[p++]!, n = (head & 0x7f) + 1;
      if (head & 0x80) { for (let i = 0; i < n && o < px.length; i++) { px.set(b.subarray(p, p + bytes), o); o += bytes; } p += bytes; }
      else { const len = n * bytes; px.set(b.subarray(p, p + Math.min(len, px.length - o)), o); o += len; p += len; }
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const topDown = (desc & 0x20) !== 0, rightToLeft = (desc & 0x10) !== 0;
  for (let y = 0; y < h; y++) {
    const sy = topDown ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const sx = rightToLeft ? w - 1 - x : x;
      const s = (sy * w + sx) * bytes, d = (y * w + x) * 4;
      if (grey) { out[d] = out[d + 1] = out[d + 2] = px[s]!; out[d + 3] = 255; }
      else { out[d] = px[s + 2]!; out[d + 1] = px[s + 1]!; out[d + 2] = px[s]!; out[d + 3] = bytes === 4 ? px[s + 3]! : 255; }
    }
  }
  return { width: w, height: h, data: out };
}
