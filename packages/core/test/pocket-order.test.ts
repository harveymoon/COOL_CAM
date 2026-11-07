import { describe, it, expect } from 'vitest';
import { newJob, circleShape, rect, generateToolpaths } from '../src/index.js';
import type { PocketOp } from '../src/index.js';

describe('pocket shape order', () => {
  it('finishes each separate pocket through every depth before moving to the next', () => {
    const j = newJob('order', { width: 200, length: 100, thickness: 6 });
    const centres = [{ x: 30, y: 50 }, { x: 100, y: 50 }, { x: 170, y: 50 }];
    centres.forEach((c, i) => j.shapes.push({ id: 'h' + i, polyline: circleShape(c.x, c.y, 16) }));
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['h0', 'h1', 'h2'], depth: 4, depthPerPass: 1, entry: 'helix' } as PocketOp);
    const [tp] = generateToolpaths(j);
    expect(tp.warnings.filter(w => /plunged instead/.test(w))).toEqual([]);
    const which = (m: { x: number; y: number }) => centres.findIndex(c => Math.hypot(m.x - c.x, m.y - c.y) < 9);
    const cutting = tp.moves.filter(m => (m.kind === 'cut' || m.kind === 'plunge' || m.kind === 'ramp') && m.z < -1e-6);
    // the sequence of pockets visited while below the stock top: each appears once, in one run
    const runs: number[] = [];
    for (const m of cutting) { const w = which(m); if (w >= 0 && runs[runs.length - 1] !== w) runs.push(w); }
    expect(runs.length).toBe(3);
    expect(new Set(runs).size).toBe(3);
    // every pocket reaches full depth
    for (let i = 0; i < 3; i++) expect(Math.min(...cutting.filter(m => which(m) === i).map(m => m.z))).toBeCloseTo(-4, 6);
    // inside a pocket the tool stays down between levels: it lifts to clearance only when changing pockets (and at the end)
    const clearance = Math.max(...tp.moves.map(m => m.z));
    let lifts = 0;
    for (let i = 1; i < tp.moves.length; i++) if (tp.moves[i].z >= clearance - 1e-6 && tp.moves[i - 1].z < clearance - 1e-6) lifts++;
    expect(lifts).toBeLessThanOrEqual(3);
  });

  it('a pocket with an island still cuts the ring round the island at every level', () => {
    const j = newJob('island', { width: 100, length: 100, thickness: 6 });
    j.shapes.push({ id: 'outer', polyline: rect(10, 10, 80, 80) });
    j.shapes.push({ id: 'island', polyline: rect(40, 40, 20, 20) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['outer', 'island'], depth: 3, depthPerPass: 1, entry: 'helix' } as PocketOp);
    const [tp] = generateToolpaths(j);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    for (const z of [-1, -2, -3]) {
      const lv = cuts.filter(m => Math.abs(m.z - z) < 1e-6);
      expect(lv.some(m => m.x > 30 && m.x < 70 && m.y > 60 && m.y < 66)).toBe(true); // just beyond the island, every level
      expect(lv.some(m => m.x > 30 && m.x < 70 && m.y < 40 && m.y > 34)).toBe(true);
      // never inside the island
      expect(lv.some(m => m.x > 40 + 3.1 && m.x < 60 - 3.1 && m.y > 40 + 3.1 && m.y < 60 - 3.1)).toBe(false);
    }
  });
});
