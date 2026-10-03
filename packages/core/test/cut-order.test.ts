import { describe, it, expect } from 'vitest';
import { newJob, rect, circleShape, generateToolpaths } from '../src/index.js';
import type { ProfileOp } from '../src/index.js';

describe('profile cut order', () => {
  it('cuts the internal cutouts before the outline that frees the part', () => {
    const j = newJob('order', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 'plate', polyline: rect(10, 10, 80, 60) });
    j.shapes.push({ id: 'hole', polyline: circleShape(50, 40, 20) });
    // tabs off on purpose: with the outline cut first the plate would be loose while the hole is machined
    j.ops.push({ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['plate', 'hole'], side: 'outside', depth: 12, depthPerPass: 4 } as ProfileOp);
    const [tp] = generateToolpaths(j);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    const fromHole = (m: { x: number; y: number }) => Math.hypot(m.x - 50, m.y - 40);
    expect(fromHole(cuts[0])).toBeLessThan(12);            // the hole (10 mm radius, cut inside it) comes first
    const firstOutline = cuts.findIndex(m => fromHole(m) > 20);
    expect(firstOutline).toBeGreaterThan(0);               // and the outline is cut too, after it
    expect(cuts.slice(firstOutline).every(m => fromHole(m) > 12)).toBe(true); // never back to the hole once the outline started
  });
});
