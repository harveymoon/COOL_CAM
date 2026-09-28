import type { Job } from '../job.js';
import { getShapes, getTool } from '../job.js';
import type { VCarveOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { type Polyline, setOrientation, signedArea, simplify } from '../geometry/polyline.js';
import { normalize, offsetPolygons } from '../geometry/offset.js';
import type { Vec2 } from '../geometry/vec.js';
import { dist } from '../geometry/vec.js';
import { MoveList, followPath, makeContext, orderByNearest, rotateToNearest, segmentInside } from './common.js';
import { clearRegion } from './pocket.js';

/**
 * Offset-based V-carve: successive inward offsets of the region are cut with the V-bit tip at depth = offset / tan(half angle),
 * so the groove wall passes exactly through the region outline. Depth is capped at `op.depth` (0 = no cap). With `flatToolId`
 * the area the V-bit cannot reach within the depth cap is pocketed flat first (advanced V-carve).
 */
export function generateVCarve(job: Job, op: VCarveOp): Toolpath {
  const tool0 = getTool(job, op.toolId);
  const tanHalf0 = tool0.tipAngle ? Math.tan((tool0.tipAngle * Math.PI) / 360) : 1;
  // The tip can never go deeper than the V flank (beyond it the shank would cut) or the stock; an explicit cap lowers that further.
  const flankDepth = (tool0.diameter / 2) * 0.98 / tanHalf0;
  const hardCap = Math.min(flankDepth, job.stock.thickness);
  const depthCap = op.depth > 0 ? Math.min(op.depth, hardCap) : hardCap;
  const ctx = makeContext(job, { ...op, depth: depthCap, depthPerPass: 1e9 });
  const tool = ctx.tool;
  const ml = new MoveList(ctx);
  const ds0 = op.stepover && op.stepover > 0 ? op.stepover : 0.4;
  // successive offset passes each deepen the groove by stepover / tan(half angle)
  const done = (): Toolpath => ({ opId: op.id, opName: op.name ?? 'V-carve', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings, stepdown: ds0 / tanHalf0 });
  if (tool.type !== 'vbit' || !tool.tipAngle) { ctx.warnings.push('V-carve needs a V-bit tool with a tip angle.'); return done(); }
  const tanHalf = tanHalf0;
  const region = normalize(getShapes(job, op.shapeIds).filter(s => s.polyline.closed).map(s => s.polyline));
  if (!region.length) { ctx.warnings.push('V-carve needs closed shapes.'); return done(); }
  const ds = op.stepover && op.stepover > 0 ? op.stepover : 0.4;
  const maxD = depthCap * tanHalf;               // offset at which the depth cap is reached
  const top = ctx.stockTop;
  let cur: Vec2 = { x: 0, y: 0 };

  // advanced: flat-clear everything the V-bit will not reach within the cap, with the flat endmill at the cap depth
  if (op.flatToolId && op.depth > 0) {
    const flat = getTool(job, op.flatToolId);
    // the flat endmill runs on its own feeds, not the ones tuned for the V-bit
    const flatCtx = makeContext(job, { id: op.id, name: op.name, shapeIds: op.shapeIds, toolId: op.flatToolId, depth: depthCap, depthPerPass: Math.min(flat.diameter * 0.5, depthCap) });
    const flatRegion = offsetPolygons(region, -(maxD + flat.diameter / 2));
    if (flatRegion.length) {
      const fml = new MoveList(flatCtx);
      let prevZ = top;
      for (const z of flatCtx.passes) { clearRegion(fml, flatCtx, flatRegion, z, prevZ, { stepover: op.flatStepover ?? flat.diameter * 0.4, entry: 'helix', cur: { x: 0, y: 0 } }); prevZ = z; }
      fml.retract(flatCtx.safeZ);
      // the flat tool moves are emitted as a separate toolpath by generateToolpaths? No: keep one op = one tool. Store them for the caller.
      flatMoves.set(op.id, { moves: fml.moves, toolId: flat.id, rpm: flatCtx.rpm, warnings: flatCtx.warnings, stepdown: flatCtx.stepdown });
    }
  }

  // V passes, outermost first so the groove opens progressively; each region loop family is walked separately
  const passes: { d: number; z: number; loops: Polyline[] }[] = [];
  for (let d = ds; d < 1e4; d += ds) {
    const loops = offsetPolygons(region, -d).map(l => simplify(l, 0.005)).filter(l => Math.abs(signedArea(l)) > 0.01);
    if (!loops.length) break;
    const zc = top - Math.min(d, maxD) / tanHalf;
    passes.push({ d, z: zc, loops: loops.map(l => setOrientation(l, signedArea(l) > 0)) });
    if (passes.length > 4000) { ctx.warnings.push('Too many V passes; increase the stepover.'); break; }
  }
  if (!passes.length) { ctx.warnings.push('Region too narrow for the first V pass; reduce the stepover.'); return done(); }
  const deepest = passes[passes.length - 1].d / tanHalf;
  if (deepest > depthCap + 1e-9) {
    const why = op.depth > 0 && op.depth <= hardCap ? `the depth cap ${op.depth} mm` : depthCap >= job.stock.thickness - 1e-9 ? `the stock bottom (${job.stock.thickness} mm)` : `the end of the V flank (${depthCap.toFixed(2)} mm for a ${tool.diameter} mm bit)`;
    ctx.warnings.push(`Region is wider than the V can carve: depth clamped at ${why}, so wide areas get a stepped floor${op.flatToolId ? '' : '. Add a flat-clearing tool for a clean floor'}.`);
  }
  // also cut a first pass right at the outline (depth ≈ 0) to define the crisp edge
  const edgeLoops = offsetPolygons(region, -0.02).map(l => setOrientation(simplify(l, 0.005), signedArea(l) > 0));
  passes.unshift({ d: 0.02, z: top - 0.02 / tanHalf, loops: edgeLoops });

  for (const pass of passes) {
    for (const loop0 of orderByNearest(pass.loops, cur)) {
      const loop = rotateToNearest(loop0, cur); const p0 = loop.points[0]; const at = ml.position;
      // step inward/down directly, but only within the same island: the straight step must stay inside the region
      if (!isNaN(at.x) && dist({ x: at.x, y: at.y }, p0) <= ds * 2.5 && at.z <= top && segmentInside({ x: at.x, y: at.y }, p0, region, 0.2)) ml.cut(p0.x, p0.y, pass.z, ctx.plunge);
      else ml.moveTo(p0.x, p0.y, pass.z, top + 0.5);
      followPath(ml, loop, pass.z);
      cur = ml.position;
    }
  }
  ml.retract(ctx.safeZ);
  return done();
}

/** Flat-clearing toolpaths produced by advanced V-carve ops, keyed by op id (separate tool → separate toolpath). */
export const flatMoves = new Map<string, { moves: Toolpath['moves']; toolId: string; rpm: number; warnings: string[]; stepdown: number }>();
