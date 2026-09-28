import type { Job } from '../job.js';
import { getShapes, getTool } from '../job.js';
import type { VCarveOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { type Polyline, setOrientation, signedArea, simplify } from '../geometry/polyline.js';
import { normalize, offsetPolygons } from '../geometry/offset.js';
import type { Vec2 } from '../geometry/vec.js';
import { dist } from '../geometry/vec.js';
import { MoveList, followPath, makeContext, orderByNearest, rotateToNearest } from './common.js';
import { clearRegion } from './pocket.js';

/**
 * Offset-based V-carve: successive inward offsets of the region are cut with the V-bit tip at depth = offset / tan(half angle),
 * so the groove wall passes exactly through the region outline. Depth is capped at `op.depth` (0 = no cap). With `flatToolId`
 * the area the V-bit cannot reach within the depth cap is pocketed flat first (advanced V-carve).
 */
export function generateVCarve(job: Job, op: VCarveOp): Toolpath {
  const depthCap = op.depth > 0 ? op.depth : 1e9;
  const ctx = makeContext(job, { ...op, depth: Math.min(depthCap, job.stock.thickness), depthPerPass: 1e9 });
  const tool = ctx.tool;
  const ml = new MoveList(ctx);
  const done = (): Toolpath => ({ opId: op.id, opName: op.name ?? 'V-carve', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings });
  if (tool.type !== 'vbit' || !tool.tipAngle) { ctx.warnings.push('V-carve needs a V-bit tool with a tip angle.'); return done(); }
  const tanHalf = Math.tan((tool.tipAngle * Math.PI) / 360);
  const region = normalize(getShapes(job, op.shapeIds).filter(s => s.polyline.closed).map(s => s.polyline));
  if (!region.length) { ctx.warnings.push('V-carve needs closed shapes.'); return done(); }
  const ds = op.stepover && op.stepover > 0 ? op.stepover : 0.4;
  const maxD = depthCap * tanHalf;               // offset at which the depth cap is reached
  const vMaxD = (tool.diameter / 2) * 0.98;      // the V flank ends at the tool's diameter: deeper cuts would use the shank
  const top = ctx.stockTop;
  let cur: Vec2 = { x: 0, y: 0 };

  // advanced: flat-clear everything the V-bit will not reach within the cap, with the flat endmill at the cap depth
  if (op.flatToolId && op.depth > 0) {
    const flat = getTool(job, op.flatToolId);
    const flatCtx = makeContext(job, { ...op, toolId: op.flatToolId, depth: op.depth, depthPerPass: Math.min(flat.diameter * 0.5, op.depth) });
    const flatRegion = offsetPolygons(region, -(maxD + flat.diameter / 2));
    if (flatRegion.length) {
      const fml = new MoveList(flatCtx);
      let prevZ = top;
      for (const z of flatCtx.passes) { clearRegion(fml, flatCtx, flatRegion, z, prevZ, { stepover: op.flatStepover ?? flat.diameter * 0.4, entry: 'helix', cur: { x: 0, y: 0 } }); prevZ = z; }
      fml.retract(flatCtx.safeZ);
      // the flat tool moves are emitted as a separate toolpath by generateToolpaths? No: keep one op = one tool. Store them for the caller.
      flatMoves.set(op.id, { moves: fml.moves, toolId: flat.id, rpm: flatCtx.rpm, warnings: flatCtx.warnings });
    }
  }

  // V passes, outermost first so the groove opens progressively; each region loop family is walked separately
  const passes: { d: number; z: number; loops: Polyline[] }[] = [];
  for (let d = ds; d < 1e4; d += ds) {
    const loops = offsetPolygons(region, -d).map(l => simplify(l, 0.005)).filter(l => Math.abs(signedArea(l)) > 0.01);
    if (!loops.length) break;
    const zc = top - Math.min(d, maxD) / tanHalf;
    passes.push({ d, z: zc, loops: loops.map(l => setOrientation(l, signedArea(l) > 0)) });
    if (d > vMaxD && d > maxD) { ctx.warnings.push(`Region is wider than the V-bit can cut (${tool.diameter} mm diameter): the centre is cleared at the capped depth with V passes.`); }
    if (passes.length > 4000) { ctx.warnings.push('Too many V passes; increase the stepover.'); break; }
  }
  if (!passes.length) { ctx.warnings.push('Region too narrow for the first V pass; reduce the stepover.'); return done(); }
  if (passes[passes.length - 1].d / tanHalf > depthCap && !op.flatToolId) ctx.warnings.push(`V-carve reaches the depth cap ${op.depth} mm; wide areas get a stepped floor. Add a flat-clearing tool for a clean floor.`);
  // also cut a first pass right at the outline (depth ≈ 0) to define the crisp edge
  const edgeLoops = offsetPolygons(region, -0.02).map(l => setOrientation(simplify(l, 0.005), signedArea(l) > 0));
  passes.unshift({ d: 0.02, z: top - 0.02 / tanHalf, loops: edgeLoops });

  for (const pass of passes) {
    for (const loop0 of orderByNearest(pass.loops, cur)) {
      const loop = rotateToNearest(loop0, cur); const p0 = loop.points[0]; const at = ml.position;
      if (!isNaN(at.x) && dist({ x: at.x, y: at.y }, p0) <= ds * 2.5 && at.z <= top) ml.cut(p0.x, p0.y, pass.z, ctx.plunge); // step inward/down directly
      else ml.moveTo(p0.x, p0.y, pass.z, top + 0.5);
      followPath(ml, loop, pass.z);
      cur = ml.position;
    }
  }
  ml.retract(ctx.safeZ);
  return done();
}

/** Flat-clearing toolpaths produced by advanced V-carve ops, keyed by op id (separate tool → separate toolpath). */
export const flatMoves = new Map<string, { moves: Toolpath['moves']; toolId: string; rpm: number; warnings: string[] }>();
