import type { Job } from '../job.js';
import { getModel, getShapes, stockBounds } from '../job.js';
import type { Rough3DOp, Finish3DOp } from '../ops.js';
import type { Tool } from '../tools.js';
import type { Polyline } from '../geometry/polyline.js';
import { normalize, offsetPolygons, difference, intersection } from '../geometry/offset.js';
import { meshBBox, placedMesh } from '../mesh.js';
import { footprintAbove } from '../features.js';
import { rect } from '../primitives.js';
import type { Heightmap } from '../mesh.js';

const silhouetteCache = new Map<string, Polyline[]>();
function checksum(a: number[]): number { let s = a.length; const step = Math.max(1, Math.floor(a.length / 512)); for (let i = 0; i < a.length; i += step) s = (s * 31 + Math.round(a[i] * 1000)) | 0; return s; }

/** Model silhouette (XY projection), cached per model + placement. */
export function modelSilhouette(job: Job, modelId: string): Polyline[] {
  const m = getModel(job, modelId);
  const key = JSON.stringify([m.id, checksum(m.positions), m.placement]);
  let s = silhouetteCache.get(key);
  if (!s) { s = footprintAbove(placedMesh(m), -Infinity); if (silhouetteCache.size > 32) silhouetteCache.delete(silhouetteCache.keys().next().value!); silhouetteCache.set(key, s); }
  return s;
}

export interface BoundaryResult {
  /** The machining boundary after offset and avoid regions (what the user sees). */
  boundary: Polyline[];
  /** Region the tool centre may occupy. */
  allowed: Polyline[];
}

/** Resolve a 3D op's machining boundary and the resulting tool-centre region. */
export function boundaryFor(job: Job, op: Rough3DOp | Finish3DOp, tool: Tool): BoundaryResult {
  const sb = stockBounds(job.stock);
  const stockRect = [rect(sb.x0, sb.y0, job.stock.width, job.stock.length)];
  const mode = op.boundaryMode ?? 'silhouette';
  let base: Polyline[];
  if (mode === 'stock') base = stockRect;
  else if (mode === 'bbox') { const bb = meshBBox(placedMesh(getModel(job, op.modelId))); base = [rect(bb.min[0], bb.min[1], bb.max[0] - bb.min[0], bb.max[1] - bb.min[1])]; }
  else if (mode === 'shapes') {
    const shapes = getShapes(job, op.shapeIds ?? []).filter(s => s.polyline.closed).map(s => s.polyline);
    if (!shapes.length) throw new Error('Boundary mode "shapes" needs at least one closed shape on the operation.');
    base = normalize(shapes);
  } else base = modelSilhouette(job, op.modelId);
  const off = op.boundary ?? 0;
  let boundary = off !== 0 ? offsetPolygons(base, off) : base;
  if (op.avoidShapeIds?.length) boundary = difference(boundary, normalize(getShapes(job, op.avoidShapeIds).filter(s => s.polyline.closed).map(s => s.polyline)));
  // the tool centre may never leave the stock by more than its radius
  boundary = intersection(boundary, offsetPolygons(stockRect, tool.diameter / 2));
  const r = tool.diameter / 2 + (op.stockToLeave ?? 0);
  const c = op.containment ?? 'inside';
  const allowed = c === 'inside' ? offsetPolygons(boundary, -r) : c === 'outside' ? offsetPolygons(boundary, r) : boundary;
  return { boundary, allowed: intersection(allowed, offsetPolygons(stockRect, tool.diameter / 2)) };
}

/** Rasterise a polygon set (even-odd) onto a heightmap grid: 1 = inside. */
export function maskFromPolygons(hm: Heightmap, polys: Polyline[]): Uint8Array {
  const mask = new Uint8Array(hm.w * hm.h);
  const xs: number[] = [];
  for (let j = 0; j < hm.h; j++) {
    const y = hm.y0 + j * hm.res; xs.length = 0;
    for (const p of polys) {
      const pts = p.points; const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - hm.x0) / hm.res)), i1 = Math.min(hm.w - 1, Math.floor((xs[k + 1] - hm.x0) / hm.res));
      for (let i = i0; i <= i1; i++) mask[j * hm.w + i] = 1;
    }
  }
  return mask;
}
