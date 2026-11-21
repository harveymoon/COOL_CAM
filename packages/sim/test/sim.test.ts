import { describe, it, expect } from 'vitest';
import { newJob, rect, generateToolpaths } from '@cool-cam/core';
import type { PocketOp, ProfileOp, Toolpath } from '@cool-cam/core';
import { StockSim, simulate } from '../src/index.js';

describe('stock sim', () => {
  it('removes roughly the pocket volume', () => {
    const j = newJob('sim', { width: 60, length: 60, thickness: 10 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 40) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 3, entry: 'plunge', stepover: 2 } as PocketOp);
    const tps = generateToolpaths(j);
    const s = simulate(j, tps, { resolution: 0.25 });
    expect(s.removedVolume).toBeGreaterThan(40 * 40 * 3 * 0.9);
    expect(s.removedVolume).toBeLessThan(40 * 40 * 3 * 1.05);
    expect(s.minHeight).toBeCloseTo(-3, 3);
    expect(s.events.filter(e => e.severity === 'error')).toEqual([]);
  });
  it('flags a rapid through stock and cuts below the stock', () => {
    const j = newJob('sim2', { width: 60, length: 60, thickness: 10 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 40) });
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 11 } as ProfileOp);
    const tps = generateToolpaths(j);
    // hand-built: the planners clamp at the spoilboard floor now, so the below-stock cut has to be written out
    const bad: Toolpath = { opId: 'x', opName: 'bad', toolId: 't201', rpm: 18000, warnings: [], moves: [
      { kind: 'rapid', x: 0, y: 30, z: -1 }, { kind: 'rapid', x: 60, y: 30, z: -1 },
      { kind: 'rapid', x: 5, y: 5, z: 2 }, { kind: 'plunge', x: 5, y: 5, z: -11, f: 300 }, { kind: 'retract', x: 5, y: 5, z: 2 },
    ] };
    const s = simulate(j, [bad, ...tps], { resolution: 0.5 });
    expect(s.events.some(e => e.code === 'rapid-into-stock')).toBe(true);
    expect(s.events.some(e => e.code === 'below-stock')).toBe(true);
  });
  it('flags a rapid below the floor beside the stock, where the height grid does not reach', () => {
    const j = newJob('sim4', { width: 60, length: 60, thickness: 10 });
    const t = (moves: Toolpath['moves']): Toolpath => ({ opId: 'x', opName: 'x', toolId: 't201', rpm: 18000, warnings: [], moves });
    // a rapid travelling at Z -12 (the stock bottom is -10, no allowance) to the left of the stock
    const bad = simulate(j, [t([{ kind: 'rapid', x: -20, y: 10, z: 5 }, { kind: 'rapid', x: -20, y: 10, z: -12 }, { kind: 'rapid', x: -20, y: 50, z: -12 }, { kind: 'rapid', x: -20, y: 50, z: 5 }])], { resolution: 0.5 });
    expect(bad.events.some(e => e.code === 'below-stock' && /Rapid .* outside the stock/.test(e.message))).toBe(true);
    // the same moves above the floor beside the stock are fine
    const ok = simulate(j, [t([{ kind: 'rapid', x: -20, y: 10, z: 5 }, { kind: 'rapid', x: -20, y: 10, z: -9 }, { kind: 'rapid', x: -20, y: 50, z: -9 }, { kind: 'rapid', x: -20, y: 50, z: 5 }])], { resolution: 0.5 });
    expect(ok.events.filter(e => e.severity === 'error')).toEqual([]);
  });
  it('seek reproduces runAll state', () => {
    const j = newJob('sim3', { width: 40, length: 40, thickness: 5 });
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 30, 30) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't102', shapeIds: ['r'], depth: 2, entry: 'plunge' } as PocketOp);
    const tps = generateToolpaths(j);
    const a = new StockSim(j, tps, { resolution: 0.5, keyframeEvery: 50 }); a.runAll();
    const full = a.heights.slice(); const vol = a.removedVolume;
    a.seek(Math.floor(a.moves.length / 2));
    expect(a.removedVolume).toBeLessThan(vol);
    a.seek(a.moves.length);
    expect(a.removedVolume).toBeCloseTo(vol, 6);
    let diff = 0; for (let i = 0; i < full.length; i++) diff += Math.abs(full[i] - a.heights[i]);
    expect(diff).toBe(0);
  });
});
