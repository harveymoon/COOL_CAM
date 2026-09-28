import type { Job } from '../job.js';
import type { Finish3DOp, Rough3DOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { MoveList, makeContext } from './common.js';
import { surfaceFor } from './surface.js';

/** Parallel finishing: zig-zag raster along X or Y, tool tip following the offset surface. Air spans are skipped with rapids. */
export function generateFinish3D(job: Job, op: Finish3DOp): Toolpath {
  const ctx = makeContext(job, { ...op, shapeIds: [], depthPerPass: 1e9 });
  const tool = ctx.tool;
  const stepover = op.stepover && op.stepover > 0 ? op.stepover : Math.max(0.1, tool.diameter * 0.1);
  const res = op.resolution ?? Math.min(0.4, Math.max(0.08, stepover / 2));
  const ml = new MoveList(ctx);
  let surf;
  try { surf = surfaceFor(job, op, tool, res); } catch (e) { ctx.warnings.push((e as Error).message); return done(); }
  const { offMasked: off, domain } = surf;
  if (!surf.allowed.length) { ctx.warnings.push('The machining boundary leaves no room for the tool centre (try containment "center" or a larger offset).'); return done(); }
  const zMin = Math.max(ctx.stockTop - op.depth, ctx.stockBottom);
  // Z window: samples above the start depth count as air (skipped), samples below the depth limit are clamped
  const top = ctx.stockTop - (op.startDepth ?? 0); const air = top - 1e-3;
  const alongX = (op.axis ?? 'x') === 'x';
  const rowsN = alongX ? domain.j1 - domain.j0 : domain.i1 - domain.i0;
  const stepCells = Math.max(1, Math.round(stepover / res));
  // the flat floor at the model base (outside the footprint) is left to roughing unless asked for
  const floorZ = surf.modelBase + (op.stockToLeave ?? 0) + 1e-3;
  const isFloor = (i: number, j: number) => !op.finishFloor && off.z[j * off.w + i] <= floorZ && surf.hm.z[j * off.w + i] <= surf.modelBase + 1e-3;
  const zAt = (i: number, j: number) => isFloor(i, j) ? top : Math.max(zMin, Math.min(top, off.z[j * off.w + i]));
  const world = (i: number, j: number) => ({ x: off.x0 + i * res, y: off.y0 + j * res });
  let forward = true; let first = true;
  const rowIdx: number[] = []; for (let k = 0; k <= rowsN; k += stepCells) rowIdx.push(k); if (rowIdx[rowIdx.length - 1] !== rowsN) rowIdx.push(rowsN);
  for (const k of rowIdx) {
    const cells: { i: number; j: number }[] = [];
    if (alongX) { const j = domain.j0 + k; for (let i = domain.i0; i <= domain.i1; i++) cells.push({ i, j }); }
    else { const i = domain.i0 + k; for (let j = domain.j0; j <= domain.j1; j++) cells.push({ i, j }); }
    if (!forward) cells.reverse();
    // split into cutting spans (surface below the stock top); short air gaps are bridged at the surface height
    let span: { i: number; j: number }[] = []; let airRun = 0;
    const flush = () => {
      if (span.length < 2) { span = []; return; }
      const p0 = world(span[0].i, span[0].j); const z0 = zAt(span[0].i, span[0].j);
      const at = ml.position;
      // approaches come down from the stock top: with a Z window (startDepth) the material above `top` is still there
      const approach = ctx.stockTop + 0.5;
      const connector: { x: number; y: number; z: number }[] = [];
      if (!first && !isNaN(at.x) && Math.hypot(at.x - p0.x, at.y - p0.y) <= stepover * 2.5 && Math.abs(at.z - z0) < tool.diameter) {
        // short connector between rows: follow the surface so we never dive through a ridge; abandon it if it would cross a skipped (air) cell
        const n = Math.max(1, Math.ceil(Math.hypot(at.x - p0.x, at.y - p0.y) / res));
        for (let s = 1; s <= n; s++) { const t = s / n; const x = at.x + (p0.x - at.x) * t, y = at.y + (p0.y - at.y) * t; const i = Math.min(off.w - 1, Math.max(0, Math.round((x - off.x0) / res))), j = Math.min(off.h - 1, Math.max(0, Math.round((y - off.y0) / res))); const z = zAt(i, j); if (z >= air) { connector.length = 0; break; } connector.push({ x, y, z }); }
      }
      if (connector.length) for (const c of connector) ml.cut(c.x, c.y, c.z);
      else { ml.moveTo(p0.x, p0.y, z0, approach); first = false; }
      let lastZ = z0, lastDir = 0;
      for (let s = 1; s < span.length; s++) {
        const c = span[s]; const z = zAt(c.i, c.j); const p = world(c.i, c.j);
        const dir = Math.sign(z - lastZ);
        // drop collinear samples to keep the file small
        if (s < span.length - 1 && dir === lastDir && Math.abs(z - lastZ) < 1e-4 && dir === 0) continue;
        ml.cut(p.x, p.y, z); lastZ = z; lastDir = dir;
      }
      span = [];
    };
    for (const c of cells) {
      if (zAt(c.i, c.j) < air) { if (airRun > 0 && airRun <= 2 && span.length) { /* bridged */ } airRun = 0; span.push(c); }
      else { airRun++; if (airRun === 1 && span.length) span.push(c); if (airRun > 2) flush(); }
    }
    flush();
    forward = !forward;
  }
  ml.retract(ctx.safeZ);
  if (!ml.moves.length) ctx.warnings.push('Finishing produced no moves: the surface is entirely at the stock top.');
  return done();
  // Expected engagement: finishing removes what roughing left, i.e. stock-to-leave plus the terraces between roughing levels
  // (up to one roughing stepdown on a steep wall). Without a roughing pass on this model it must not meet more than a diameter.
  function expectedEngagement(): number {
    const roughs = job.ops.filter((o): o is Rough3DOp => o.type === 'rough3d' && o.enabled !== false && o.modelId === op.modelId && job.ops.indexOf(o) < job.ops.indexOf(op));
    if (!roughs.length) return tool.diameter;
    // one roughing stepdown of terrace, the roughing stock-to-leave, plus what a flat roughing cutter leaves against a steep
    // wall that the finishing tool reaches under (up to its radius on a 45° slope)
    return Math.max(...roughs.map(r => { const rt = job.tools.find(t => t.id === r.toolId); const rd = rt?.diameter ?? tool.diameter; return (r.depthPerPass && r.depthPerPass > 0 ? r.depthPerPass : rd) + (r.stockToLeave ?? 0.3) + rd / 2; })) + (op.stockToLeave ?? 0);
  }
  function done(): Toolpath { return { opId: op.id, opName: op.name ?? '3D Finish', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings, stepdown: expectedEngagement() }; }
}
