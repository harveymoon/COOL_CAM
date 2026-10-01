import { describe, it, expect } from 'vitest';
import { newJob, generateToolpaths, parsePathsJson, parseDxf3D, parseDxf, toBinaryStl, parseStl, placementFor, rect, stockBounds } from '../src/index.js';
import type { TraceOp, Model, ProfileOp } from '../src/index.js';

/** A flat box model: w × d footprint, h tall, top at the stock top. */
function boxModel(job: ReturnType<typeof newJob>, w: number, d: number, h: number): Model {
  const v = (x: number, y: number, z: number) => [x, y, z] as const;
  const tri: number[] = [];
  const quad = (a: readonly number[], b: readonly number[], c: readonly number[], d2: readonly number[]) => tri.push(...a, ...b, ...c, ...a, ...c, ...d2);
  const p = [v(0, 0, 0), v(w, 0, 0), v(w, d, 0), v(0, d, 0), v(0, 0, h), v(w, 0, h), v(w, d, h), v(0, d, h)];
  quad(p[4], p[5], p[6], p[7]); quad(p[0], p[3], p[2], p[1]); quad(p[0], p[1], p[5], p[4]); quad(p[1], p[2], p[6], p[5]); quad(p[2], p[3], p[7], p[6]); quad(p[3], p[0], p[4], p[7]);
  const positions = new Float32Array(tri);
  const mesh = parseStl(toBinaryStl({ positions }));
  const sb = stockBounds(job.stock);
  const model = { id: 'box', name: 'box', positions: mesh.positions, placement: { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1 } } as unknown as Model;
  model.placement = placementFor(model, { minX: sb.x0 + 10, minY: sb.y0 + 10, top: sb.top });
  return model;
}

describe('trace operation', () => {
  it('tip mode follows the points, plunges in and retracts out of every path', () => {
    const j = newJob('t', { width: 100, length: 100, thickness: 10 });
    j.paths = [{ id: 'a', points: [[10, 10, -1], [50, 10, -1], [50, 40, -2]] }, { id: 'b', points: [[60, 60, -0.5], [80, 60, -0.5]] }];
    j.ops = [{ id: 'tr', type: 'trace', toolId: 't102', shapeIds: [], pathIds: ['a', 'b'], mode: 'tip', depth: 2, stepdown: 1 } as TraceOp];
    const [tp] = generateToolpaths(j);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    expect(cuts.map(m => [m.x, m.y, m.z])).toEqual([[50, 10, -1], [50, 40, -2], [80, 60, -0.5]]);
    expect(tp.moves.filter(m => m.kind === 'plunge').length).toBe(2);
    expect(tp.moves.filter(m => m.kind === 'retract').length).toBe(2);
    expect(tp.stepdown).toBe(1);
    expect(tp.warnings.filter(w => /Generation failed/.test(w))).toEqual([]);
  });
  it('floors Z at the stock bottom minus the spoilboard allowance and says so', () => {
    const j = newJob('t', { width: 100, length: 100, thickness: 5 });
    j.paths = [{ id: 'a', points: [[10, 10, -6], [50, 10, -6]] }];
    j.ops = [{ id: 'tr', type: 'trace', toolId: 't102', shapeIds: [], pathIds: ['a'], mode: 'tip', depth: 6 } as TraceOp];
    let [tp] = generateToolpaths(j);
    expect(Math.min(...tp.moves.filter(m => m.kind === 'cut').map(m => m.z))).toBeCloseTo(-5, 6);
    expect(tp.warnings.some(w => /raised to it/.test(w))).toBe(true);
    j.stock.spoilboard = 1.5;
    [tp] = generateToolpaths(j);
    expect(Math.min(...tp.moves.filter(m => m.kind === 'cut').map(m => m.z))).toBeCloseTo(-6, 6);
    expect(tp.warnings.some(w => /raised to it/.test(w))).toBe(false);
  });
  it('project mode takes Z from the model surface: on the box top, off the box down to the base', () => {
    const j = newJob('t', { width: 100, length: 100, thickness: 10 });
    j.models = [boxModel(j, 30, 30, 6)];
    // a path given at a wrong (too deep) Z across the box top: projection must lift it to the top; past the box it may drop to the base
    j.paths = [{ id: 'a', points: [[15, 25, -3], [35, 25, -3]] }];
    j.ops = [{ id: 'tr', type: 'trace', toolId: 't102', shapeIds: [], pathIds: ['a'], mode: 'project', modelId: 'box', depth: 10, resolution: 0.2 } as TraceOp];
    const [tp] = generateToolpaths(j);
    const cuts = tp.moves.filter(m => m.kind === 'cut');
    expect(cuts.length).toBeGreaterThan(10);
    const onTop = cuts.filter(m => m.x < 36);
    expect(Math.min(...onTop.map(m => m.z))).toBeGreaterThan(-0.05);
    expect(tp.warnings.some(w => /Projected onto box/.test(w))).toBe(true);
  });
});

describe('path and 3D DXF import', () => {
  it('reads a generator JSON (object with paths, inch units) and a bare array', () => {
    const obj = parsePathsJson(JSON.stringify({ units: 'inch', paths: [{ id: 7, tool: 'B125', op: 'bevel', points: [[1, 0, 0.5], [2, 0, 0.5]] }] }), { prefix: 'c' });
    expect(obj[0]).toMatchObject({ id: 'c_7', tool: 'B125', layer: 'bevel' });
    expect(obj[0].points[1]).toEqual([50.8, 0, 12.7]);
    expect(parsePathsJson('[{"points":[[0,0,0],[1,1,-1]]}]')[0].id).toBe('path_1');
    expect(() => parsePathsJson('{"nope":1}')).toThrow();
  });
  it('reads 3D POLYLINEs with their layers and keeps layers on 2D shapes', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'POLYLINE', '8', '5_B125_BEVEL', '70', '0', '0', 'VERTEX', '8', '5_B125_BEVEL', '10', '1', '20', '2', '30', '-0.5', '0', 'VERTEX', '8', '5_B125_BEVEL', '10', '3', '20', '2', '30', '-1', '0', 'SEQEND',
      '0', 'LINE', '8', 'REF_OUTLINE', '10', '0', '20', '0', '30', '0', '11', '10', '21', '0', '31', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const p3 = parseDxf3D(dxf);
    expect(p3.length).toBe(2);
    expect(p3[0]).toMatchObject({ layer: '5_B125_BEVEL', points: [[1, 2, -0.5], [3, 2, -1]] });
    const p2 = parseDxf(dxf);
    expect(p2.map(p => p.layer).sort()).toEqual(['5_B125_BEVEL', 'REF_OUTLINE']);
  });
});

describe('reference shapes and spoilboard allowance', () => {
  it('skips reference shapes in operations with a warning', () => {
    const j = newJob('r', { width: 100, length: 100, thickness: 10 });
    j.shapes = [{ id: 'cut', polyline: rect(10, 10, 30, 30) }, { id: 'ref', polyline: rect(5, 5, 90, 90), reference: true }];
    j.ops = [{ id: 'p', type: 'profile', toolId: 't102', shapeIds: ['cut', 'ref'], side: 'outside', depth: 3 } as ProfileOp];
    const [tp] = generateToolpaths(j);
    expect(tp.warnings.some(w => /Reference shape\(s\) ref were skipped/.test(w))).toBe(true);
    expect(Math.max(...tp.moves.map(m => m.x))).toBeLessThan(50);
  });
  it('lets a profile cut into the allowance without the wasteboard warning', () => {
    const j = newJob('r', { width: 100, length: 100, thickness: 5, spoilboard: 1 } as never);
    j.shapes = [{ id: 'cut', polyline: rect(10, 10, 30, 30) }];
    j.ops = [{ id: 'p', type: 'profile', toolId: 't102', shapeIds: ['cut'], side: 'outside', depth: 5.5 } as ProfileOp];
    const [tp] = generateToolpaths(j);
    expect(tp.warnings.some(w => /wasteboard/.test(w))).toBe(false);
    j.ops[0].depth = 6.5;
    expect(generateToolpaths(j)[0].warnings.some(w => /spoilboard allowance/.test(w))).toBe(true);
  });
});

describe('trace verification against the mesh', () => {
  it('reports tangency for a ball riding exactly on the box top and a gouge when the path is too deep', () => {
    const j = newJob('v', { width: 100, length: 100, thickness: 10 });
    j.models = [boxModel(j, 30, 30, 6)];
    j.tools.push({ id: 'ball', number: 90, name: 'ball 6', type: 'ballnose', diameter: 6, flutes: 2, fluteLength: 20, rpm: 18000, feed: 1000, plunge: 300 });
    j.paths = [{ id: 'top', points: [[15, 25, 0], [35, 25, 0]] }];
    j.ops = [{ id: 'tr', type: 'trace', toolId: 'ball', shapeIds: [], pathIds: ['top'], mode: 'tip', modelId: 'box', depth: 1 } as TraceOp];
    let [tp] = generateToolpaths(j);
    expect(tp.warnings.some(w => /Verified against box/.test(w) && /0\.000 mm/.test(w))).toBe(true);
    j.paths[0].points = [[15, 25, -0.3], [35, 25, -0.3]];
    [tp] = generateToolpaths(j);
    expect(tp.warnings.some(w => /GOUGE/.test(w) && /0\.300 mm/.test(w))).toBe(true);
  });
});
