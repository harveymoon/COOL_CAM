import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseStl, newJob, placementFor, IDENTITY_PLACEMENT, getTool, signedArea } from '../src/index.js';
import type { Model, Rough3DOp } from '../src/index.js';
import { surfaceFor } from '../src/ops/surface.js';

const stlDir = path.resolve(__dirname, '../../../examples/stl');

describe('3D surface cache', () => {
  it('is invalidated by moving one vertex of an avoid shape, even when its point count and bounding box stay the same', () => {
    const mesh = parseStl(fs.readFileSync(path.join(stlDir, 'dome-cap-2in-12mm.stl')));
    const job = newJob('cache', { width: 90, length: 90, thickness: 13 });
    const model: Model = { id: 'm1', positions: Array.from(mesh.positions), placement: { ...IDENTITY_PLACEMENT } };
    model.placement = placementFor(model, { centerX: 45, centerY: 45, top: 0 });
    job.models = [model];
    // a rectangle with an extra vertex on its left edge: that vertex can move without changing the bounding box
    const pts = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 80 }, { x: 10, y: 80 }, { x: 10, y: 45 }];
    job.shapes.push({ id: 'avoid', polyline: { points: pts.map(p => ({ ...p })), closed: true } });
    const op: Rough3DOp = { id: 'r', type: 'rough3d', toolId: 't201', modelId: 'm1', shapeIds: [], avoidShapeIds: ['avoid'], depth: 12, boundaryMode: 'stock', containment: 'inside' };
    const tool = getTool(job, 't201');
    const area = (s: ReturnType<typeof surfaceFor>) => s.allowed.reduce((a, l) => a + signedArea(l), 0);
    const a = surfaceFor(job, op, tool, 0.5);
    expect(surfaceFor(job, op, tool, 0.5)).toBe(a); // unchanged job: cache hit
    job.shapes[0].polyline.points[4].x = 25; // the extra vertex moves inward: 5 points, same bbox, smaller avoid region
    const b = surfaceFor(job, op, tool, 0.5);
    expect(b).not.toBe(a);
    expect(area(b)).toBeGreaterThan(area(a) + 50);
    // and the mesh: one coordinate of a vertex far from the bounding box extremes
    const c0 = job.models[0].positions[Math.floor(job.models[0].positions.length / 2)];
    job.models[0].positions[Math.floor(job.models[0].positions.length / 2)] = c0 + 0.01;
    expect(surfaceFor(job, op, tool, 0.5)).not.toBe(b);
  });
});
