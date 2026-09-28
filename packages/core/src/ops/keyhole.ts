import type { Job } from '../job.js';
import { getShapes } from '../job.js';
import type { KeyholeOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { bbox } from '../geometry/polyline.js';
import { MoveList, makeContext, orderByNearest } from './common.js';

/** Keyhole slot: plunge the head through at the entry, slide along the slot at depth, come back, retract. */
export function generateKeyhole(job: Job, op: KeyholeOp): Toolpath {
  const ctx = makeContext(job, { ...op, depthPerPass: 1e9 });
  const tool = ctx.tool; const ml = new MoveList(ctx);
  const done = (): Toolpath => ({ opId: op.id, opName: op.name ?? 'Keyhole', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings });
  if (tool.type !== 'keyhole') ctx.warnings.push(`Tool ${tool.name} is not a keyhole cutter; the slot will be cut as a plain slot.`);
  const length = op.length ?? 20; const ang = ((op.angle ?? 90) * Math.PI) / 180;
  const z = ctx.stockTop - op.depth;
  const slots = getShapes(job, op.shapeIds).map(s => {
    const pts = s.polyline.points;
    if (!s.polyline.closed && pts.length >= 2) return { points: [pts[0], pts[pts.length - 1]] };
    const b = bbox(s.polyline); const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    return { points: [c, { x: c.x + Math.cos(ang) * length, y: c.y + Math.sin(ang) * length }] };
  });
  for (const sl of orderByNearest(slots, { x: 0, y: 0 })) {
    const [a, b] = sl.points;
    ml.retract(); ml.rapid(a.x, a.y, ctx.clearanceZ); ml.rapid(a.x, a.y, ctx.stockTop + 0.5);
    ml.plunge(a.x, a.y, z);
    ml.cut(b.x, b.y, z);
    ml.cut(a.x, a.y, z);
    ml.retract(ctx.clearanceZ);
  }
  ml.retract(ctx.safeZ);
  return done();
}
