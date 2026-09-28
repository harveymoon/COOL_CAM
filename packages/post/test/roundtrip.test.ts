import { describe, it, expect } from 'vitest';
import { newJob, rect, circleShape, generateToolpaths } from '@cool-cam/core';
import type { Move, ProfileOp, PocketOp, Toolpath } from '@cool-cam/core';
import { postGrbl } from '../src/index.js';
import { fitArcs } from '../src/arcs.js';

/** Minimal G-code interpreter: replays G0/G1/G2/G3 with modal X/Y/Z and expands arcs into short chords. */
function replay(gcode: string): { x: number; y: number; z: number; rapid: boolean }[] {
  const out: { x: number; y: number; z: number; rapid: boolean }[] = [];
  let x = 0, y = 0, z = 0;
  for (const raw of gcode.split('\n')) {
    const line = raw.replace(/\(.*?\)/g, '').trim();
    const m = /^G([0123])\b/.exec(line); if (!m) { if (/^G53/.test(line)) z = NaN; continue; }
    const word = (k: string) => { const r = new RegExp(`${k}(-?\\d+\\.?\\d*)`).exec(line); return r ? parseFloat(r[1]) : undefined; };
    const nx = word('X') ?? x, ny = word('Y') ?? y, nz = word('Z') ?? z;
    const g = m[1];
    if (g === '2' || g === '3') {
      const cx = x + (word('I') ?? 0), cy = y + (word('J') ?? 0); const r = Math.hypot(x - cx, y - cy);
      let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
      if (g === '2') { while (a1 >= a0) a1 -= 2 * Math.PI; } else { while (a1 <= a0) a1 += 2 * Math.PI; }
      const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / 0.2));
      for (let k = 1; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z: z + ((nz - z) * k) / n, rapid: false }); }
    } else out.push({ x: nx, y: ny, z: nz, rapid: g === '0' });
    x = nx; y = ny; z = nz;
  }
  return out;
}

/** Max distance from each replayed feed point to the polyline of the original cutting moves (XY), plus the max Z error. */
function deviation(tp: Toolpath, pts: ReturnType<typeof replay>) {
  const segs: [Move, Move][] = []; for (let i = 1; i < tp.moves.length; i++) if (tp.moves[i].kind !== 'rapid' && tp.moves[i].kind !== 'retract') segs.push([tp.moves[i - 1], tp.moves[i]]);
  let worstXY = 0, worstZ = 0;
  for (const p of pts) {
    if (p.rapid) continue;
    let best = Infinity, bz = Infinity;
    for (const [a, b] of segs) {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
      const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
      // vertical segments (plunges) share XY with the cuts around them: among equally near segments take the best Z match
      const ze = L2 === 0 ? (p.z >= Math.min(a.z, b.z) - 1e-9 && p.z <= Math.max(a.z, b.z) + 1e-9 ? 0 : Math.min(Math.abs(p.z - a.z), Math.abs(p.z - b.z))) : Math.abs(p.z - (a.z + (b.z - a.z) * t));
      // ties are judged at the post's 3-decimal precision (coordinates are rounded to 0.0005 mm)
      if (d < best - 2e-3 || (Math.abs(d - best) <= 2e-3 && ze < bz)) { best = d; bz = ze; }
    }
    worstXY = Math.max(worstXY, best); worstZ = Math.max(worstZ, bz);
  }
  return { worstXY, worstZ };
}

describe('post round trip', () => {
  it('arc-fitted G-code replays onto the original toolpath within tolerance, including a Z step between passes', () => {
    const j = newJob('rt', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 'c', polyline: circleShape(50, 50, 40) });
    j.shapes.push({ id: 'r', polyline: rect(5, 5, 30, 20, 6) });
    j.ops.push({ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['c'], side: 'outside', depth: 6, depthPerPass: 2, feed: 800, plunge: 800 } as ProfileOp);
    j.ops.push({ id: 'k', type: 'pocket', toolId: 't102', shapeIds: ['r'], depth: 3, entry: 'helix' } as PocketOp);
    const tps = generateToolpaths(j);
    const r = postGrbl(j, tps);
    expect(r.arcs).toBeGreaterThan(0);
    const pts = replay(r.gcode);
    // replay the whole program against the concatenated toolpaths
    const all: Toolpath = { ...tps[0], moves: tps.flatMap(t => t.moves) };
    const { worstXY, worstZ } = deviation(all, pts);
    expect(worstXY).toBeLessThan(0.03);
    expect(worstZ).toBeLessThan(0.002);
    expect(Math.min(...pts.filter(p => !p.rapid).map(p => p.z))).toBeCloseTo(-6, 3);
  });
  it('never fits an arc across a cut that changes Z, and writes Z on an arc if it ever had to', () => {
    const R = 10; const run: Move[] = [];
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 0.9; run.push({ kind: 'cut', x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a), z: -2, f: 1000 }); }
    const start: Move = { kind: 'cut', x: 50 + R * Math.cos(-0.05), y: 50 + R * Math.sin(-0.05), z: -1, f: 1000 };
    const segs = fitArcs(run, start, 0.01);
    expect(segs[0]).toMatchObject({ kind: 'line', m: run[0] });
    expect(segs.some(s => s.kind === 'arc')).toBe(true);
    const j = newJob('z', { width: 100, length: 100, thickness: 12 });
    const tp: Toolpath = { opId: 'x', opName: 'x', toolId: 't201', rpm: 18000, warnings: [], moves: [{ kind: 'rapid', x: start.x, y: start.y, z: 3 }, { kind: 'plunge', x: start.x, y: start.y, z: -1, f: 300 }, ...run] };
    const g = postGrbl(j, [tp]).gcode;
    expect(g).toMatch(/G1 [^\n]*Z-2\.000/);
    const pts = replay(g);
    expect(deviation(tp, pts).worstZ).toBeLessThan(0.002);
  });
  it('traverses at the safe height after every tool change, not at clearance', () => {
    const j = newJob('safe', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(60, 60, 30, 30) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 2, entry: 'plunge' } as PocketOp);
    j.ops.push({ id: 'q', type: 'profile', toolId: 't102', shapeIds: ['r'], side: 'outside', depth: 2 } as ProfileOp);
    const lines = postGrbl(j, generateToolpaths(j)).gcode.split('\n');
    lines.forEach((l, i) => {
      if (!l.startsWith('M6')) return;
      const after = lines.slice(i + 1, i + 8);
      const firstZ = after.find(x => x.startsWith('G0 Z'))!; expect(firstZ).toBe('G0 Z10.000');
      const firstXY = after.findIndex(x => /^G0 X/.test(x)); const zi = after.indexOf(firstZ);
      expect(firstXY).toBeGreaterThan(zi);
    });
  });
});
