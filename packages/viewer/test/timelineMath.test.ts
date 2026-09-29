import { describe, it, expect } from 'vitest';
import { idxToTime, timeToIdx } from '../src/timelineMath';

describe('timeline playhead maths', () => {
  const tl = Float64Array.from([0.8, 1.6, 2.0, 2.0, 5.0]); // move 3 takes no time

  it('round-trips fractional indices, including inside the first move', () => {
    for (const i of [0, 0.25, 0.5, 1, 1.5, 2.9, 4.5]) expect(timeToIdx(tl, idxToTime(tl, i))).toBeCloseTo(i, 6);
    expect(idxToTime(tl, 0.5)).toBeCloseTo(0.4, 9);
    expect(idxToTime(tl, 5)).toBe(5);
    expect(timeToIdx(tl, 99)).toBe(5);
  });

  it('play from the very start advances monotonically instead of stalling (the old conversion returned 0 for any index below 1)', () => {
    let p = 0; const seen: number[] = [];
    for (let k = 0; k < 60; k++) { p = Math.min(tl.length, timeToIdx(tl, idxToTime(tl, p) + 0.1)); seen.push(p); }
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1]);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(tl.length);
  });
});
