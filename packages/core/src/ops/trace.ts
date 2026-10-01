import type { Job } from '../job.js';
import type { Finish3DOp, TraceOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { makeContext, MoveList } from './common.js';
import { surfaceFor } from './surface.js';
import { MeshDistance, meshBBox, placedMesh, sampleHeightmap } from '../mesh.js';
import { getModel } from '../job.js';

/**
 * Trace operation: run the tool tip along ready-made 3D paths.
 * - Every path: retract, rapid at clearance to above its first point, rapid down to just above the stock, plunge to the first
 *   point at the plunge feed, feed through the points, retract.
 * - `project`: XY from the path, Z from the model's drop-cutter offset surface (lowest gouge-free tip height), resampled along
 *   each segment so the pass follows the surface. The given Z is compared and reported, never trusted.
 * - Z is floored at the stock bottom minus the spoilboard allowance (clamped points are counted in a warning).
 * - Tip mode with a `modelId` verifies the path against the mesh exactly (ball nose: sphere-to-triangle distance along the
 *   resampled path); gouges deeper than 0.02 mm are reported. Heightmaps are too coarse for that on steep faces.
 */
export function generateTrace(job: Job, op: TraceOp): Toolpath {
  const paths = (op.pathIds ?? []).map(id => { const p = (job.paths ?? []).find(x => x.id === id); if (!p) throw new Error(`Unknown path '${id}'`); return p; });
  const allPts = paths.flatMap(p => p.points);
  const topZ = (() => { const b = job.stock.zOrigin === 'top' ? 0 : job.stock.thickness; return b; })();
  let lowest = Infinity; for (const p of allPts) if (p[2] < lowest) lowest = p[2]; // a loop, never a call spread: sheets have tens of thousands of points
  const deepest = allPts.length ? Math.max(0, topZ - lowest) : 0;
  const ctx = makeContext(job, { ...op, shapeIds: [], depth: Math.max(deepest, 1e-3), depthPerPass: Math.max(deepest, 1e-3) });
  const ml = new MoveList(ctx);
  const tool = ctx.tool;
  const tp = (): Toolpath => ({ opId: op.id, opName: op.name ?? 'Trace', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings, stepdown: op.stepdown && op.stepdown > 0 ? op.stepdown : tool.diameter });
  if (!paths.length) { ctx.warnings.push('No paths selected.'); return tp(); }

  // project mode: one offset surface covering every path, built through the finish3d boundary machinery with a generous
  // outside offset so the heightmap extends under all paths
  let off: ReturnType<typeof surfaceFor>['off'] | null = null; let res = 0.2;
  if (op.mode === 'project') {
    if (!op.modelId) throw new Error('Project mode needs a model (modelId).');
    const model = getModel(job, op.modelId); const bb = meshBBox(placedMesh(model));
    let reach = 0; for (const p of allPts) reach = Math.max(reach, bb.min[0] - p[0], p[0] - bb.max[0], bb.min[1] - p[1], p[1] - bb.max[1]);
    res = op.resolution ?? Math.min(0.25, Math.max(0.08, tool.diameter / 16));
    const fake: Finish3DOp = { id: op.id, type: 'finish3d', toolId: op.toolId, shapeIds: [], modelId: op.modelId, depth: ctx.stockTop - ctx.floor, stockToLeave: op.stockToLeave ?? 0, boundaryMode: 'silhouette', containment: 'outside', boundary: Math.max(0, reach) + tool.diameter + 2 };
    off = surfaceFor(job, fake, tool, res).off;
  }
  const dz = op.depthOffset ?? 0;
  let clamped = 0, outside = 0, maxAbove = 0, maxBelow = 0, compared = 0;
  const zAt = (x: number, y: number, given: number): number => {
    let z: number;
    if (off) {
      const s = sampleHeightmap(off, x, y);
      if (!Number.isFinite(s)) { outside++; z = given + dz; }
      else { z = s; const d = given - s; compared++; if (d > maxAbove) maxAbove = d; if (-d > maxBelow) maxBelow = -d; }
    } else z = given + dz;
    if (z < ctx.floor - 1e-6) { clamped++; z = ctx.floor; }
    return z;
  };
  const step = off ? Math.max(res, 0.1) : Infinity;
  for (const p of paths) {
    if (p.points.length < 2) { ctx.warnings.push(`Path ${p.id} has fewer than two points; skipped.`); continue; }
    const [x0, y0, g0] = p.points[0];
    const z0 = zAt(x0, y0, g0);
    ml.moveTo(x0, y0, z0, ctx.stockTop + 1);
    for (let i = 1; i < p.points.length; i++) {
      const [ax, ay, ag] = p.points[i - 1]; const [bx, by, bg] = p.points[i];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Number.isFinite(step) && len > step ? Math.ceil(len / step) : 1;
      for (let k = 1; k <= n; k++) { const t = k / n; const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, g = ag + (bg - ag) * t; ml.cut(x, y, zAt(x, y, g)); }
    }
    ml.retract();
  }
  if (clamped) ctx.warnings.push(`${clamped} point(s) were below the stock bottom${job.stock.spoilboard ? ' minus the spoilboard allowance' : ''} and were raised to it. Increase the allowance if the cut is meant to go through.`);
  if (off) {
    if (outside) ctx.warnings.push(`${outside} point(s) fell outside the model's heightmap and kept their given Z.`);
    if (compared) ctx.warnings.push(`Projected onto ${op.modelId}: the given Z was at most ${maxAbove.toFixed(3)} mm above and ${maxBelow.toFixed(3)} mm below the drop-cutter surface.`);
  }
  if (op.mode === 'tip' && op.modelId) verifyAgainstMesh(job, op.modelId, tool, paths.map(p => p.points), dz, ctx.warnings);
  if (!ml.moves.some(m => m.kind === 'cut')) ctx.warnings.push('Trace produced no cutting moves.');
  return tp();
}

/** Exact verification of tip paths against a model: resample each segment and measure the cutter's clearance to the mesh. */
function verifyAgainstMesh(job: Job, modelId: string, tool: { type: string; diameter: number }, paths: [number, number, number][][], dz: number, warnings: string[]) {
  if (tool.type !== 'ballnose') { warnings.push(`Verification against ${modelId} needs a ball nose (sphere check); ${tool.type} paths are run as given.`); return; }
  const model = getModel(job, modelId); const md = new MeshDistance(placedMesh(model).positions); const r = tool.diameter / 2;
  let n = 0, worst = Infinity, at: number[] = [], gouges = 0; const step = 0.25;
  for (const pts of paths) for (let i = 1; i < pts.length; i++) {
    const [ax, ay, az] = pts[i - 1], [bx, by, bz] = pts[i]; const len = Math.hypot(bx - ax, by - ay, bz - az); const k = Math.max(1, Math.ceil(len / step));
    for (let s = i === 1 ? 0 : 1; s <= k; s++) { const t = s / k; const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t + dz; const c = md.distance(x, y, z + r) - r; n++; if (c < worst) { worst = c; at = [x, y, z]; } if (c < -0.02) gouges++; }
  }
  if (!n) return;
  if (gouges) warnings.push(`GOUGE: ${gouges} of ${n} positions cut into ${modelId}, up to ${(-worst).toFixed(3)} mm at (${at.map(v => v.toFixed(2)).join(', ')}). Check the paths or the model placement.`);
  else warnings.push(`Verified against ${modelId}: the ball stays ${worst >= 0 ? `${worst.toFixed(3)} mm clear of` : `within ${(-worst).toFixed(3)} mm of`} the surface over ${n} positions.`);
}
