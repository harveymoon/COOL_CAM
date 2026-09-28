import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { newJob, rect, circleShape, generateToolpaths, getTool, loadFont, textToPolylines, heightmapToMesh, meshBBox, bbox, signedArea, polygon } from '../src/index.js';
import type { VCarveOp, KeyholeOp, ProfileOp, PocketOp, Tool } from '../src/index.js';
import { postGrbl } from '../../post/src/index.js';

const ARIAL = '/System/Library/Fonts/Supplemental/Arial.ttf';

describe('v-carve', () => {
  it('cuts deeper where the region is wider, with walls on the outline', () => {
    const j = newJob('v', { width: 100, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 10) }); // 10 mm wide strip → centre line 5 mm from each edge
    const op: VCarveOp = { id: 'v', type: 'vcarve', toolId: 't301', shapeIds: ['r'], depth: 0, stepover: 0.4 }; // 90° V, no cap
    j.ops.push(op);
    const [tp] = generateToolpaths(j);
    expect(tp.warnings).toEqual([]);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    const deepest = Math.min(...cuts.map(m => m.z));
    expect(deepest).toBeGreaterThan(-5.2); expect(deepest).toBeLessThan(-4.4); // ≈ half width / tan(45°)
    // every cut point: depth ≈ distance to nearest edge / tan(45°) (walls exactly on the outline)
    for (const m of cuts) { const d = Math.min(m.x - 10, 50 - m.x, m.y - 10, 20 - m.y); expect(Math.abs(-m.z - Math.max(0, d))).toBeLessThan(0.45); }
  });
  it('caps depth and clears the middle flat with a second tool', () => {
    const j = newJob('v2', { width: 100, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 20) });
    j.ops.push({ id: 'v', type: 'vcarve', toolId: 't301', shapeIds: ['r'], depth: 3, flatToolId: 't102' } as VCarveOp);
    const tps = generateToolpaths(j);
    expect(tps).toHaveLength(2); expect(tps[0].toolId).toBe('t102'); expect(tps[0].opName).toContain('flat');
    expect(Math.min(...tps[0].moves.filter(m => m.kind === 'cut').map(m => m.z))).toBeCloseTo(-3, 3);
    expect(Math.min(...tps[1].moves.filter(m => m.kind === 'cut').map(m => m.z))).toBeGreaterThan(-3.01);
  });
});

describe('keyhole and contour ramp', () => {
  it('keyhole plunges then slides and returns', () => {
    const j = newJob('k', { width: 100, length: 60, thickness: 12 });
    j.tools.push({ id: 'kh', number: 500, name: 'keyhole 9.5', type: 'keyhole', diameter: 9.5, shankDiameter: 4, flutes: 2 } as Tool);
    j.shapes.push({ id: 'p', polyline: circleShape(30, 20, 2) });
    j.ops.push({ id: 'k', type: 'keyhole', toolId: 'kh', shapeIds: ['p'], depth: 8, length: 15, angle: 90 } as KeyholeOp);
    const [tp] = generateToolpaths(j);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    expect(cuts).toHaveLength(2); expect(cuts[0].y).toBeCloseTo(35, 3); expect(cuts[1].y).toBeCloseTo(20, 3); expect(cuts[0].z).toBe(-8);
  });
  it('profile ramp entry descends along the contour instead of plunging', () => {
    const j = newJob('r', { width: 100, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 60, 30) });
    j.ops.push({ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['r'], side: 'outside', depth: 6, depthPerPass: 6, entry: 'ramp', rampAngle: 5 } as ProfileOp);
    const [tp] = generateToolpaths(j);
    const ramps = tp.moves.filter(m => m.kind === 'ramp'); const plunges = tp.moves.filter(m => m.kind === 'plunge');
    expect(ramps.length).toBeGreaterThan(3); expect(plunges).toHaveLength(0);
    // ramp slope ≈ 5°
    const dz = 6.5; const len = ramps.reduce((s, m, i, a) => i ? s + Math.hypot(m.x - a[i - 1].x, m.y - a[i - 1].y) : 0, 0);
    expect(dz / len).toBeGreaterThan(Math.tan((4 * Math.PI) / 180)); expect(dz / len).toBeLessThan(Math.tan((7 * Math.PI) / 180));
  });
});

describe('rest machining', () => {
  it('small tool only cuts the corners the big tool missed', () => {
    const j = newJob('rest', { width: 100, length: 60, thickness: 12 });
    j.shapes.push({ id: 'r', polyline: rect(10, 10, 40, 30) });
    j.ops.push({ id: 'big', type: 'pocket', toolId: 't201', shapeIds: ['r'], depth: 4 } as PocketOp);
    j.ops.push({ id: 'small', type: 'pocket', toolId: 't112', shapeIds: ['r'], depth: 4, depthPerPass: 4, restToolId: 't201' } as PocketOp);
    const [big, small] = generateToolpaths(j);
    const len = (tp: typeof big) => tp.moves.filter(m => m.kind === 'cut').reduce((s, m, i, a) => i ? s + Math.hypot(m.x - a[i - 1].x, m.y - a[i - 1].y) : 0, 0);
    expect(len(small)).toBeLessThan(len(big) * 0.7);
    // all small-tool cuts are near a corner
    for (const m of small.moves.filter(m => m.kind === 'cut')) { const dx = Math.min(m.x - 10, 50 - m.x), dy = Math.min(m.y - 10, 40 - m.y); expect(Math.max(dx, dy)).toBeLessThan(8); }
  });
});

describe('text and heightmap', () => {
  it.skipIf(!fs.existsSync(ARIAL))('outlines text with holes', () => {
    const font = loadFont('arial', fs.readFileSync(ARIAL).buffer.slice(0));
    const loops = textToPolylines(font, { text: 'Bo', size: 20, x: 10, y: 10, align: 'left' });
    expect(loops.length).toBe(5); // B outer + 2 holes, o outer + 1 hole
    const holes = loops.filter(l => signedArea(l) < 0);
    void holes;
    const bb = bbox(loops); expect(bb.minY).toBeGreaterThan(9.5); expect(bb.maxY - bb.minY).toBeGreaterThan(12); expect(bb.minX).toBeGreaterThan(9);
    const centered = textToPolylines(font, { text: 'Bo', size: 20, x: 50, y: 10, align: 'center' }); const cb = bbox(centered); expect((cb.minX + cb.maxX) / 2).toBeCloseTo(50, 0);
  });
  it('builds a solid relief mesh from a gradient image', () => {
    const w = 32, h = 16; const data = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x / (w - 1);
    const mesh = heightmapToMesh({ width: w, height: h, data }, { width: 64, depth: 5, columns: 32, base: 1 });
    const bb = meshBBox(mesh);
    expect(bb.max[0]).toBeCloseTo(64, 3); expect(bb.max[1]).toBeCloseTo(32, 1); expect(bb.min[2]).toBe(0); expect(bb.max[2]).toBeCloseTo(6, 3);
    expect(mesh.positions.length % 9).toBe(0);
  });
});

describe('arc output', () => {
  it('emits G2/G3 for a circular profile and keeps endpoints', () => {
    const j = newJob('arc', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 'c', polyline: circleShape(50, 50, 40) });
    j.ops.push({ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['c'], side: 'outside', depth: 2, depthPerPass: 2 } as ProfileOp);
    const tps = generateToolpaths(j);
    const withArcs = postGrbl(j, tps); const noArcs = postGrbl(j, tps, { arcs: false });
    expect(withArcs.arcs).toBeGreaterThan(0); expect(withArcs.lines).toBeLessThan(noArcs.lines / 3);
    const arcLine = withArcs.gcode.split('\n').find(l => l.startsWith('G2') || l.startsWith('G3'))!;
    expect(arcLine).toMatch(/I-?\d+\.\d+ J-?\d+\.\d+/);
    // radius implied by I/J must match the offset circle radius (20 + 3.175)
    const m = /X([-\d.]+) Y([-\d.]+) I([-\d.]+) J([-\d.]+)/.exec(arcLine)!;
    const prevLine = withArcs.gcode.split('\n').slice(0, withArcs.gcode.split('\n').indexOf(arcLine)).reverse().find(l => /X[-\d.]+ Y[-\d.]+/.test(l))!;
    const pm = /X([-\d.]+) Y([-\d.]+)/.exec(prevLine)!;
    const r = Math.hypot(parseFloat(m[3]), parseFloat(m[4])); expect(r).toBeCloseTo(23.175, 1);
    const cx = parseFloat(pm[1]) + parseFloat(m[3]), cy = parseFloat(pm[2]) + parseFloat(m[4]);
    expect(Math.hypot(parseFloat(m[1]) - cx, parseFloat(m[2]) - cy)).toBeCloseTo(23.175, 1);
  });
  it('does not fit arcs on straight or non-circular runs', () => {
    const j = newJob('sq', { width: 100, length: 100, thickness: 12 });
    j.shapes.push({ id: 's', polyline: polygon([{ x: 10, y: 10 }, { x: 60, y: 12 }, { x: 55, y: 50 }, { x: 12, y: 45 }]) });
    j.ops.push({ id: 'p', type: 'profile', toolId: 't201', shapeIds: ['s'], side: 'on', depth: 1 } as ProfileOp);
    const r = postGrbl(j, generateToolpaths(j)); expect(r.arcs).toBe(0);
  });
});
