import { describe, it, expect } from 'vitest';
import { newJob, rect, circleShape, generateToolpaths, estimate, SHAPEOKO_HDM, feedsAndSpeeds, DEFAULT_TOOLS, signedArea, offsetPolygons, normalize } from '../src/index.js';
import type { Job, ProfileOp, PocketOp, DrillOp } from '../src/index.js';

function job(): Job {
  const j = newJob('t', { width: 120, length: 80, thickness: 12 });
  j.shapes.push({ id: 'outer', polyline: rect(10, 10, 100, 60, 8) });
  j.shapes.push({ id: 'hole', polyline: circleShape(60, 40, 20) });
  j.shapes.push({ id: 'd1', polyline: circleShape(20, 20, 4) });
  return j;
}

describe('ops', () => {
  it('pocket stays inside the region and reaches depth', () => {
    const j = job();
    const op: PocketOp = { id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['outer', 'hole'], depth: 5, depthPerPass: 2.5, entry: 'helix' };
    j.ops.push(op);
    const [tp] = generateToolpaths(j);
    expect(tp.warnings).toEqual([]);
    const cutting = tp.moves.filter(m => m.kind !== 'rapid' && m.kind !== 'retract');
    expect(Math.min(...cutting.map(m => m.z))).toBeCloseTo(-5);
    // tool centre must stay ≥ radius (3.175) inside the rect and ≥ radius away from the hole
    for (const m of cutting) {
      expect(m.x).toBeGreaterThanOrEqual(10 + 3.17 - 0.02); expect(m.x).toBeLessThanOrEqual(110 - 3.17 + 0.02);
      expect(m.y).toBeGreaterThanOrEqual(10 + 3.17 - 0.02); expect(m.y).toBeLessThanOrEqual(70 - 3.17 + 0.02);
      expect(Math.hypot(m.x - 60, m.y - 40)).toBeGreaterThanOrEqual(10 + 3.17 - 0.02);
    }
    expect(tp.moves.some(m => m.kind === 'ramp')).toBe(true);
    expect(estimate(tp, SHAPEOKO_HDM).seconds).toBeGreaterThan(10);
  });
  it('outside profile is offset by the radius and climb runs clockwise', () => {
    const j = job();
    const op: ProfileOp = { id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['outer'], side: 'outside', depth: 12, depthPerPass: 12 };
    j.ops.push(op);
    const [tp] = generateToolpaths(j);
    const cut = tp.moves.filter(m => m.kind === 'cut');
    const xs = cut.map(m => m.x), ys = cut.map(m => m.y);
    expect(Math.min(...xs)).toBeCloseTo(10 - 3.175, 1); expect(Math.max(...xs)).toBeCloseTo(110 + 3.175, 1);
    expect(Math.min(...ys)).toBeCloseTo(10 - 3.175, 1);
    const loop = { points: cut.map(m => ({ x: m.x, y: m.y })), closed: true };
    expect(signedArea(loop)).toBeLessThan(0); // clockwise
  });
  it('tabs lift the cutter on the final pass', () => {
    const j = job();
    j.ops.push({ id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['outer'], side: 'outside', depth: 12, depthPerPass: 6, tabs: { count: 4, width: 8, height: 3 } } as ProfileOp);
    const [tp] = generateToolpaths(j);
    const zs = new Set(tp.moves.filter(m => m.kind === 'cut').map(m => Math.round(m.z * 100) / 100));
    expect(zs.has(-12)).toBe(true); expect(zs.has(-9)).toBe(true); expect(zs.has(-6)).toBe(true);
    const lifts = tp.moves.filter(m => m.kind === 'plunge' && Math.abs(m.z + 12) < 1e-6);
    expect(lifts.length).toBe(4 + 1); // 4 tab exits + initial plunge to -12
  });
  it('drill pecks to depth', () => {
    const j = job();
    j.ops.push({ id: 'd', type: 'drill', toolId: 't102', shapeIds: ['d1'], depth: 12, peck: 5 } as DrillOp);
    const [tp] = generateToolpaths(j);
    const plunges = tp.moves.filter(m => m.kind === 'plunge');
    expect(plunges.map(m => m.z)).toEqual([-5, -10, -12]);
    expect(plunges.every(m => Math.abs(m.x - 20) < 1e-3 && Math.abs(m.y - 20) < 1e-3)).toBe(true);
  });
  it('warns when the tool does not fit', () => {
    const j = job();
    j.shapes.push({ id: 'tiny', polyline: rect(0, 0, 4, 4) });
    j.ops.push({ id: 'p', type: 'pocket', toolId: 't201', shapeIds: ['tiny'], depth: 1 } as PocketOp);
    const [tp] = generateToolpaths(j);
    expect(tp.moves).toHaveLength(0); expect(tp.warnings[0]).toMatch(/does not fit/);
  });
  it('feeds and speeds scale with tool diameter', () => {
    const big = feedsAndSpeeds(DEFAULT_TOOLS[0], 'hardwood'); const small = feedsAndSpeeds(DEFAULT_TOOLS[2], 'hardwood');
    expect(big.feed).toBeGreaterThan(small.feed); expect(big.rpm).toBe(18000); expect(small.depthPerPass).toBeLessThan(big.depthPerPass);
  });
  it('clipper orientation convention holds', () => {
    const r = offsetPolygons(normalize([rect(0, 0, 10, 10)]), -1);
    expect(signedArea(r[0])).toBeGreaterThan(0);
  });
});

describe('manual tabs', () => {
  it('places tabs at the requested points and nowhere else', () => {
    const j = job();
    const op: ProfileOp = { id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['outer'], side: 'outside', depth: 12, depthPerPass: 12, tabs: { mode: 'manual', count: 0, width: 8, height: 3, points: [{ x: 60, y: 10 }, { x: 110, y: 40 }] } };
    j.ops.push(op);
    const [tp] = generateToolpaths(j);
    const lifts = tp.moves.filter(m => m.kind === 'plunge' && Math.abs(m.z + 12) < 1e-6);
    expect(lifts.length).toBe(2 + 1);
    const raised = tp.moves.filter(m => m.kind === 'cut' && Math.abs(m.z + 9) < 1e-6);
    // every raised move must sit near one of the requested points (within tab half-width + radius + tolerance)
    for (const m of raised) expect(Math.min(Math.hypot(m.x - 60, m.y - (10 - 3.175)), Math.hypot(m.x - (110 + 3.175), m.y - 40))).toBeLessThan(8);
  });
  it('reports tab centres for display', async () => {
    const { profileTabCenters } = await import('../src/index.js');
    const j = job();
    const op: ProfileOp = { id: 'pr', type: 'profile', toolId: 't201', shapeIds: ['outer'], side: 'outside', depth: 12, tabs: { count: 4, width: 8, height: 3 } };
    expect(profileTabCenters(j, op)).toHaveLength(4);
    const manual = profileTabCenters(j, { ...op, tabs: { mode: 'manual', count: 0, width: 8, height: 3, points: [{ x: 60, y: 10 }] } });
    expect(manual).toHaveLength(1); expect(manual[0].y).toBeCloseTo(10 - 3.175, 1);
  });
});
