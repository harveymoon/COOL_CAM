import { describe, it, expect } from 'vitest';
import { newJob, rect, circleShape, generateToolpaths } from '../src/index.js';
import type { PocketOp } from '../src/index.js';

describe('pocket entry', () => {
  it('uses the requested entry for every lobe of a region the tool cannot link through, and never plunges into solid stock', () => {
    // two round lobes joined by a 3 mm neck: no tool in the library fits the neck, so each lobe is its own island of
    // solid material and the second one needs its own helix. (This also caught the outer ring of a lobe being grouped
    // with the other lobe's rings and slotted before its own interior was cleared.)
    const j = newJob('dumbbell', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 'a', polyline: circleShape(25, 50, 30) });
    j.shapes.push({ id: 'b', polyline: circleShape(75, 50, 30) });
    j.shapes.push({ id: 'neck', polyline: rect(35, 48.5, 30, 3) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['a', 'b', 'neck'], depth: 4, entry: 'helix' } as PocketOp);
    const [tp] = generateToolpaths(j);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    expect(cuts.some(m => m.x < 40)).toBe(true); expect(cuts.some(m => m.x > 60)).toBe(true); // both lobes machined
    expect(tp.warnings.filter(w => /plunged instead/.test(w))).toEqual([]);
    // a plunge deeper than the half-millimetre approach gap is only allowed where the cutter overlaps ground an earlier cut
    // at that depth already cleared (a ring next to a finished ring); never into solid stock
    const r = 6.35 / 2;
    const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
      return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    };
    for (let i = 1; i < tp.moves.length; i++) {
      const m = tp.moves[i], p = tp.moves[i - 1];
      if (m.kind !== 'plunge' || p.z - m.z <= 0.5 + 1e-6) continue;
      const overCleared = tp.moves.slice(1, i).some((c, k) => c.kind === 'cut' && Math.abs(c.z - m.z) < 1e-6 && segDist(m, tp.moves[k], c) < r * 0.8);
      expect(overCleared, `plunge into solid stock at ${m.x.toFixed(1)},${m.y.toFixed(1)}`).toBe(true);
    }
    // each lobe is cleared inside-out: its first cut is on an inner ring, never on the outermost (radius 15 - 3.175),
    // which the grouping bug used to slot first, in solid material, as part of the other lobe's ring family
    for (const cx of [25, 75]) {
      const lobe = cuts.filter(m => Math.abs(m.x - cx) < 15);
      expect(Math.hypot(lobe[0].x - cx, lobe[0].y - 50)).toBeLessThan(7);
      expect(lobe.findIndex(m => Math.hypot(m.x - cx, m.y - 50) > 11.7)).toBeGreaterThan(10);
    }
  });
});
