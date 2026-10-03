import { describe, it, expect } from 'vitest';
import { newJob, rect, generateToolpaths } from '@cool-cam/core';
import type { Move, ProfileOp, PocketOp, Toolpath } from '@cool-cam/core';
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
  it('always carries X and Y on the first move after a tool change, even when the next op starts where the last one ended', () => {
    // the change itself moves the spindle (BitSetter probe / jogging to swap the bit): a drill and a chamfer at the same hole
    const j = newJob('xy', { width: 50, length: 50, thickness: 6 });
    const at = (id: string, toolId: string): Toolpath => ({ opId: id, opName: id, toolId, rpm: 18000, warnings: [], moves: [
      { kind: 'rapid', x: 20, y: 20, z: 10 }, { kind: 'plunge', x: 20, y: 20, z: -2, f: 300 }, { kind: 'retract', x: 20, y: 20, z: 10 }] });
    for (const mode of ['m6-prompt', 'm0-pause'] as const) {
      const lines = postGrbl(j, [at('drill', 't201'), at('chamfer', 't102')], { toolChange: mode }).gcode.split('\n');
      const change = lines.findIndex((l, i) => i > 0 && (l.startsWith('M6') || l === 'M0')); expect(change).toBeGreaterThan(0);
      const after = lines.slice(change + 1);
      const firstMove = after.findIndex(l => /^G[01]/.test(l)); const firstCut = after.findIndex(l => l.startsWith('G1'));
      const xy = after.findIndex(l => /^G0 X20\.000 Y20\.000$/.test(l));
      expect(xy).toBeGreaterThanOrEqual(0);
      expect(xy).toBeLessThan(firstCut);
      // traverse happens at the safe height first, then XY, then the descent
      expect(after[firstMove]).toBe('G0 Z10.000');
    }
  });
  it('strips parentheses and line breaks from names before putting them in comments', () => {
    const j = newJob('sign (v2)\nM3', { width: 50, length: 50, thickness: 6 });
    j.material = 'MDF (Medex)';
    j.tools[0].name = '1/4" Endmill (Upcut)';
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 40, 40) });
    j.ops.push({ id: 'pr', name: 'cut) G0 Z-50', type: 'profile', toolId: j.tools[0].id, shapeIds: ['r'], side: 'on', depth: 1 } as ProfileOp);
    const lines = postGrbl(j, generateToolpaths(j)).gcode.split('\n');
    for (const l of lines) {
      if (!l.startsWith('(')) continue;
      expect(l.endsWith(')')).toBe(true);
      expect(l.slice(1, -1)).not.toMatch(/[()]/);
    }
    expect(lines).not.toContain('M3');           // the line break in the job name could not inject a command
    expect(lines.filter(l => !l.startsWith('(')).some(l => l.includes('G0 Z-50'))).toBe(false); // the ')' could not escape the comment
  });
  it("refuses tool-change mode 'none' with more than one tool, and allows it with one", () => {
    const j = newJob('none', { width: 50, length: 50, thickness: 6 });
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 40, 40) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 2, entry: 'plunge' } as PocketOp);
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't102', shapeIds: ['r'], side: 'outside', depth: 6 } as ProfileOp);
    const tps = generateToolpaths(j);
    const r = postGrbl(j, tps, { toolChange: 'none' });
    expect(r.gcode).toBe(''); expect(r.warnings.join(' ')).toMatch(/cannot run 2 tools/);
    const one = postGrbl(j, tps.filter(t => t.toolId === 't201'), { toolChange: 'none' });
    expect(one.gcode).toContain('M30'); expect(one.gcode).not.toContain('M6');
  });
  it('warns when two tools share a T number and refuses a feed that would round to F0', () => {
    const j = newJob('dup', { width: 50, length: 50, thickness: 6 });
    const a = j.tools.find(t => t.id === 't201')!, b = j.tools.find(t => t.id === 't102')!; b.number = a.number;
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 40, 40) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 2, entry: 'plunge' } as PocketOp);
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't102', shapeIds: ['r'], side: 'outside', depth: 6 } as ProfileOp);
    expect(postGrbl(j, generateToolpaths(j)).warnings.join(' ')).toMatch(/both use T/);
    const tp: Toolpath = { opId: 'x', opName: 'x', toolId: 't201', rpm: 18000, warnings: [], moves: [{ kind: 'rapid', x: 1, y: 1, z: 5 }, { kind: 'plunge', x: 1, y: 1, z: -1, f: 0.3 }] };
    const r = postGrbl(j, [tp]); expect(r.gcode).toBe(''); expect(r.warnings[0]).toMatch(/invalid coordinate or feed/);
  });
  it('never fits an arc from an unknown position', () => {
    // a toolpath that starts cutting a circle straight away (imported paths can): no rapid to establish XY first
    const j = newJob('arc0', { width: 100, length: 100, thickness: 6 });
    const moves: Move[] = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 0.9; moves.push({ kind: 'cut', x: 50 + 10 * Math.cos(a), y: 50 + 10 * Math.sin(a), z: -1, f: 800 }); }
    const g = postGrbl(j, [{ opId: 'x', opName: 'x', toolId: 't201', rpm: 18000, warnings: [], moves }]).gcode;
    expect(g).not.toMatch(/NaN/);
    const first = g.split('\n').find(l => /^G[0123] /.test(l))!;
    expect(first).toMatch(/^G1 X60\.000 Y50\.000/);
  });
  it('supports M0 pause style tool changes', () => {
    const j = newJob('m0', { width: 50, length: 50, thickness: 6 });
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 40, 40) });
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'on', depth: 1 } as ProfileOp);
    const r = postGrbl(j, generateToolpaths(j), { toolChange: 'm0-pause' });
    expect(r.gcode).toContain('\nM0\n'); expect(r.gcode).not.toContain('M6');
  });
});
