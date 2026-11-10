/** mulberry32: tiny, fast, well-distributed, and fully deterministic for a given 32-bit seed. */
export function nextRng(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, state: t };
}
