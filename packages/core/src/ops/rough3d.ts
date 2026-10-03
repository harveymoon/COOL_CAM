import type { Job } from '../job.js';
import type { Rough3DOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { normalize, offsetPolygons, intersection } from '../geometry/offset.js';
import { contoursBelow } from '../mesh.js';
import { maskFromPolygons } from './boundary.js';
import { MoveList, makeContext } from './common.js';
import { clearRegion } from './pocket.js';
import { surfaceFor } from './surface.js';

export function generateRough3D(job: Job, op: Rough3DOp): Toolpath {
  const ctx = makeContext(job, { ...op, shapeIds: [] });
  const tool = ctx.tool;
  const stepover = op.stepover && op.stepover > 0 ? Math.min(op.stepover, tool.diameter * 0.95) : tool.diameter * 0.4;
  const res = op.resolution ?? Math.min(0.5, Math.max(0.15, stepover / 4));
  // declared before the first early return: done() records it on the toolpath
  const stepdown = op.depthPerPass && op.depthPerPass > 0 ? op.depthPerPass : tool.diameter;
  const ml = new MoveList(ctx);
  let surf;
  try { surf = surfaceFor(job, op, tool, res); } catch (e) { ctx.warnings.push((e as Error).message); return done(); }
  const { off, domain, modelBase } = surf;
  if (!surf.allowed.length) { ctx.warnings.push('The machining boundary leaves no room for the tool centre (try containment "center" or a larger offset).'); return done(); }
  // Z levels: from one stepdown below the stock top down to the model base (or the op depth limit), last level exact.
  // Levels always start at the stock top so every cut engages one stepdown; the Z window (startDepth) only decides *which cells*
  // are machined: cells whose finished surface lies above zStart are left alone at every level.
  const zBottom = Math.max(modelBase + (op.stockToLeave ?? 0.3), ctx.stockTop - op.depth, ctx.floor);
  const levels: number[] = [];
  const zStart = ctx.stockTop - (op.startDepth ?? 0);
  for (let z = ctx.stockTop - stepdown; z > zBottom + 1e-6; z -= stepdown) levels.push(z);
  levels.push(zBottom);
  if (zBottom >= ctx.stockTop - 1e-6) { ctx.warnings.push('Nothing to rough: model top is at or above the stock top and depth is 0.'); return done(); }
  if (zBottom >= zStart - 1e-6) { ctx.warnings.push('Nothing to rough: the Z window (skip above depth) starts below everything that would be cut.'); return done(); }
  // prevZ is the level the material actually stands at (the last level cut): clearRegion approaches and plunges from just
  // above it. A level that cannot be cut must not move it, and nothing deeper is generated either: the next level would
  // start with a rapid through the uncut layer and engage two stepdowns at once.
  let prevZ = ctx.stockTop; let cur = { x: 0, y: 0 };
  const stop = (z: number, why: string) => ctx.warnings.push(`Level Z${z.toFixed(2)} skipped: ${why} Roughing stops above it; deeper levels are not generated.`);
  for (const z of levels) {
    const zl = Math.min(z, zStart);
    let loops: ReturnType<typeof contoursBelow>;
    try { loops = contoursBelow(off, zl + 1e-4, domain); } catch (e) { stop(z, (e as Error).message); break; }
    // exact boundary clip (smooth polygons) and a conservative half-cell shrink: contours are interpolated between samples
    const region = offsetPolygons(intersection(normalize(loops), surf.allowed), -res * 0.5);
    // Fail-safe: the tool centre region must only contain samples whose offset surface is at or below the level. If the
    // contouring ever produced a region that covers the model, refuse to cut this level rather than gouge it.
    if (region.length) {
      const mask = maskFromPolygons(off, region); let bad = 0;
      for (let k = 0; k < mask.length; k++) if (mask[k] && off.z[k] > zl + 1e-3) { bad++; if (bad > 2) break; }
      if (bad > 2) { stop(z, `the computed cut region covers ${bad}+ samples of the model (internal contour error).`); break; }
    }
    if (region.length) cur = clearRegion(ml, ctx, region, z, prevZ, { stepover, entry: op.entry ?? 'helix', cur, climb: (op.direction ?? 'climb') === 'climb' });
    prevZ = z;
  }
  ml.retract(ctx.safeZ);
  if (!ml.moves.length) ctx.warnings.push('Roughing produced no moves: the tool may be too large for the features, or the model sits below the depth limit.');
  return done();
  function done(): Toolpath { return { opId: op.id, opName: op.name ?? '3D Rough', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings, stepdown }; }
}
