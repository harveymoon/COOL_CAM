// A 2.5D "bracket" test part for feature extraction: 60x40x12 plate with a pocket, a step, a counterbore and two through holes.
// Run after `npm run build`: node examples/gen-bracket-stl.mjs
import fs from 'node:fs';
import path from 'node:path';
import earcutMod from 'earcut';
import * as C from '../packages/core/dist/index.js';
const earcut = earcutMod.default ?? earcutMod;

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'stl');
const H = 12;
const footprint = C.normalize([C.rect(0, 0, 60, 40, 6)]);
const pocket = C.normalize([C.rect(8, 12, 26, 16, 3)]);
const step = C.normalize([C.rect(46, -1, 15, 42)]);           // right-hand step, 6 deep → floor at z = 6
const bore = C.normalize([C.circleShape(20, 34, 10)]);        // counterbore 3 deep → floor at z = 9
const holes = C.normalize([C.circleShape(40, 8, 6.5), C.circleShape(40, 32, 6.5)]);
const stepIn = C.intersection(step, footprint);
const tops = [
  { h: H, polys: C.difference(C.difference(C.difference(C.difference(footprint, pocket), stepIn), bore), holes) },
  { h: 7, polys: C.difference(pocket, holes) },
  { h: 6, polys: C.difference(stepIn, holes) },
  { h: 9, polys: bore },
];
// bottom face: same outline as the footprint, but with every top-region vertex that lies on it inserted so walls match edge-for-edge (no T-junctions)
const onSegment = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy; if (L2 === 0) return false; const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; if (t <= 1e-6 || t >= 1 - 1e-6) return false; const qx = a.x + dx * t, qy = a.y + dy * t; return Math.hypot(p.x - qx, p.y - qy) < 1e-4; };
const insertOnEdges = (poly, pts) => { let out = poly.points.slice(); let changed = true; while (changed) { changed = false; for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; const cand = pts.filter(p => onSegment(p, a, b)).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)); if (cand.length) { out.splice(i + 1, 0, cand[0]); changed = true; break; } } } return { points: out, closed: true }; };
const allTopPts = tops.flatMap(r => r.polys.flatMap(p => p.points));
const bottomPolys = C.difference(footprint, holes).map(p => insertOnEdges(p, allTopPts));
const regions = [...tops, { h: 0, polys: bottomPolys, bottom: true }];

const tris = [];
const snap = v => Math.round(v * 1e5) / 1e5;
const addTri = (a, b, c) => tris.push([a, b, c].map(p => p.map(snap)));
// planar faces via earcut (outer + holes)
for (const r of regions) {
  const outers = r.polys.filter(p => C.signedArea(p) > 0), inner = r.polys.filter(p => C.signedArea(p) < 0);
  for (const o of outers) {
    const myHoles = inner.filter(hl => C.pointInPolygon(hl.points[0], o));
    const coords = []; const holeIdx = [];
    for (const p of o.points) coords.push(p.x, p.y);
    for (const hl of myHoles) { holeIdx.push(coords.length / 2); for (const p of hl.points) coords.push(p.x, p.y); }
    const idx = earcut(coords, holeIdx);
    for (let i = 0; i < idx.length; i += 3) {
      const P = k => [coords[idx[k] * 2], coords[idx[k] * 2 + 1], r.h];
      if (r.bottom) addTri(P(i), P(i + 2), P(i + 1)); else addTri(P(i), P(i + 1), P(i + 2));
    }
  }
}
// walls: for every boundary edge of every region, find the height just outside that edge and drop a wall from the higher side
const heightAt = (x, y) => { let best = -1; for (const r of regions) if (r.bottom) continue; else { let inside = false; for (const p of r.polys) if (C.pointInPolygon({ x, y }, p)) inside = !inside; if (inside) best = Math.max(best, r.h); } return best; };
for (const r of regions) {
  if (r.bottom) continue;
  for (const poly of r.polys) {
    const pts = poly.points; const ccw = C.signedArea(poly) > 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2; const dx = q.x - p.x, dy = q.y - p.y; const L = Math.hypot(dx, dy) || 1;
      // outward normal: for CCW loops interior is on the left, so outward = right = (dy, -dx); holes are CW so the same formula points into the hole (outside the region)
      const nx = dy / L, ny = -dx / L; void ccw;
      const hOut = heightAt(mx + nx * 0.05, my + ny * 0.05); const hOutside = hOut < 0 ? 0 : hOut;
      if (r.h <= hOutside) continue;
      const a = [p.x, p.y, r.h], b = [q.x, q.y, r.h], c = [q.x, q.y, hOutside], d = [p.x, p.y, hOutside];
      // wall normal should point outward (toward n)
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), 0];
      if (n[0] * nx + n[1] * ny < 0) { addTri(a, c, b); addTri(a, d, c); } else { addTri(a, b, c); addTri(a, c, d); }
    }
  }
}
// write binary STL + watertight check
const buf = Buffer.alloc(84 + tris.length * 50); buf.write('Cool CAM bracket', 0, 'ascii'); buf.writeUInt32LE(tris.length, 80);
let o = 84;
for (const [a, b, c] of tris) { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l); for (const vv of [n, a, b, c]) for (const x of vv) { buf.writeFloatLE(x, o); o += 4; } buf.writeUInt16LE(0, o); o += 2; }
const key = p => p.map(v => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4)).join(','); const edges = new Map();
for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = key(p) + '>' + key(q); edges.set(k, (edges.get(k) ?? 0) + 1); }
let bad = 0; for (const [k, n] of edges) { const [p, q] = k.split('>'); if (n !== 1 || (edges.get(q + '>' + p) ?? 0) !== 1) bad++; }
fs.writeFileSync(path.join(OUT, 'bracket-2p5d-12mm.stl'), buf);
console.log(`bracket-2p5d-12mm.stl: ${tris.length} tris, ${bad === 0 ? 'watertight' : bad + ' bad edges'}`);
