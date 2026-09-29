/**
 * Playhead ↔ time conversions over the simulation timeline `tl`, where tl[i] is the cumulative time (s) at the END of move
 * i and, by convention, the time at the start of move 0 is 0. A playhead position is a fractional move index: 3.25 means a
 * quarter of the way through move 3.
 */
export function idxToTime(tl: ArrayLike<number>, i: number): number {
  if (tl.length === 0) return 0;
  const w = Math.floor(Math.max(0, i));
  if (w >= tl.length) return tl[tl.length - 1];
  const t0 = w > 0 ? tl[w - 1] : 0, t1 = tl[w];
  return t0 + (t1 - t0) * (i - w);
}

export function timeToIdx(tl: ArrayLike<number>, t: number): number {
  if (tl.length === 0) return 0;
  if (t <= 0) return 0;
  const last = tl[tl.length - 1];
  if (t >= last) return tl.length;
  let lo = 0, hi = tl.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tl[mid] < t) lo = mid + 1; else hi = mid; }
  const t0 = lo > 0 ? tl[lo - 1] : 0, t1 = tl[lo];
  return lo + (t1 > t0 ? (t - t0) / (t1 - t0) : 0);
}
