import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { newJob, rect, circleShape, regularPolygon, slot, polygon, generateToolpaths, parseStl, placementFor, IDENTITY_PLACEMENT } from '../src/index.js';
import type { Job, Op, Model } from '../src/index.js';
import { simulate } from '../../sim/src/index.js';
import { postGrbl } from '../../post/src/index.js';

/**
 * Deterministic planner fuzz: random but *valid* jobs (depth within the stock and the flute length, no start depth without a
 * pass above it) must simulate without a single error. Any error here means the planner emitted a move that meets uncut
 * material it assumed was gone, rapids through stock, or cuts below the stock: the class of bug that breaks cutters.
 * The fuzz seeds are fixed so a failure is reproducible; bump COUNT locally for a deeper search.
 */
const COUNT = Number(process.env.PLANNER_FUZZ ?? 24);
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const R = (a: number, b: number) => a + rnd() * (b - a);

function randomJob(): Job {
  const W = Math.round(R(50, 140)), L = Math.round(R(50, 140)), T = pick([6, 9.5, 12, 18]);
  const j = newJob('fuzz', { width: W, length: L, thickness: T, origin: pick(['front-left', 'front-left', 'center']), zOrigin: pick(['top', 'top', 'bottom']) });
  const x0 = j.stock.origin === 'center' ? -W / 2 : 0, y0 = j.stock.origin === 'center' ? -L / 2 : 0;
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const w = R(8, W * 0.6), h = R(8, L * 0.6); const x = x0 + R(2, W - w - 2), y = y0 + R(2, L - h - 2);
    const kind = pick(['rect', 'rrect', 'circle', 'poly', 'slot', 'tri']);
    const pl = kind === 'rect' ? rect(x, y, w, h) : kind === 'rrect' ? rect(x, y, w, h, R(0.5, Math.min(w, h) / 2)) : kind === 'circle' ? circleShape(x + w / 2, y + h / 2, Math.min(w, h))
      : kind === 'poly' ? regularPolygon(x + w / 2, y + h / 2, 3 + Math.floor(rnd() * 6), Math.min(w, h), R(0, 90)) : kind === 'slot' ? slot(x, y + h / 2, x + w, y + h / 2, Math.max(2, Math.min(h, R(2, 12))))
      : polygon([{ x, y }, { x: x + w, y: y + R(0, h) }, { x: x + R(0, w), y: y + h }]);
    j.shapes.push({ id: `s${i}`, polyline: pl });
  }
  const nOps = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < nOps; k++) {
    const type = pick(['pocket', 'pocket', 'profile', 'profile', 'drill', 'vcarve'] as const);
    const sids = j.shapes.filter(() => rnd() < 0.7).map(s => s.id); if (!sids.length) sids.push(j.shapes[0].id);
    const tool = type === 'vcarve' ? pick(j.tools.filter(t => t.type === 'vbit')) : pick(j.tools.filter(t => t.type === 'endmill'));
    const maxDepth = Math.min(T, tool.fluteLength ?? T);
    const depth = +R(0.5, maxDepth).toFixed(2);
    const dpp = rnd() < 0.3 ? undefined : +R(0.3, tool.diameter * 1.5).toFixed(2);
    const base = { id: `o${k}`, toolId: tool.id, shapeIds: sids, depth, depthPerPass: dpp };
    let op: Op;
    if (type === 'pocket') op = { ...base, type, entry: pick(['helix', 'ramp', 'plunge']), stepover: rnd() < 0.4 ? undefined : +R(0.2, tool.diameter * 1.2).toFixed(2), stockToLeave: rnd() < 0.3 ? +R(0, 1).toFixed(2) : undefined, finishPass: rnd() < 0.4, direction: pick(['climb', 'conventional']) };
    else if (type === 'profile') op = { ...base, type, side: pick(['outside', 'inside', 'on']), entry: pick(['plunge', 'ramp']), rampAngle: rnd() < 0.5 ? undefined : R(2, 15), direction: pick(['climb', 'conventional']),
      tabs: rnd() < 0.6 ? (rnd() < 0.5 ? { count: Math.floor(R(0, 8)), width: R(2, 12), height: R(0.5, 5) } : { mode: 'manual', count: 0, width: R(2, 12), height: R(0.5, 5), points: Array.from({ length: Math.floor(R(1, 5)) }, () => { const s = j.shapes.find(x => x.id === sids[0])!; const p = pick(s.polyline.points); return { x: p.x + R(-4, 4), y: p.y + R(-4, 4) }; }) }) : undefined };
    else if (type === 'drill') op = { ...base, type, peck: rnd() < 0.5 ? 0 : +R(0.5, 6).toFixed(2) };
    else op = { ...base, type, depth: rnd() < 0.5 ? 0 : +R(0.5, 6).toFixed(2), stepover: rnd() < 0.5 ? undefined : +R(0.2, 1.5).toFixed(2), flatToolId: rnd() < 0.4 ? pick(j.tools.filter(t => t.type === 'endmill')).id : undefined };
    j.ops.push(op);
  }
  return j;
}

describe('planner fuzz (2.5D)', () => {
  it(`${COUNT} random valid jobs simulate without errors and post cleanly`, () => {
    for (let n = 0; n < COUNT; n++) {
      const s0 = seed; const j = randomJob();
      const tps = generateToolpaths(j);
      const failed = tps.flatMap(t => t.warnings.filter(w => w.startsWith('Generation failed')));
      expect(failed, `job ${n} (seed ${s0})`).toEqual([]);
      const sim = simulate(j, tps, { resolution: 0.3 });
      const errors = sim.events.filter(e => e.severity === 'error');
      expect(errors.map(e => `${e.opId}: ${e.message}`), `job ${n} (seed ${s0}) ${JSON.stringify(j.ops)}`).toEqual([]);
      const post = postGrbl(j, tps);
      expect(post.gcode.length > 0 || tps.every(t => !t.moves.length), `job ${n} (seed ${s0}) post: ${post.warnings.join(' ')}`).toBe(true);
      expect(post.gcode).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe('planner fuzz (3D)', () => {
  const stlDir = path.resolve(__dirname, '../../../examples/stl');
  it('roughing + finishing the test models with random placements and boundaries simulates without errors', () => {
    const files = ['dome-cap-2in-12mm.stl', 'star-coaster-70mm-12mm.stl', 'squat-pyramid-2in-12mm.stl'];
    for (let n = 0; n < 4; n++) {
      const s0 = seed;
      const mesh = parseStl(fs.readFileSync(path.join(stlDir, pick(files))));
      const j = newJob('fuzz3d', { width: 100, length: 100, thickness: 14, origin: pick(['front-left', 'center']) });
      const model: Model = { id: 'model', positions: Array.from(mesh.positions), placement: { ...IDENTITY_PLACEMENT, scale: pick([1, 1.2]), rotZ: pick([0, 30]) } };
      const c = j.stock.origin === 'center' ? 0 : 50;
      model.placement = placementFor(model, { centerX: c + R(-4, 4), centerY: c + R(-4, 4), top: 0 }); j.models = [model];
      const common = { modelId: 'model', shapeIds: [] as string[], boundaryMode: pick(['silhouette', 'bbox', 'stock'] as const), containment: pick(['inside', 'center', 'outside'] as const), boundary: +R(-2, 8).toFixed(1), startDepth: rnd() < 0.3 ? +R(0.3, 2).toFixed(2) : undefined };
      const depth = +R(6, 14).toFixed(2);
      j.ops.push({ id: 'rough', type: 'rough3d', toolId: pick(['t201', 't102']), ...common, depth, depthPerPass: +R(1, 4).toFixed(2), stepover: +R(1, 4).toFixed(2), stockToLeave: +R(0, 0.8).toFixed(2), entry: pick(['helix', 'ramp', 'plunge']) });
      j.ops.push({ id: 'finish', type: 'finish3d', toolId: pick(['t101', 't202']), ...common, depth, stepover: +R(0.5, 2).toFixed(2), axis: pick(['x', 'y']) });
      const tps = generateToolpaths(j);
      expect(tps.flatMap(t => t.warnings.filter(w => /Generation failed|skipped/.test(w))), `job ${n} (seed ${s0})`).toEqual([]);
      const sim = simulate(j, tps, { resolution: 0.3 });
      expect(sim.events.filter(e => e.severity === 'error').map(e => `${e.opId}: ${e.message}`), `job ${n} (seed ${s0}) ${JSON.stringify(j.ops)}`).toEqual([]);
    }
  });
});
