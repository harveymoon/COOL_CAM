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
  // Every crossing point is identified by the grid edge it lies on (an exact integer key), never by coordinate proximity: two
  // distinct contour vertices can sit closer together than any tolerance near a grid corner, and a tolerance-based chainer then
  // joins the wrong pair and leaves a loop open. A dropped loop here would silently turn a hole (the model) into cuttable area.
  type Pt = { x: number; y: number; key: number };
  const segs: [Pt, Pt][] = [];
  const gx = (i: number) => x0 + i * res, gy = (j: number) => y0 + j * res;
  const interp = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number, key: number): Pt => { const t = va / (va - vb); return { x: xa + (xb - xa) * t, y: ya + (yb - ya) * t, key }; };
  const W2 = w + 2; // key space: horizontal edges (i,j) and vertical edges (i,j), each with room for the −1 border
  const hKey = (i: number, j: number) => ((j + 1) * W2 + (i + 1)) * 2, vKey = (i: number, j: number) => ((j + 1) * W2 + (i + 1)) * 2 + 1;
  for (let j = j0 - 1; j <= j1; j++) for (let i = i0 - 1; i <= i1; i++) {
    const v00 = val(i, j), v10 = val(i + 1, j), v01 = val(i, j + 1), v11 = val(i + 1, j + 1);
    const idx = (v00 <= 0 ? 1 : 0) | (v10 <= 0 ? 2 : 0) | (v11 <= 0 ? 4 : 0) | (v01 <= 0 ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const X = gx(i), Y = gy(j), X1 = gx(i + 1), Y1 = gy(j + 1);
    const bottom = () => interp(X, Y, v00, X1, Y, v10, hKey(i, j)), top = () => interp(X, Y1, v01, X1, Y1, v11, hKey(i, j + 1));
    const left = () => interp(X, Y, v00, X, Y1, v01, vKey(i, j)), right = () => interp(X1, Y, v10, X1, Y1, v11, vKey(i + 1, j));
    const add = (a: Pt, b: Pt) => { if (a.key !== b.key) segs.push([a, b]); };
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
  // assemble loops by walking the exact edge keys (every crossing is shared by exactly two cells, so every vertex has even degree)
  const at = new Map<number, number[]>();
  segs.forEach((s, k) => { for (const p of s) { const l = at.get(p.key); if (l) l.push(k); else at.set(p.key, [k]); } });
  const used = new Uint8Array(segs.length);
  const loops: Polyline[] = [];
  let dropped = 0;
  for (let k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const pts: { x: number; y: number }[] = [segs[k0][0]];
    let cur = segs[k0][1]; const startKey = segs[k0][0].key;
    let closed = false;
    for (let guard = 0; guard <= segs.length; guard++) {
      if (cur.key === startKey) { closed = true; break; }
      pts.push({ x: cur.x, y: cur.y });
      const next = (at.get(cur.key) ?? []).find(k => !used[k]);
      if (next === undefined) break;
      used[next] = 1;
      const s = segs[next]; cur = s[0].key === cur.key ? s[1] : s[0];
    }
    if (closed && pts.length >= 3) loops.push({ points: pts, closed: true }); else dropped++;
  }
  if (dropped) throw new Error(`contoursBelow: ${dropped} contour(s) did not close (internal error, refusing to guess the cut region)`);
  return loops.map(l => simplify(l, res * 0.15));
}

/** Exact distance from a point to triangle (a, b, c) — Ericson, Real-Time Collision Detection §5.1.5. */
export function pointTriangleDistance(px: number, py: number, pz: number, P: ArrayLike<number>, i: number): number {
  const ax = P[i], ay = P[i + 1], az = P[i + 2], bx = P[i + 3], by = P[i + 4], bz = P[i + 5], cx = P[i + 6], cy = P[i + 7], cz = P[i + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz; const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(apx - v * abx, apy - v * aby, apz - v * abz); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz; const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(apx - w * acx, apy - w * acy, apz - w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return Math.hypot(px - (bx + w * (cx - bx)), py - (by + w * (cy - by)), pz - (bz + w * (cz - bz))); }
  const denom = 1 / (va + vb + vc); const v = vb * denom, w = vc * denom;
  return Math.hypot(px - (ax + abx * v + acx * w), py - (ay + aby * v + acy * w), pz - (az + abz * v + acz * w));
}

/**
 * Exact point-to-mesh distance with a uniform XY grid over triangle bounding boxes. Used to verify ready-made tool paths:
 * a ball nose of radius r at tip (x, y, z) clears the model by `distance(x, y, z + r) − r` (negative = gouge).
 */
export class MeshDistance {
  private cell: number; private x0: number; private y0: number; private nx: number; private ny: number; private cells: Int32Array[]; private tb: Float64Array;
  constructor(private P: Float32Array | Float64Array, cell = 4) {
    const n = P.length / 9; this.tb = new Float64Array(n * 6);
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (let t = 0; t < n; t++) { const i = t * 9; let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity; for (let k = 0; k < 3; k++) { const x = P[i + k * 3], y = P[i + k * 3 + 1], z = P[i + k * 3 + 2]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z; } this.tb[t * 6] = x0; this.tb[t * 6 + 1] = y0; this.tb[t * 6 + 2] = z0; this.tb[t * 6 + 3] = x1; this.tb[t * 6 + 4] = y1; this.tb[t * 6 + 5] = z1; if (x0 < gx0) gx0 = x0; if (y0 < gy0) gy0 = y0; if (x1 > gx1) gx1 = x1; if (y1 > gy1) gy1 = y1; }
    this.cell = cell; this.x0 = gx0; this.y0 = gy0; this.nx = Math.max(1, Math.ceil((gx1 - gx0) / cell) + 1); this.ny = Math.max(1, Math.ceil((gy1 - gy0) / cell) + 1);
    const buckets: number[][] = Array.from({ length: this.nx * this.ny }, () => []);
    for (let t = 0; t < n; t++) { const o = t * 6; const i0 = this.ix(this.tb[o]), i1 = this.ix(this.tb[o + 3]), j0 = this.iy(this.tb[o + 1]), j1 = this.iy(this.tb[o + 4]); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * this.nx + i].push(t); }
    this.cells = buckets.map(b => Int32Array.from(b));
  }
  private ix(x: number) { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.cell))); }
  private iy(y: number) { return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.y0) / this.cell))); }
  /** Distance from (x, y, z) to the nearest triangle, searching outward in rings of grid cells until nothing closer can exist. */
  distance(x: number, y: number, z: number, maxSearch = 50): number {
    let best = Infinity;
    const ci = this.ix(x), cj = this.iy(y);
    for (let ring = 0; ring * this.cell - this.cell <= Math.min(best, maxSearch); ring++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        if (j < 0 || j >= this.ny) continue;
        for (let i = ci - ring; i <= ci + ring; i++) {
          if (i < 0 || i >= this.nx) continue;
          if (Math.abs(i - ci) !== ring && Math.abs(j - cj) !== ring) continue; // only the ring's perimeter
          for (const t of this.cells[j * this.nx + i]) {
            const o = t * 6;
            if (x < this.tb[o] - best || x > this.tb[o + 3] + best || y < this.tb[o + 1] - best || y > this.tb[o + 4] + best || z < this.tb[o + 2] - best || z > this.tb[o + 5] + best) continue;
            const d = pointTriangleDistance(x, y, z, this.P, t * 9); if (d < best) best = d;
          }
        }
      }
    }
    return best;
  }
}
