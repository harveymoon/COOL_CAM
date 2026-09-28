import type { Job } from '../job.js';
import { getShapes } from '../job.js';
import type { DrillOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import type { Vec2 } from '../geometry/vec.js';
import { bbox, type Polyline } from '../geometry/polyline.js';
import { MoveList, makeContext, orderByNearest } from './common.js';

export function generateDrill(job: Job, op: DrillOp): Toolpath {
  const ctx = makeContext(job, op);
  const shapes = getShapes(job, op.shapeIds);
  const ml = new MoveList(ctx);
  const centers: { points: Vec2[] }[] = shapes.map(s => {
    return { points: [centroid(s.polyline)] };
  });
  const finalZ = ctx.stockTop - op.depth;
  const peck = op.peck && op.peck > 0 ? op.peck : 0;
  for (const c of orderByNearest(centers, { x: 0, y: 0 })) {
    const p = c.points[0];
    ml.retract();
    ml.rapid(p.x, p.y, ctx.clearanceZ);
    ml.rapid(p.x, p.y, ctx.stockTop + 0.5);
    if (peck > 0) {
      let z = ctx.stockTop;
      while (z > finalZ + 1e-9) {
        z = Math.max(finalZ, z - peck);
        ml.plunge(p.x, p.y, z);
        ml.rapid(p.x, p.y, ctx.stockTop + 0.5);
        if (z > finalZ + 1e-9) ml.rapid(p.x, p.y, z + Math.min(1, peck * 0.5));
      }
    } else {
      ml.plunge(p.x, p.y, finalZ);
      ml.rapid(p.x, p.y, ctx.stockTop + 0.5);
    }
  }
  ml.retract(ctx.safeZ);
  return { opId: op.id, opName: op.name ?? 'Drill', toolId: ctx.tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings, stepdown: peck > 0 ? peck : op.depth };
}

/** Area centroid for closed loops; midpoint of bbox otherwise. */
function centroid(p: Polyline): Vec2 {
  if (!p.closed || p.points.length < 3) { const b = bbox(p); return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; }
  let a = 0, cx = 0, cy = 0; const pts = p.points;
  for (let i = 0, n = pts.length; i < n; i++) {
    const q = pts[i], r = pts[(i + 1) % n]; const c = q.x * r.y - r.x * q.y;
    a += c; cx += (q.x + r.x) * c; cy += (q.y + r.y) * c;
  }
  if (Math.abs(a) < 1e-12) { const b = bbox(p); return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
