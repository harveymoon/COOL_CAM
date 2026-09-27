import type { Job } from '../job.js';
import type { Rough3DOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { normalize, offsetPolygons, intersection } from '../geometry/offset.js';
import { contoursBelow } from '../mesh.js';
import { MoveList, makeContext } from './common.js';
import { clearRegion } from './pocket.js';
import { surfaceFor } from './surface.js';

export function generateRough3D(job: Job, op: Rough3DOp): Toolpath {
  const ctx = makeContext(job, { ...op, shapeIds: [] });
  const tool = ctx.tool;
  const stepover = op.stepover && op.stepover > 0 ? Math.min(op.stepover, tool.diameter * 0.95) : tool.diameter * 0.4;
  const res = op.resolution ?? Math.min(0.5, Math.max(0.15, stepover / 4));
  const ml = new MoveList(ctx);
  let surf;
  try { surf = surfaceFor(job, op, tool, res); } catch (e) { ctx.warnings.push((e as Error).message); return done(); }
  const { off, domain, modelBase } = surf;
  if (!surf.allowed.length) { ctx.warnings.push('The machining boundary leaves no room for the tool centre (try containment "center" or a larger offset).'); return done(); }
  // Z levels: from one stepdown below the stock top down to the model base (or the op depth limit), last level exact.
  const stepdown = op.depthPerPass && op.depthPerPass > 0 ? op.depthPerPass : tool.diameter;
  const zBottom = Math.max(modelBase + (op.stockToLeave ?? 0.3), ctx.stockTop - op.depth, ctx.stockBottom);
  const levels: number[] = [];
  const zStart = ctx.stockTop - (op.startDepth ?? 0);
  for (let z = zStart - stepdown; z > zBottom + 1e-6; z -= stepdown) levels.push(z);
  levels.push(zBottom);
  if (zBottom >= ctx.stockTop - 1e-6) { ctx.warnings.push('Nothing to rough: model top is at or above the stock top and depth is 0.'); return done(); }
  let prevZ = zStart; let cur = { x: 0, y: 0 };
  for (const z of levels) {
    const loops = contoursBelow(off, z + 1e-4, domain);
    // exact boundary clip (smooth polygons) and a conservative half-cell shrink: contours are interpolated between samples
    const region = offsetPolygons(intersection(normalize(loops), surf.allowed), -res * 0.5);
    if (region.length) cur = clearRegion(ml, ctx, region, z, prevZ, { stepover, entry: op.entry ?? 'helix', cur, climb: (op.direction ?? 'climb') === 'climb' });
    prevZ = z;
  }
  ml.retract(ctx.safeZ);
  if (!ml.moves.length) ctx.warnings.push('Roughing produced no moves: the tool may be too large for the features, or the model sits below the depth limit.');
  return done();
  function done(): Toolpath { return { opId: op.id, opName: op.name ?? '3D Rough', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings }; }
}
