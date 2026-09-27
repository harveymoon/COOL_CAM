import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { rect, parseStl, toBinaryStl, meshBBox, meshHeightmap, offsetSurface, contoursBelow, placementFor, placedMesh, newJob, generateToolpaths, sampleHeightmap, toolProfile, getTool, signedArea, normalize, IDENTITY_PLACEMENT } from '../src/index.js';
import type { Model, Rough3DOp, Finish3DOp } from '../src/index.js';

const stlDir = path.resolve(__dirname, '../../../examples/stl');
const box = (w: number, d: number, h: number): Float32Array => {
  // 12 triangles, outward winding not required for heightmaps
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const f = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
  return Float32Array.from(f.flatMap(t => t.flatMap(i => v[i])));
};

describe('stl', () => {
  it('round-trips binary STL', () => {
    const m = { positions: box(10, 20, 5) };
    const back = parseStl(toBinaryStl(m));
    expect(back.positions.length).toBe(m.positions.length);
    expect(meshBBox(back)).toEqual({ min: [0, 0, 0], max: [10, 20, 5] });
  });
  it('parses ASCII STL', () => {
    const txt = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
    expect(parseStl(txt).positions.length).toBe(9);
  });
  it('loads the generated test models', () => {
    for (const f of ['dome-cap-2in-12mm.stl', 'star-coaster-70mm-12mm.stl']) {
      const bb = meshBBox(parseStl(fs.readFileSync(path.join(stlDir, f))));
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(12, 1);
    }
  });
});

describe('heightmap and offset', () => {
  it('rasterises a box and offsets it by the tool radius', () => {
    const hm = meshHeightmap({ positions: box(20, 20, 8) }, 0.5, { x0: -10, y0: -10, x1: 30, y1: 30 }, 0);
    expect(sampleHeightmap(hm, 10, 10)).toBeCloseTo(8, 3);
    expect(sampleHeightmap(hm, -5, -5)).toBeCloseTo(0, 3);
    const tool = { id: 't', number: 1, name: 'flat', type: 'endmill' as const, diameter: 6, flutes: 2 };
    const off = offsetSurface(hm, tool, 0);
    expect(sampleHeightmap(off, 22.5, 10)).toBeCloseTo(8, 3); // within 3 mm of the wall the tool sits on top
    expect(sampleHeightmap(off, 24, 10)).toBeCloseTo(0, 3);
    const ball = { ...tool, type: 'ballnose' as const };
    expect(toolProfile(ball, 3)).toBeCloseTo(3, 6); expect(toolProfile(ball, 0)).toBe(0);
  });
  it('contours below a level give an outer region with a hole around a bump', () => {
    const w = 41, h = 41, z = new Float32Array(w * h).fill(-12);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const d = Math.hypot(i - 20, j - 20); if (d < 10) z[j * w + i] = -d; }
    const loops = contoursBelow({ w, h, res: 1, x0: 0, y0: 0, z, floor: -12 }, -3, { i0: 2, j0: 2, i1: 38, j1: 38 });
    const region = normalize(loops);
    expect(region.length).toBe(2);
    const outer = region.find(l => signedArea(l) > 0)!, hole = region.find(l => signedArea(l) < 0)!;
    expect(signedArea(outer)).toBeCloseTo(36 * 36, -1);
    expect(Math.abs(signedArea(hole))).toBeGreaterThan(20); expect(Math.abs(signedArea(hole))).toBeLessThan(40);
  });
});

describe('3D ops', () => {
  const setup = () => {
    const mesh = parseStl(fs.readFileSync(path.join(stlDir, 'dome-cap-2in-12mm.stl')));
    const job = newJob('dome', { width: 90, length: 90, thickness: 13 });
    const model: Model = { id: 'm1', positions: Array.from(mesh.positions), placement: { ...IDENTITY_PLACEMENT } };
    model.placement = placementFor(model, { centerX: 45, centerY: 45, top: 0 });
    job.models = [model];
    return { job, model };
  };
  const gougeCheck = (job: ReturnType<typeof setup>['job'], model: Model, tp: ReturnType<typeof generateToolpaths>[number]) => {
    const bb = meshBBox(placedMesh(model));
    const hm = meshHeightmap(placedMesh(model), 0.1, { x0: bb.min[0] - 5, y0: bb.min[1] - 5, x1: bb.max[0] + 5, y1: bb.max[1] + 5 }, bb.min[2]);
    const tool = getTool(job, tp.toolId); const r = tool.diameter / 2; let worst = Infinity;
    for (const m of tp.moves) {
      if (m.kind === 'rapid' || m.kind === 'retract') continue;
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) worst = Math.min(worst, m.z + toolProfile(tool, Math.hypot(dx, dy)) - sampleHeightmap(hm, m.x + dx, m.y + dy));
    }
    return worst;
  };
  it('roughs in layers without gouging and leaves stock', () => {
    const { job, model } = setup();
    const op: Rough3DOp = { id: 'r', type: 'rough3d', toolId: 't201', modelId: 'm1', shapeIds: [], depth: 12.5, depthPerPass: 3, stepover: 3, stockToLeave: 0.3, containment: 'outside', boundary: 6 };
    job.ops = [op];
    const [tp] = generateToolpaths(job);
    expect(tp.moves.length).toBeGreaterThan(200);
    const zs = new Set(tp.moves.filter(m => m.kind === 'cut').map(m => Math.round(m.z * 100) / 100));
    expect(zs.has(-3)).toBe(true); expect(zs.has(-11.7)).toBe(true);
    expect(gougeCheck(job, model, tp)).toBeGreaterThan(0.25);
  });
  it('finishes the surface with a ball nose without gouging', () => {
    const { job, model } = setup();
    const op: Finish3DOp = { id: 'f', type: 'finish3d', toolId: 't101', modelId: 'm1', shapeIds: [], depth: 12.5, stepover: 0.8, axis: 'y' };
    job.ops = [op];
    const [tp] = generateToolpaths(job);
    expect(tp.moves.length).toBeGreaterThan(1000);
    expect(gougeCheck(job, model, tp)).toBeGreaterThan(-0.05);
    const apex = tp.moves.filter(m => m.kind === 'cut' && Math.hypot(m.x - 45, m.y - 45) < 0.6);
    expect(Math.min(...apex.map(m => m.z))).toBeGreaterThan(-0.2); // touches the top of the dome
  });
});

describe('feature extraction', () => {
  const bracket = () => {
    const mesh = parseStl(fs.readFileSync(path.join(stlDir, 'bracket-2p5d-12mm.stl')));
    const job = newJob('bracket', { width: 90, length: 70, thickness: 13 }); job.material = 'hardwood';
    const model: Model = { id: 'part', positions: Array.from(mesh.positions), placement: { ...IDENTITY_PLACEMENT } };
    model.placement = placementFor(model, { centerX: 45, centerY: 35, top: 0 }); job.models = [model];
    return { job, model };
  };
  it('finds the planar levels and holes of the bracket', async () => {
    const { extractFeatures } = await import('../src/index.js');
    const { model } = bracket();
    const f = extractFeatures(placedMesh(model));
    expect(f.levels.map(l => l.z)).toEqual([0, -3, -5, -6]);
    expect(f.levels[1].area).toBeCloseTo(Math.PI * 25, -1);
    expect(f.circles.filter(c => c.through).map(c => c.diameter)).toEqual([6.5, 6.5]);
    expect(f.circles.find(c => !c.through)?.diameter).toBe(10);
    expect(f.curvedArea).toBe(0);
  });
  it('ignores tessellation facets on a dome', async () => {
    const { extractFeatures } = await import('../src/index.js');
    const mesh = parseStl(fs.readFileSync(path.join(stlDir, 'dome-cap-2in-12mm.stl')));
    const f = extractFeatures(mesh);
    expect(f.levels.filter(l => l.z > -1)).toHaveLength(0);
    expect(f.curvedArea).toBeGreaterThan(f.footprintArea);
  });
  it('proposes pockets that reach the bracket floors without cutting into the part', async () => {
    const { proposeOperations } = await import('../src/index.js');
    const { simulate } = await import('../../sim/src/index.js');
    const { job, model } = bracket();
    const p = proposeOperations(job, { modelId: 'part' });
    expect(p.ops.filter(o => o.type === 'pocket').length).toBeGreaterThanOrEqual(4);
    expect(p.ops.filter(o => o.name?.startsWith('Bore') || o.type === 'drill')).toHaveLength(2);
    job.shapes.push(...p.shapes); job.ops.push(...p.ops);
    const tps = generateToolpaths(job);
    const sim = simulate(job, tps, { resolution: 0.25 });
    expect(sim.events.filter(e => e.severity === 'error')).toEqual([]);
    // compare the simulated surface with the model: never below the model, and on the floors within 0.1 mm
    const bb = meshBBox(placedMesh(model));
    const hm = meshHeightmap(placedMesh(model), 0.25, { x0: bb.min[0], y0: bb.min[1], x1: bb.max[0], y1: bb.max[1] }, bb.min[2]);
    const simAt = (x: number, y: number) => { const i = Math.round((x - (-0)) / sim.cells.res); void i; return 0; };
    void simAt;
    // floor probes in model-local coordinates (see examples/gen-bracket-stl.mjs)
    const probes: [number, number, number][] = [[20, 20, -5], [53, 20, -6], [20, 34, -3], [15, 5, 0], [40, 8, -13]];
    const { StockSim } = await import('../../sim/src/index.js');
    const s = new StockSim(job, tps, { resolution: 0.25, keyframeEvery: 0 }); s.runAll();
    for (const [lx, ly, expected] of probes) {
      const x = bb.min[0] + lx, y = bb.min[1] + ly;
      const i = Math.round((x - s.x0) / s.res), j = Math.round((y - s.y0) / s.res);
      const z = s.heights[j * s.w + i];
      if (expected === -13) expect(z).toBeLessThan(-11.9); // through hole: drilled or bored to the base at least
      else expect(Math.abs(z - expected)).toBeLessThan(0.15);
    }
    // no gouge anywhere inside the footprint: sim height >= (model height eroded by one cell, to forgive wall-edge sampling) - tolerance
    let worst = Infinity;
    for (let j = 1; j < hm.h - 1; j++) for (let i = 1; i < hm.w - 1; i++) {
      const x = hm.x0 + i * hm.res, y = hm.y0 + j * hm.res;
      let zm = Infinity; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) zm = Math.min(zm, hm.z[(j + dj) * hm.w + i + di]);
      const si = Math.round((x - s.x0) / s.res), sj = Math.round((y - s.y0) / s.res); if (si < 0 || sj < 0 || si >= s.w || sj >= s.h) continue;
      worst = Math.min(worst, s.heights[sj * s.w + si] - zm);
    }
    expect(worst).toBeGreaterThan(-0.3);
  });
});

describe('machining boundary', () => {
  const coaster = () => {
    const mesh = parseStl(fs.readFileSync(path.join(stlDir, 'star-coaster-70mm-12mm.stl')));
    const job = newJob('coaster', { width: 95, length: 95, thickness: 13 });
    const model: Model = { id: 'c', positions: Array.from(mesh.positions), placement: { ...IDENTITY_PLACEMENT } };
    model.placement = placementFor(model, { centerX: 47.5, centerY: 47.5, top: 0 }); job.models = [model];
    return job;
  };
  const maxRadius = (tp: ReturnType<typeof generateToolpaths>[number]) => Math.max(...tp.moves.filter(m => m.kind !== 'rapid' && m.kind !== 'retract').map(m => Math.hypot(m.x - 47.5, m.y - 47.5)));
  it('silhouette + inside keeps the tool within the disc, so only the star gets cut', () => {
    const job = coaster();
    job.ops = [
      { id: 'r', type: 'rough3d', toolId: 't102', modelId: 'c', shapeIds: [], depth: 12, depthPerPass: 2, stepover: 1.2, stockToLeave: 0.2 } as Rough3DOp,
      { id: 'f', type: 'finish3d', toolId: 't101', modelId: 'c', shapeIds: [], depth: 12, stepover: 0.8 } as Finish3DOp,
    ];
    const [r, f] = generateToolpaths(job);
    expect(r.moves.length).toBeGreaterThan(50); expect(f.moves.length).toBeGreaterThan(500);
    expect(maxRadius(r)).toBeLessThan(35 - 1.5875 + 0.05);
    expect(maxRadius(f)).toBeLessThan(35 - 1.5875 + 0.05);
    // roughing stays inside the star recess: nothing cut deeper than the recess anywhere, and nothing cut on the flat top
    expect(Math.min(...r.moves.filter(m => m.kind === 'cut').map(m => m.z))).toBeGreaterThan(-6.1);
  });
  it('silhouette + outside with an offset clears a moat around the disc', () => {
    const job = coaster();
    job.ops = [{ id: 'r', type: 'rough3d', toolId: 't201', modelId: 'c', shapeIds: [], depth: 12, depthPerPass: 4, stepover: 3, containment: 'outside', boundary: 6 } as Rough3DOp];
    const [r] = generateToolpaths(job);
    expect(maxRadius(r)).toBeGreaterThan(35 + 3); expect(maxRadius(r)).toBeLessThan(35 + 6 + 3.175 + 0.5);
  });
  it('shapes boundary restricts finishing to a drawn region', () => {
    const job = coaster();
    job.shapes.push({ id: 'win', polyline: rect(47.5 - 12, 47.5 - 12, 24, 24) });
    job.ops = [{ id: 'f', type: 'finish3d', toolId: 't101', modelId: 'c', shapeIds: ['win'], depth: 12, stepover: 1, boundaryMode: 'shapes', containment: 'center' } as Finish3DOp];
    const [f] = generateToolpaths(job);
    const cuts = f.moves.filter(m => m.kind !== 'rapid' && m.kind !== 'retract');
    expect(cuts.length).toBeGreaterThan(100);
    for (const m of cuts) { expect(m.x).toBeGreaterThan(47.5 - 12 - 0.3); expect(m.x).toBeLessThan(47.5 + 12 + 0.3); expect(m.y).toBeGreaterThan(47.5 - 12 - 0.3); expect(m.y).toBeLessThan(47.5 + 12 + 0.3); }
  });
});
