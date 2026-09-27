import type { Job } from '../job.js';
import { getModel, stockBounds } from '../job.js';
import type { Rough3DOp, Finish3DOp } from '../ops.js';
import type { Tool } from '../tools.js';
import { type Heightmap, meshBBox, meshHeightmap, offsetSurface, placedMesh } from '../mesh.js';
import { bbox } from '../geometry/polyline.js';
import { boundaryFor, maskFromPolygons } from './boundary.js';
import type { Polyline } from '../geometry/polyline.js';

/** Cached heightmap + offset surface for a (model, placement, tool, stl, res, boundary) combination. */
export interface Surface {
  hm: Heightmap;
  /** Drop-cutter offset surface. */
  off: Heightmap;
  /** Offset surface with cells outside the tool-centre region pushed far above the stock (never machined). */
  offMasked: Heightmap;
  mask: Uint8Array;
  domain: { i0: number; j0: number; i1: number; j1: number };
  boundary: Polyline[]; allowed: Polyline[];
  modelTop: number; modelBase: number;
}

const cache = new Map<string, Surface>();
function checksum(a: number[]): number { let s = a.length; const step = Math.max(1, Math.floor(a.length / 512)); for (let i = 0; i < a.length; i += step) s = (s * 31 + Math.round(a[i] * 1000)) | 0; return s; }

export function surfaceFor(job: Job, op: Rough3DOp | Finish3DOp, tool: Tool, res: number): Surface {
  const model = getModel(job, op.modelId);
  const stl = op.stockToLeave ?? (op.type === 'rough3d' ? 0.3 : 0);
  const shapeSig = [...(op.shapeIds ?? []), ...(op.avoidShapeIds ?? [])].map(id => { const s = job.shapes.find(x => x.id === id); return s ? [id, s.polyline.points.length, bbox(s.polyline)] : id; });
  const key = JSON.stringify([model.id, checksum(model.positions), model.placement, tool.id, tool.diameter, tool.type, tool.tipAngle, stl, res, op.boundary ?? 0, op.boundaryMode ?? 'silhouette', op.containment ?? 'inside', shapeSig, job.stock]);
  const hit = cache.get(key); if (hit) return hit;
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  const mesh = placedMesh(model); const bb = meshBBox(mesh); const sb = stockBounds(job.stock);
  const { boundary, allowed } = boundaryFor(job, op, tool);
  const r = tool.diameter / 2 + stl + res * 0.71;
  // heightmap extent: everything the tool footprint can touch while its centre stays in `allowed`, clipped to the stock (+r)
  const ab = allowed.length ? bbox(allowed) : { minX: bb.min[0], minY: bb.min[1], maxX: bb.max[0], maxY: bb.max[1] };
  const x0 = Math.max(sb.x0 - r, ab.minX - r - res), y0 = Math.max(sb.y0 - r, ab.minY - r - res);
  const x1 = Math.min(sb.x1 + r, ab.maxX + r + res), y1 = Math.min(sb.y1 + r, ab.maxY + r + res);
  const floor = bb.min[2];
  const hm = meshHeightmap(mesh, res, { x0, y0, x1: Math.max(x1, x0 + res), y1: Math.max(y1, y0 + res) }, floor);
  // half a diagonal cell of extra radius keeps linear interpolation between samples conservative at vertical walls
  const off = offsetSurface(hm, tool, stl, res * 0.71);
  const mask = maskFromPolygons(hm, allowed);
  const blocked = sb.top + 1000;
  const mz = new Float32Array(off.z.length);
  for (let i = 0; i < mz.length; i++) mz[i] = mask[i] ? off.z[i] : blocked;
  const offMasked: Heightmap = { ...off, z: mz };
  const surf: Surface = { hm, off, offMasked, mask, domain: { i0: 0, j0: 0, i1: hm.w - 1, j1: hm.h - 1 }, boundary, allowed, modelTop: bb.max[2], modelBase: floor };
  cache.set(key, surf);
  return surf;
}

export function clearSurfaceCache() { cache.clear(); }
