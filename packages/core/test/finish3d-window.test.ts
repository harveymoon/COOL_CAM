import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseStl, newJob, placementFor, IDENTITY_PLACEMENT, generateToolpaths, getTool, meshBBox, placedMesh, meshHeightmap, sampleHeightmap, toolProfile } from '../src/index.js';
import type { Model, Finish3DOp, Job, Toolpath } from '../src/index.js';

const stlDir = path.resolve(__dirname, '../../../examples/stl');

/** Lowest clearance between the cutter and the model over every cutting move, sampling the whole cutter footprint. */
function clearance(job: Job, model: Model, tp: Toolpath): number {
  const mesh = placedMesh(model); const bb = meshBBox(mesh);
  const hm = meshHeightmap(mesh, 0.05, { x0: bb.min[0] - 5, y0: bb.min[1] - 5, x1: bb.max[0] + 5, y1: bb.max[1] + 5 }, bb.min[2]);
  const tool = getTool(job, tp.toolId); const r = tool.diameter / 2;
  const ring: [number, number][] = [[0, 0]];
  for (const f of [0.25, 0.5, 0.75, 0.97]) for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; ring.push([f * r * Math.cos(a), f * r * Math.sin(a)]); }
  let worst = Infinity;
  for (const m of tp.moves) {
    if (m.kind === 'rapid' || m.kind === 'retract') continue;
    for (const [dx, dy] of ring) worst = Math.min(worst, m.z + toolProfile(tool, Math.hypot(dx, dy)) - sampleHeightmap(hm, m.x + dx, m.y + dy));
  }
  return worst;
}

describe('finish3d with a Z window (startDepth)', () => {
  for (const [file, label] of [['squat-pyramid-2in-12mm.stl', 'pyramid faces'], ['half-dodecahedron-2in-12mm.stl', 'dodecahedron facets'], ['dome-cap-2in-12mm.stl', 'dome']] as const) {
    it(`does not cut into the ${label} where the window top crosses the surface`, () => {
      const mesh = parseStl(fs.readFileSync(path.join(stlDir, file)));
      const job = newJob('win', { width: 90, length: 90, thickness: 13 });
      const model: Model = { id: 'm', positions: Array.from(mesh.positions), placement: { ...IDENTITY_PLACEMENT } };
      model.placement = placementFor(model, { centerX: 45, centerY: 45, top: 0 });
      job.models = [model];
      for (const startDepth of [2, 4.5]) {
        const op: Finish3DOp = { id: 'f', type: 'finish3d', toolId: 't101', modelId: 'm', shapeIds: [], depth: 12.5, startDepth, stepover: 0.5, axis: 'x' };
        job.ops = [op];
        const [tp] = generateToolpaths(job);
        const cuts = tp.moves.filter(m => m.kind === 'cut');
        expect(cuts.length, `${label} window ${startDepth}`).toBeGreaterThan(100);
        expect(Math.max(...cuts.map(m => m.z)), `${label} window ${startDepth}: nothing above the window top`).toBeLessThanOrEqual(-startDepth + 1e-6);
        // the heightmap's own interpolation margin allows a few hundredths; anything more is a nick
        expect(clearance(job, model, tp), `${label} window ${startDepth}`).toBeGreaterThan(-0.05);
      }
    });
  }
});
