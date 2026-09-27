import type { Tool } from './tools.js';
import type { Polyline } from './geometry/polyline.js';
import { chain, simplify } from './geometry/polyline.js';

/** Triangle soup: 9 floats per triangle (ax ay az bx by bz cx cy cz). */
export interface Mesh { positions: Float32Array }

export interface BBox3 { min: [number, number, number]; max: [number, number, number] }

export function meshBBox(m: Mesh): BBox3 {
  const p = m.positions; const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** How a model sits in the job: scale, then rotate X, Y, Z (degrees), then translate. */
export interface Placement { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; scale: number }
export const IDENTITY_PLACEMENT: Placement = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1 };

/** A 3D model in a job. Positions are stored as a plain array so the job serialises to JSON. */
export interface Model { id: string; name?: string; positions: number[]; placement: Placement; sourceFile?: string }

function rotationMatrix(p: Placement): number[] {
  const rx = (p.rotX * Math.PI) / 180, ry = (p.rotY * Math.PI) / 180, rz = (p.rotZ * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

export function applyPlacement(mesh: Mesh, p: Placement): Mesh {
  const R = rotationMatrix(p); const s = p.scale || 1; const src = mesh.positions; const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i] * s, y = src[i + 1] * s, z = src[i + 2] * s;
    out[i] = R[0] * x + R[1] * y + R[2] * z + p.x;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z + p.y;
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z + p.z;
  }
  return { positions: out };
}

export const modelMesh = (m: Model): Mesh => ({ positions: Float32Array.from(m.positions) });
export const placedMesh = (m: Model): Mesh => applyPlacement(modelMesh(m), m.placement);

/** Translate a placement so the placed bbox lands with min corner at (x,y) and top at `top`. */
export function placementFor(model: Model, target: { minX?: number; minY?: number; centerX?: number; centerY?: number; top?: number; bottom?: number }): Placement {
  const bb = meshBBox(placedMesh(model)); const p = { ...model.placement };
  if (target.minX !== undefined) p.x += target.minX - bb.min[0];
  if (target.minY !== undefined) p.y += target.minY - bb.min[1];
  if (target.centerX !== undefined) p.x += target.centerX - (bb.min[0] + bb.max[0]) / 2;
  if (target.centerY !== undefined) p.y += target.centerY - (bb.min[1] + bb.max[1]) / 2;
  if (target.top !== undefined) p.z += target.top - bb.max[2];
  else if (target.bottom !== undefined) p.z += target.bottom - bb.min[2];
  return p;
}

/** Top-down heightmap of a mesh. Cells the mesh does not cover hold `floor`. */
export interface Heightmap { w: number; h: number; res: number; x0: number; y0: number; z: Float32Array; floor: number }

export function meshHeightmap(mesh: Mesh, res: number, bounds: { x0: number; y0: number; x1: number; y1: number }, floor: number): Heightmap {
  const w = Math.max(2, Math.ceil((bounds.x1 - bounds.x0) / res) + 1), h = Math.max(2, Math.ceil((bounds.y1 - bounds.y0) / res) + 1);
  const z = new Float32Array(w * h).fill(floor);
  const p = mesh.positions; const x0 = bounds.x0, y0 = bounds.y0;
  const put = (i: number, j: number, v: number) => { if (i >= 0 && j >= 0 && i < w && j < h) { const k = j * w + i; if (v > z[k]) z[k] = v; } };
  for (let t = 0; t < p.length; t += 9) {
    const ax = p[t], ay = p[t + 1], az = p[t + 2], bx = p[t + 3], by = p[t + 4], bz = p[t + 5], cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
    const minI = Math.floor((Math.min(ax, bx, cx) - x0) / res), maxI = Math.ceil((Math.max(ax, bx, cx) - x0) / res);
    const minJ = Math.floor((Math.min(ay, by, cy) - y0) / res), maxJ = Math.ceil((Math.max(ay, by, cy) - y0) / res);
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) > 1e-12) {
      for (let j = Math.max(0, minJ); j <= Math.min(h - 1, maxJ); j++) {
        const py = y0 + j * res;
        for (let i = Math.max(0, minI); i <= Math.min(w - 1, maxI); i++) {
          const px = x0 + i * res;
          let l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det;
          let l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det;
          let l3 = 1 - l1 - l2;
          const eps = -1e-9;
          if (l1 >= eps && l2 >= eps && l3 >= eps) { l1 = Math.max(0, l1); l2 = Math.max(0, l2); l3 = Math.max(0, l3); put(i, j, l1 * az + l2 * bz + l3 * cz); }
        }
      }
    }
    // sample the edges too so thin features and vertical walls register
    for (const [x1, y1, z1, x2, y2, z2] of [[ax, ay, az, bx, by, bz], [bx, by, bz, cx, cy, cz], [cx, cy, cz, ax, ay, az]]) {
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (res * 0.5)));
      for (let k = 0; k <= n; k++) { const f = k / n; put(Math.round((x1 + (x2 - x1) * f - x0) / res), Math.round((y1 + (y2 - y1) * f - y0) / res), z1 + (z2 - z1) * f); }
    }
  }
  return { w, h, res, x0, y0, z, floor };
}

/** Tool profile height above the tip at radial distance d. */
export function toolProfile(tool: Tool, d: number, radius = tool.diameter / 2): number {
  if (d > radius) return Infinity;
  if (tool.type === 'ballnose') return radius - Math.sqrt(Math.max(0, radius * radius - d * d));
  if (tool.type === 'vbit' || tool.type === 'drill') return d / Math.tan(((tool.tipAngle ?? 90) * Math.PI) / 360);
  return 0;
}

/**
 * Drop-cutter offset surface: the lowest Z the tool tip may reach at each XY without gouging the heightmap.
 * `stockToLeave` enlarges the tool radially and raises the result.
 */
export function offsetSurface(hm: Heightmap, tool: Tool, stockToLeave = 0, radialExtra = 0): Heightmap {
  const r = tool.diameter / 2 + stockToLeave + radialExtra; const rc = Math.ceil(r / hm.res);
  const dx: number[] = [], dy: number[] = [], dz: number[] = [];
  for (let j = -rc; j <= rc; j++) for (let i = -rc; i <= rc; i++) { const d = Math.hypot(i * hm.res, j * hm.res); if (d <= r) { dx.push(i); dy.push(j); dz.push(toolProfile(tool, d, r)); } }
  const out = new Float32Array(hm.w * hm.h); const { w, h, z } = hm; const n = dx.length;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let best = hm.floor;
    for (let k = 0; k < n; k++) {
      const ii = i + dx[k], jj = j + dy[k];
      const zz = (ii < 0 || jj < 0 || ii >= w || jj >= h ? hm.floor : z[jj * w + ii]) - dz[k];
      if (zz > best) best = zz;
    }
    out[j * w + i] = best + stockToLeave;
  }
  return { ...hm, z: out, floor: hm.floor + stockToLeave };
}

/** Bilinear sample of a heightmap at world XY (clamped). */
export function sampleHeightmap(hm: Heightmap, x: number, y: number): number {
  const fx = Math.min(hm.w - 1, Math.max(0, (x - hm.x0) / hm.res)), fy = Math.min(hm.h - 1, Math.max(0, (y - hm.y0) / hm.res));
  const i = Math.min(hm.w - 2, Math.floor(fx)), j = Math.min(hm.h - 2, Math.floor(fy)); const tx = fx - i, ty = fy - j;
  const z = hm.z, w = hm.w;
  const a = z[j * w + i], b = z[j * w + i + 1], c = z[(j + 1) * w + i], d = z[(j + 1) * w + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Marching squares: closed loops bounding the region where hm.z <= level, restricted to cells [i0,i1]x[j0,j1].
 * Returns loops in world coordinates (not oriented; run through normalize()).
 */
export function contoursBelow(hm: Heightmap, level: number, domain?: { i0: number; j0: number; i1: number; j1: number }): Polyline[] {
  const { w, h, res, x0, y0, z } = hm;
  const i0 = domain?.i0 ?? 0, j0 = domain?.j0 ?? 0, i1 = domain?.i1 ?? w - 1, j1 = domain?.j1 ?? h - 1;
  // value with a 1-sample "air" border outside the domain so loops close at the domain edge
  const val = (i: number, j: number) => (i < i0 || j < j0 || i > i1 || j > j1 ? level + 1e6 : z[j * w + i]) - level;
  const segs: Polyline[] = [];
  const interp = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number) => { const t = va / (va - vb); return { x: xa + (xb - xa) * t, y: ya + (yb - ya) * t }; };
  for (let j = j0 - 1; j <= j1; j++) for (let i = i0 - 1; i <= i1; i++) {
    const v00 = val(i, j), v10 = val(i + 1, j), v01 = val(i, j + 1), v11 = val(i + 1, j + 1);
    const idx = (v00 <= 0 ? 1 : 0) | (v10 <= 0 ? 2 : 0) | (v11 <= 0 ? 4 : 0) | (v01 <= 0 ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const X = x0 + i * res, Y = y0 + j * res, X1 = X + res, Y1 = Y + res;
    const bottom = () => interp(X, Y, v00, X1, Y, v10), right = () => interp(X1, Y, v10, X1, Y1, v11), top = () => interp(X, Y1, v01, X1, Y1, v11), left = () => interp(X, Y, v00, X, Y1, v01);
    const add = (a: { x: number; y: number }, b: { x: number; y: number }) => segs.push({ points: [a, b], closed: false });
    switch (idx) {
      case 1: case 14: add(left(), bottom()); break;
      case 2: case 13: add(bottom(), right()); break;
      case 3: case 12: add(left(), right()); break;
      case 4: case 11: add(right(), top()); break;
      case 6: case 9: add(bottom(), top()); break;
      case 7: case 8: add(left(), top()); break;
      case 5: case 10: { const c = (v00 + v10 + v01 + v11) / 4 <= 0; if ((idx === 5) === c) { add(left(), top()); add(bottom(), right()); } else { add(left(), bottom()); add(right(), top()); } break; }
    }
  }
  return chain(segs, res * 0.05).filter(l => l.closed && l.points.length >= 3).map(l => simplify(l, res * 0.15));
}
