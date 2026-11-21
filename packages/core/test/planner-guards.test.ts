import { describe, it, expect } from 'vitest';
import { newJob, rect, circleShape, generateToolpaths, getTool, stockBounds } from '../src/index.js';
import type { ProfileOp, PocketOp, DrillOp, Job } from '../src/index.js';

const job = (): Job => {
  const j = newJob('guards', { width: 100, length: 100, thickness: 10 });
  j.stock.spoilboard = 1;
  j.shapes.push({ id: 'r', polyline: rect(20, 20, 40, 40) }, { id: 'c', polyline: circleShape(80, 80, 6) });
  return j;
};
const deepest = (j: Job) => Math.min(...generateToolpaths(j).flatMap(t => t.moves).map(m => m.z));

describe('planner guards', () => {
  it('clamps 2.5D ops at the spoilboard floor instead of cutting below it, and says so', () => {
    for (const op of [
      { id: 'p', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 25 } as ProfileOp,
      { id: 'k', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 25, entry: 'plunge' } as PocketOp,
      { id: 'd', type: 'drill', toolId: 't201', shapeIds: ['c'], depth: 25 } as DrillOp,
    ]) {
      const j = job(); j.ops = [op];
      const floor = stockBounds(j.stock).floor; // top 0, bottom -10, allowance 1
      expect(deepest(j), op.type).toBeCloseTo(floor, 6);
      expect(generateToolpaths(j)[0].warnings.join(' '), op.type).toMatch(/deeper than the stock .* cut to 11 mm/);
    }
  });
  it('leaves an ordinary through-cut alone', () => {
    const j = job(); j.ops = [{ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 10.5 } as ProfileOp];
    expect(deepest(j)).toBeCloseTo(-10.5, 6);
    expect(generateToolpaths(j)[0].warnings.join(' ')).not.toMatch(/deeper than the stock/);
  });
  it('refuses a tool without a diameter and an absurd pass count instead of hanging', () => {
    const j = job(); getTool(j, 't201').diameter = 0;
    j.ops = [{ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 5 } as ProfileOp];
    expect(generateToolpaths(j)[0].warnings.join(' ')).toMatch(/Generation failed: .*no usable diameter/);
    const k = job(); k.ops = [{ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 5, depthPerPass: 0.0001 } as ProfileOp];
    const t0 = Date.now(); const w = generateToolpaths(k)[0].warnings.join(' ');
    expect(w).toMatch(/Generation failed: .*passes/); expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('resolves tools by id only, never by T number', () => {
    const j = job();
    const other = getTool(j, 't102'); other.number = 777; // a tool whose *number* is "201"-like must not shadow an id
    getTool(j, 't201').number = 102;
    expect(getTool(j, 't102').id).toBe('t102');
    expect(() => getTool(j, '102')).toThrow(/Unknown tool '102'/);
  });
});
