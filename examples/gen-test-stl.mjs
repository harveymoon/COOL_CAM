// Generates simple test STLs for a 13 mm board: none taller than 12 mm.
// Run: node examples/gen-test-stl.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'stl');
fs.mkdirSync(OUT, { recursive: true });
const INCH = 25.4;

// ---------- helpers ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

class Mesh {
  constructor() { this.tris = []; }
  /** Add a triangle; if `outward` is given, flip so the normal points toward it (away from the interior point). */
  tri(a, b, c, outwardRef) {
    const snap = (p) => p.map(v => { const r = Math.round(v * 1e5) / 1e5; return r === 0 ? 0 : r; });
    a = snap(a); b = snap(b); c = snap(c);
    let n = norm(cross(sub(b, a), sub(c, a)));
    if (!isFinite(n[0]) || (n[0] === 0 && n[1] === 0 && n[2] === 0)) return; // degenerate
    if (outwardRef) { const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]; if (dot(n, sub(centroid, outwardRef)) < 0) { [b, c] = [c, b]; n = norm(cross(sub(b, a), sub(c, a))); } }
    this.tris.push([n, a, b, c]);
  }
  /** Fan-triangulate a convex polygon. */
  poly(pts, outwardRef) { for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1], outwardRef); }
  /** Triangulate the ring between two loops that are both star-shaped about the origin (angle-sorted merge). */
  ring(inner, outer, outwardRef) {
    const ang = (p) => Math.atan2(p[1], p[0]);
    const I = [...inner].sort((a, b) => ang(a) - ang(b)), O = [...outer].sort((a, b) => ang(a) - ang(b));
    const unwrapped = (P) => { const a = P.map(ang); const out = [a[0]]; for (let k = 1; k < a.length; k++) out.push(a[k] < out[k - 1] ? a[k] + 2 * Math.PI : a[k]); out.push(out[0] + 2 * Math.PI); return out; };
    const aI = unwrapped(I), aO = unwrapped(O);
    let ci = 0, cj = 0;
    while (ci < I.length || cj < O.length) {
      const advI = cj >= O.length || (ci < I.length && aI[ci + 1] <= aO[cj + 1]);
      const i = ci % I.length, j = cj % O.length;
      if (advI) { this.tri(I[i], O[j], I[(i + 1) % I.length], outwardRef); ci++; }
      else { this.tri(I[i], O[j], O[(j + 1) % O.length], outwardRef); cj++; }
    }
  }
  bbox() { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const [, a, b, c] of this.tris) for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } return { mn, mx }; }
  /** Every edge must be shared by exactly two triangles in opposite directions. */
  check() {
    const key = (p) => p.map(v => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4)).join(',');
    const edges = new Map();
    for (const [, a, b, c] of this.tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = key(p) + '>' + key(q); edges.set(k, (edges.get(k) ?? 0) + 1); }
    let bad = 0; for (const [k, n] of edges) { const [p, q] = k.split('>'); if (n !== 1 || (edges.get(q + '>' + p) ?? 0) !== 1) bad++; }
    return bad;
  }
  writeBinary(file) {
    const bad = this.check();
    const buf = Buffer.alloc(84 + this.tris.length * 50);
    buf.write('Cool CAM test model', 0, 'ascii'); buf.writeUInt32LE(this.tris.length, 80);
    let o = 84;
    for (const [n, a, b, c] of this.tris) { for (const v of [n, a, b, c]) for (const x of v) { buf.writeFloatLE(x, o); o += 4; } buf.writeUInt16LE(0, o); o += 2; }
    fs.writeFileSync(file, buf);
    const { mn, mx } = this.bbox();
    console.log(`${path.basename(file)}: ${this.tris.length} tris, ${(mx[0] - mn[0]).toFixed(1)} x ${(mx[1] - mn[1]).toFixed(1)} x ${(mx[2] - mn[2]).toFixed(1)} mm, ${bad === 0 ? 'watertight' : bad + ' bad edges'}`);
  }
}

// ---------- 1. spherical cap: 2" diameter, 12 mm tall ----------
function domeCap() {
  const r = INCH, h = 12; const R = (r * r + h * h) / (2 * h); // sphere radius
  const zc = h - R; // sphere centre below the base plane
  const m = new Mesh(); const inside = [0, 0, h / 2];
  const rings = 24, segs = 96;
  const phiMax = Math.acos((0 - zc) / R); // polar angle at the base
  const pt = (i, j) => { const phi = (phiMax * i) / rings, th = (2 * Math.PI * j) / segs; return [R * Math.sin(phi) * Math.cos(th), R * Math.sin(phi) * Math.sin(th), i === rings ? 0 : zc + R * Math.cos(phi)]; };
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    if (i === 0) m.tri(a, b, c, inside); else { m.tri(a, b, c, inside); m.tri(a, c, d, inside); }
  }
  const base = []; for (let j = 0; j < segs; j++) base.push(pt(rings, j));
  m.poly(base, inside);
  return m;
}

// ---------- 2. dodecahedron, face up, 2" wide, sliced to the top 12 mm ----------
function halfDodecahedron(targetWidth = INCH * 2, scaleFix = 1) {
  const phi = (1 + Math.sqrt(5)) / 2, ip = 1 / phi;
  const V = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]);
  for (const s of [-1, 1]) for (const t of [-1, 1]) { V.push([0, s * ip, t * phi]); V.push([s * ip, t * phi, 0]); V.push([s * phi, 0, t * ip]); }
  const N = [];
  for (const s of [-1, 1]) for (const t of [-1, 1]) { N.push(norm([s, 0, t * phi])); N.push(norm([0, s * phi, t])); N.push(norm([s * phi, t, 0])); }
  // rotate so N[0]-like face (0,1,phi) points +Z
  const up = norm([1, 0, phi]); const z = [0, 0, 1];
  const axis = norm(cross(up, z)); const angle = Math.acos(dot(up, z));
  const rot = (p) => { // Rodrigues
    const c = Math.cos(angle), s = Math.sin(angle); const k = axis; const kxp = cross(k, p); const kdp = dot(k, p);
    return [p[0] * c + kxp[0] * s + k[0] * kdp * (1 - c), p[1] * c + kxp[1] * s + k[1] * kdp * (1 - c), p[2] * c + kxp[2] * s + k[2] * kdp * (1 - c)];
  };
  let verts = V.map(rot); const normals = N.map(rot);
  // scale to 2" across in X
  let mn = Infinity, mx = -Infinity; for (const v of verts) { mn = Math.min(mn, v[0]); mx = Math.max(mx, v[0]); }
  const s = (targetWidth / (mx - mn)) * scaleFix; verts = verts.map(v => v.map(x => x * s));
  const zmax = Math.max(...verts.map(v => v[2])); const zc = zmax - 12;
  // faces: 5 vertices with max dot to each normal, ordered by angle around the normal
  const faces = normals.map(n => {
    const ranked = verts.map(v => ({ v, d: dot(v, n) })).sort((a, b) => b.d - a.d).slice(0, 5).map(o => o.v);
    const c = ranked.reduce((a, v) => [a[0] + v[0] / 5, a[1] + v[1] / 5, a[2] + v[2] / 5], [0, 0, 0]);
    const u = norm(sub(ranked[0], c)); const w = cross(n, u);
    return ranked.sort((a, b) => Math.atan2(dot(sub(a, c), w), dot(sub(a, c), u)) - Math.atan2(dot(sub(b, c), w), dot(sub(b, c), u)));
  });
  const m = new Mesh(); const inside = [0, 0, (zmax + zc) / 2 + 1];
  const capPts = [];
  for (const f of faces) {
    // Sutherland–Hodgman clip against z >= zc
    const out = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length]; const ina = a[2] >= zc, inb = b[2] >= zc;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (zc - a[2]) / (b[2] - a[2]); const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, zc]; out.push(p); capPts.push(p); }
    }
    if (out.length >= 3) m.poly(out, inside);
  }
  // bottom cap: unique points sorted by angle
  const uniq = []; for (const p of capPts) if (!uniq.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)) uniq.push(p);
  uniq.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  m.poly(uniq, inside);
  // shift so the base sits at z = 0
  for (const t of m.tris) for (let k = 1; k <= 3; k++) t[k] = [t[k][0], t[k][1], t[k][2] - zc];
  return m;
}

// ---------- 3. squat square frustum: 2" base, 20 mm top, 12 mm tall ----------
function squatPyramid() {
  const b = INCH, t = 10, h = 12; const m = new Mesh(); const inside = [0, 0, h / 2];
  const B = [[-b, -b, 0], [b, -b, 0], [b, b, 0], [-b, b, 0]], T = [[-t, -t, h], [t, -t, h], [t, t, h], [-t, t, h]];
  m.poly(B, inside); m.poly(T, inside);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; m.poly([B[i], B[j], T[j], T[i]], inside); }
  return m;
}

// ---------- 4. round coaster with a faceted 5-point star recess ----------
function starRelief() {
  const R = 35, h = 12, depth = 6, outerR = 22, innerR = 9; const m = new Mesh(); const inside = [0, 0, h / 2];
  const star = []; for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + (k * Math.PI) / 5; const r = k % 2 === 0 ? outerR : innerR; star.push([r * Math.cos(a), r * Math.sin(a), h]); }
  const segs = 120; const rim = [], base = [];
  for (let j = 0; j < segs; j++) { const a = (2 * Math.PI * j) / segs; rim.push([R * Math.cos(a), R * Math.sin(a), h]); base.push([R * Math.cos(a), R * Math.sin(a), 0]); }
  // top annulus between star outline and rim
  m.ring(star, rim, [0, 0, -1000]); // normals must point +Z: reference far below
  // recess: 10 sloped facets meeting at the centre point
  const apex = [0, 0, h - depth];
  for (let k = 0; k < 10; k++) { const a = star[k], b = star[(k + 1) % 10]; const n = norm(cross(sub(b, a), sub(apex, a))); if (n[2] < 0) m.tri(a, apex, b); else m.tri(a, b, apex); }
  // wall + bottom
  for (let j = 0; j < segs; j++) { const k = (j + 1) % segs; m.poly([base[j], base[k], rim[k], rim[j]], inside); }
  m.poly(base, inside);
  return m;
}

domeCap().writeBinary(path.join(OUT, 'dome-cap-2in-12mm.stl'));
{ // scale so the sliced piece (not the whole solid) is 2" across; the slice width is nonlinear in scale, so iterate
  let fix = 1;
  for (let k = 0; k < 40; k++) { const { mn, mx } = halfDodecahedron(INCH * 2, fix).bbox(); fix *= (INCH * 2) / Math.max(mx[0] - mn[0], mx[1] - mn[1]); }
  halfDodecahedron(INCH * 2, fix).writeBinary(path.join(OUT, 'half-dodecahedron-2in-12mm.stl'));
}
squatPyramid().writeBinary(path.join(OUT, 'squat-pyramid-2in-12mm.stl'));
starRelief().writeBinary(path.join(OUT, 'star-coaster-70mm-12mm.stl'));
