import { describe, it, expect } from 'vitest';
import { newJob, rect, generateToolpaths } from '@cool-cam/core';
import type { PocketOp, ProfileOp, Toolpath } from '@cool-cam/core';
import { simulate } from '../src/index.js';

const errorsOf = (s: ReturnType<typeof simulate>, code: string) => s.events.filter(e => e.code === code && e.severity === 'error');

describe('engagement checks', () => {
  it('flags a cut that meets far more material than its planned pass depth', () => {
    const j = newJob('deep', { width: 60, length: 60, thickness: 12 });
    // a hand-made "pocket" that slots 8 mm deep in one go while claiming a 2 mm pass
    const bad: Toolpath = { opId: 'bad', opName: 'bad', toolId: 't102', rpm: 18000, warnings: [], stepdown: 2, moves: [
      { kind: 'rapid', x: 10, y: 30, z: 3 }, { kind: 'plunge', x: 10, y: 30, z: -8, f: 300 }, { kind: 'cut', x: 50, y: 30, z: -8, f: 1000 }, { kind: 'retract', x: 50, y: 30, z: 3 },
    ] };
    const s = simulate(j, [bad], { resolution: 0.2 });
    expect(errorsOf(s, 'deep-engagement').length).toBeGreaterThan(0);
    expect(s.events.some(e => e.code === 'plunge-too-deep' && e.severity === 'warning')).toBe(true);
  });
  it('does not flag a thin wall-finishing skim that runs the full part height', () => {
    const j = newJob('skim', { width: 60, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(15, 15, 30, 30) });
    // roughing profile leaves 0.3 mm on the wall in 3 mm passes, then a single full-depth skim removes it
    j.ops.push({ id: 'rough', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 10, depthPerPass: 3, stockToLeave: 0.3 } as ProfileOp);
    j.ops.push({ id: 'skim', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 10, depthPerPass: 10 } as ProfileOp);
    const s = simulate(j, generateToolpaths(j), { resolution: 0.15 });
    expect(s.events.filter(e => e.severity === 'error')).toEqual([]);
  });
  it('flags the shank in the stock when a cut goes deeper than the flute length', () => {
    const j = newJob('shank', { width: 60, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 40) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't112', shapeIds: ['r'], depth: 9, depthPerPass: 1, entry: 'plunge' } as PocketOp); // 1/16", 6.35 mm flutes
    const tps = generateToolpaths(j);
    expect(tps[0].warnings.some(w => /flute length/.test(w))).toBe(true);
    const s = simulate(j, tps, { resolution: 0.2 });
    expect(errorsOf(s, 'shank-contact').length).toBeGreaterThan(0);
  });
  it('flags a pocket that starts below uncut material (start depth with nothing cleared above)', () => {
    const j = newJob('start', { width: 60, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 40) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 8, depthPerPass: 2, startDepth: 5, entry: 'helix' } as PocketOp);
    const s = simulate(j, generateToolpaths(j), { resolution: 0.2 });
    expect(errorsOf(s, 'deep-engagement').length).toBeGreaterThan(0);
  });
  it('stays quiet on a normal pocket + tabbed profile job', () => {
    const j = newJob('ok', { width: 80, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 30, 4) });
    j.shapes.push({ id: 'o', polyline: rect(5, 5, 70, 50, 6) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 6, depthPerPass: 3, entry: 'helix', finishPass: true, stockToLeave: 0.3 } as PocketOp);
    j.ops.push({ id: 'q', type: 'profile', toolId: 't102', shapeIds: ['o'], side: 'outside', depth: 12, depthPerPass: 2.5, entry: 'ramp', tabs: { count: 4, width: 6, height: 2 } } as ProfileOp);
    const s = simulate(j, generateToolpaths(j));
    expect(s.events.filter(e => e.severity === 'error')).toEqual([]);
    expect(s.cells.res).toBeLessThanOrEqual(3.175 / 4 + 1e-9); // resolution follows the smallest cutter
  });
});

describe('spoilboard allowance', () => {
  it('accepts cuts inside the allowance and errors beyond it', () => {
    const mk = (z: number): Toolpath => ({ opId: 'p', opName: 'p', toolId: 't102', rpm: 18000, warnings: [], stepdown: 1, moves: [
      { kind: 'rapid', x: 10, y: 30, z: 3 }, { kind: 'plunge', x: 10, y: 30, z, f: 300 }, { kind: 'cut', x: 30, y: 30, z, f: 1000 }, { kind: 'retract', x: 30, y: 30, z: 3 },
    ] });
    const j = newJob('sb', { width: 60, length: 60, thickness: 5 });
    expect(errorsOf(simulate(j, [mk(-5.4)], { resolution: 0.2 }), 'below-stock').length).toBeGreaterThan(0);
    j.stock.spoilboard = 1;
    expect(errorsOf(simulate(j, [mk(-5.4)], { resolution: 0.2 }), 'below-stock').length).toBe(0);
    expect(errorsOf(simulate(j, [mk(-6.4)], { resolution: 0.2 }), 'below-stock').length).toBeGreaterThan(0);
  });
});
