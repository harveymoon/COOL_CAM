import { describe, it, expect } from 'vitest';
import { newJob, rect, generateToolpaths } from '@cool-cam/core';
import type { ProfileOp, PocketOp } from '@cool-cam/core';
import { postGrbl } from '../src/index.js';

describe('grbl post', () => {
  it('emits header, M6 tool changes with G53 safe move, and M30', () => {
    const j = newJob('post-test', { width: 50, length: 50, thickness: 6 });
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 40, 40) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 2, entry: 'plunge' } as PocketOp);
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't102', shapeIds: ['r'], side: 'outside', depth: 6 } as ProfileOp);
    const tps = generateToolpaths(j);
    const r = postGrbl(j, tps);
    const g = r.gcode;
    expect(g).toMatch(/^\(post-test\)/);
    expect(g).toContain('G90 G21 G17 G94');
    expect(g).toContain('M6 T201'); expect(g).toContain('M6 T102');
    expect(r.toolChanges).toBe(2);
    expect(g.split('G53 G0 Z-5.000').length - 1).toBe(3); // before each tool + end
    expect(g.trim().endsWith('M30')).toBe(true);
    expect(g).toContain('M3 S18000');
    // first G1 must carry a feed
    const firstG1 = g.split('\n').find(l => l.startsWith('G1'))!;
    expect(firstG1).toMatch(/F\d+/);
    expect(r.warnings).toEqual([]);
  });
  it('supports M0 pause style tool changes', () => {
    const j = newJob('m0', { width: 50, length: 50, thickness: 6 });
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 40, 40) });
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'on', depth: 1 } as ProfileOp);
    const r = postGrbl(j, generateToolpaths(j), { toolChange: 'm0-pause' });
    expect(r.gcode).toContain('\nM0\n'); expect(r.gcode).not.toContain('M6');
  });
});
