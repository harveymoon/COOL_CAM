import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Force the contour assembly to fail at one Z level so the skip path of the rougher runs. Everything else is the real code.
vi.mock('../src/mesh.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/mesh.js')>();
  const contoursBelow: typeof real.contoursBelow = (hm, z, domain) => {
    if (z < -5) throw new Error('forced contour failure');
    return real.contoursBelow(hm, z, domain);
  };
  return { ...real, contoursBelow };
});

import { parseStl, newJob, generateToolpaths, stockBounds } from '../src/index.js';
import type { Model, Rough3DOp } from '../src/index.js';

const stlDir = path.resolve(__dirname, '../../../examples/stl');

describe('rough3d skipped level', () => {
  it('stops above a level it cannot contour instead of rapiding through the uncut layer to the next one', () => {
    const mesh = parseStl(fs.readFileSync(path.join(stlDir, 'dome-cap-2in-12mm.stl')));
    const job = newJob('skip', { width: 71, length: 88, thickness: 18 });
    const model: Model = { id: 'model', positions: Array.from(mesh.positions), placement: { x: 33.77, y: 45.93, z: -15.6, rotX: 0, rotY: 0, rotZ: 30, scale: 1.3 } };
    job.models = [model];
    const op: Rough3DOp = { id: 'rough', type: 'rough3d', toolId: 't102', modelId: 'model', shapeIds: [], boundaryMode: 'silhouette', containment: 'center', boundary: -1.6, depth: 12.87, depthPerPass: 4, stockToLeave: 0.43, entry: 'plunge' };
    job.ops = [op];
    const [tp] = generateToolpaths(job);
    const top = stockBounds(job.stock).top;
    // the first level (top - 4) is cut; the second (top - 8) fails and nothing deeper may appear in the path
    expect(tp.warnings.some(w => /Z-8\.00 skipped: forced contour failure/.test(w) && /deeper levels are not generated/.test(w))).toBe(true);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    expect(cuts.length).toBeGreaterThan(50);
    expect(Math.min(...cuts.map(m => m.z))).toBeCloseTo(top - 4, 3);
    // no move of any kind (rapid, plunge, cut) goes below the last level that was actually cleared
    expect(Math.min(...tp.moves.map(m => m.z))).toBeGreaterThanOrEqual(top - 4 - 1e-6);
  });
});
