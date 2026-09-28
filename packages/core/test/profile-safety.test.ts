import { describe, it, expect } from 'vitest';
import { newJob, rect, circleShape, generateToolpaths, profileTabCenters, rotateLoopAt, perimeter } from '../src/index.js';
import type { ProfileOp, Job, Toolpath } from '../src/index.js';
import { StockSim } from '../../sim/src/index.js';

const heightsAt = (job: Job, tp: Toolpath, res = 0.2) => { const s = new StockSim(job, [tp], { resolution: res, keyframeEvery: 0 }); s.runAll(); return s; };

describe('profile ramp entry', () => {
  it('continues each pass from where the previous ramp ended and never cuts inside the offset contour', () => {
    const j = newJob('ramp', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 'c', polyline: circleShape(50, 50, 40) });
    j.ops.push({ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['c'], side: 'outside', depth: 12, depthPerPass: 4, entry: 'ramp', rampAngle: 5 } as ProfileOp);
    const [tp] = generateToolpaths(j);
    const R = 20 + 3.175; let worst = 0;
    tp.moves.forEach((m, i) => {
      if (i === 0 || m.kind === 'rapid' || m.kind === 'retract') return;
      const p = tp.moves[i - 1];
      for (let t = 0; t <= 1; t += 0.05) worst = Math.max(worst, R - Math.hypot(p.x + (m.x - p.x) * t - 50, p.y + (m.y - p.y) * t - 50));
    });
    expect(worst).toBeLessThan(0.05); // every feed move stays on the offset circle
    expect(tp.moves.filter(m => m.kind === 'ramp').length).toBeGreaterThan(3);
    expect(tp.moves.filter(m => m.kind === 'plunge')).toHaveLength(0);
    const s = heightsAt(j, tp, 0.25);
    let minInside = 0;
    for (let jj = 0; jj < s.h; jj++) for (let i = 0; i < s.w; i++) { const x = s.x0 + i * s.res, y = s.y0 + jj * s.res; if (Math.hypot(x - 50, y - 50) < 19.5) minInside = Math.min(minInside, s.heights[jj * s.w + i]); }
    expect(minInside).toBe(0); // the part itself is untouched
  });
  it('ramps on a rectangle without a vertical feed-rate drop between passes', () => {
    const j = newJob('r', { width: 100, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 60, 30) });
    j.ops.push({ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 9, depthPerPass: 3, entry: 'ramp', rampAngle: 5 } as ProfileOp);
    const [tp] = generateToolpaths(j);
    tp.moves.forEach((m, i) => { if (m.kind !== 'ramp' || i === 0) return; const p = tp.moves[i - 1]; const dxy = Math.hypot(m.x - p.x, m.y - p.y), dz = p.z - m.z; if (dz > 1e-6) expect(dz / Math.max(dxy, 1e-9)).toBeLessThan(Math.tan((8 * Math.PI) / 180)); });
  });
});

describe('profile tabs', () => {
  it('keeps a tab that straddles the loop seam', () => {
    const j = newJob('seam', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 40) });
    // the loop starts at the vertex nearest the origin (the 10,10 corner); a manual tab right there used to be plunged through
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 12, depthPerPass: 6, tabs: { mode: 'manual', count: 0, width: 8, height: 3, points: [{ x: 10, y: 10 }, { x: 50, y: 50 }] } } as ProfileOp);
    const [tp] = generateToolpaths(j);
    const s = heightsAt(j, tp, 0.25);
    const probe = (x: number, y: number) => s.heights[Math.round((y - s.y0) / s.res) * s.w + Math.round((x - s.x0) / s.res)];
    expect(probe(10 - 2.25, 10 - 2.25)).toBeCloseTo(-9, 1);
    expect(probe(50 + 2.25, 50 + 2.25)).toBeCloseTo(-9, 1);
    expect(probe(30, 10 - 3.175)).toBeCloseTo(-12, 1); // between tabs the kerf is through
  });
  it('shows tab markers exactly where the tabs are left, for auto tabs, with and without ramp entry', () => {
    for (const entry of ['plunge', 'ramp'] as const) {
      const j = newJob('markers', { width: 120, length: 80, thickness: 12 });
      j.shapes.push({ id: 'r', polyline: rect(10, 10, 60, 30, 5) });
      const op: ProfileOp = { id: 'p', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 11, depthPerPass: 3, entry, rampAngle: 5, tabs: { count: 3, width: 8, height: 4 } };
      j.ops.push(op);
      const [tp] = generateToolpaths(j);
      const s = heightsAt(j, tp, 0.2);
      const centers = profileTabCenters(j, op);
      expect(centers).toHaveLength(3);
      for (const c of centers) expect(s.heights[Math.round((c.y - s.y0) / s.res) * s.w + Math.round((c.x - s.x0) / s.res)]).toBeCloseTo(-7, 1);
      // and nothing else along the kerf is left above the floor except the three tabs (≈ (8 + 6.35) mm each of ~215 mm)
      let raised = 0, total = 0; const r = 3.175;
      for (let jj = 0; jj < s.h; jj++) for (let i = 0; i < s.w; i++) {
        const x = s.x0 + i * s.res, y = s.y0 + jj * s.res;
        const dx = Math.max(10 + 5 - x, 0, x - (70 - 5)), dy = Math.max(10 + 5 - y, 0, y - (40 - 5));
        const d = Math.hypot(dx, dy) - 5; if (Math.abs(d - r) > 0.25) continue; total++; if (s.heights[jj * s.w + i] > -10.9) raised++;
      }
      expect(raised / total).toBeGreaterThan(0.07); expect(raised / total).toBeLessThan(0.16); // 3 tabs ≈ 0.12; a 4th would push it past 0.16
    }
  });
});

describe('rotateLoopAt', () => {
  it('starts the loop at the requested arc length and keeps its perimeter', () => {
    const loop = rect(0, 0, 10, 4);
    const r = rotateLoopAt(loop, 12); // 10 along the bottom + 2 up the right side
    expect(r.points[0]).toEqual({ x: 10, y: 2 });
    expect(r.points).toHaveLength(5);
    expect(perimeter(r)).toBeCloseTo(28, 9);
    expect(rotateLoopAt(loop, 0)).toBe(loop);
    expect(rotateLoopAt(loop, 10).points[0]).toEqual({ x: 10, y: 0 });
  });
});
