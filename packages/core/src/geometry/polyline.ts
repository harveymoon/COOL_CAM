import { type Vec2, cross, dist, eq, sub } from './vec.js';

/** A 2D polyline. Closed polylines are implicit loops (last point connects to first). */
export interface Polyline {
  points: Vec2[];
  closed: boolean;
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export function bbox(polys: Polyline[] | Polyline): BBox {
  const list = Array.isArray(polys) ? polys : [polys];
  const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of list) for (const q of p.points) {
    if (q.x < b.minX) b.minX = q.x; if (q.x > b.maxX) b.maxX = q.x;
    if (q.y < b.minY) b.minY = q.y; if (q.y > b.maxY) b.maxY = q.y;
  }
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
}

/** Signed area (shoelace). Positive = counter-clockwise. */
export function signedArea(p: Polyline): number {
  const pts = p.points; let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

export const isCCW = (p: Polyline): boolean => signedArea(p) > 0;

export function reversed(p: Polyline): Polyline {
  return { points: [...p.points].reverse(), closed: p.closed };
}

export function setOrientation(p: Polyline, ccw: boolean): Polyline {
  return isCCW(p) === ccw ? p : reversed(p);
}

export function perimeter(p: Polyline): number {
  const pts = p.points; let l = 0;
  const n = p.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) l += dist(pts[i], pts[(i + 1) % pts.length]);
  return l;
}

/** Point in polygon (even-odd). */
export function pointInPolygon(pt: Vec2, poly: Polyline): boolean {
  const pts = poly.points; let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Remove consecutive duplicate points and (for closed) a trailing point equal to the first. */
export function dedupe(p: Polyline, eps = 1e-6): Polyline {
  const out: Vec2[] = [];
  for (const q of p.points) if (out.length === 0 || !eq(out[out.length - 1], q, eps)) out.push(q);
  if (p.closed && out.length > 1 && eq(out[0], out[out.length - 1], eps)) out.pop();
  return { points: out, closed: p.closed };
}

/** Simplify with a global tolerance (Douglas–Peucker). Closed loops are split at their two farthest points. */
export function simplify(p: Polyline, tol = 1e-4): Polyline {
  const pts = dedupe(p, Math.max(1e-9, tol * 0.5)).points;
  if (pts.length < 3) return { points: pts, closed: p.closed };
  const dp = (a: number, b: number, keep: boolean[]) => {
    const stack: [number, number][] = [[a, b]];
    while (stack.length) {
      const [i, j] = stack.pop()!; if (j - i < 2) continue;
      const A = pts[i], B = pts[j]; const dx = B.x - A.x, dy = B.y - A.y; const L = Math.hypot(dx, dy);
      let worst = -1, wi = -1;
      for (let k = i + 1; k < j; k++) {
        const P = pts[k];
        const d = L === 0 ? Math.hypot(P.x - A.x, P.y - A.y) : Math.abs(dx * (A.y - P.y) - (A.x - P.x) * dy) / L;
        if (d > worst) { worst = d; wi = k; }
      }
      if (worst > tol) { keep[wi] = true; stack.push([i, wi], [wi, j]); }
    }
  };
  const keep = new Array<boolean>(pts.length).fill(false);
  if (!p.closed) {
    keep[0] = keep[pts.length - 1] = true; dp(0, pts.length - 1, keep);
  } else {
    // anchor on the point farthest from pts[0], then the point farthest from that chord's ends
    let far = 0, fd = -1; for (let k = 1; k < pts.length; k++) { const d = dist(pts[0], pts[k]); if (d > fd) { fd = d; far = k; } }
    keep[0] = keep[far] = true; dp(0, far, keep);
    // second half wraps around: rotate indices so the segment far..0 is contiguous
    const rot = [...pts.slice(far), ...pts.slice(0, far + 1)];
    const keep2 = new Array<boolean>(rot.length).fill(false); keep2[0] = keep2[rot.length - 1] = true;
    const saved = pts.slice(); pts.length = 0; pts.push(...rot); dp(0, rot.length - 1, keep2); pts.length = 0; pts.push(...saved);
    for (let k = 1; k < rot.length - 1; k++) if (keep2[k]) keep[(far + k) % saved.length] = true;
  }
  const out = pts.filter((_, k) => keep[k]);
  return { points: out.length >= (p.closed ? 3 : 2) ? out : pts, closed: p.closed };
}

/** Chain open polylines whose endpoints coincide (within tol) into longer polylines, closing loops when they return to start. */
export function chain(polys: Polyline[], tol = 0.01): Polyline[] {
  const closed: Polyline[] = [];
  let open: Polyline[] = [];
  for (const p of polys) {
    const d = dedupe(p, 1e-9);
    if (d.points.length < 2) continue;
    if (d.closed) { closed.push(d); continue; }
    if (dist(d.points[0], d.points[d.points.length - 1]) <= tol && d.points.length > 2) { d.points.pop(); closed.push({ points: d.points, closed: true }); continue; }
    open.push(d);
  }
  const result = [...closed];
  while (open.length) {
    let cur = open.shift()!.points.slice();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i].points;
        const head = cur[0], tail = cur[cur.length - 1];
        if (dist(tail, o[0]) <= tol) { cur = cur.concat(o.slice(1)); }
        else if (dist(tail, o[o.length - 1]) <= tol) { cur = cur.concat(o.slice(0, -1).reverse()); }
        else if (dist(head, o[o.length - 1]) <= tol) { cur = o.slice(0, -1).concat(cur); }
        else if (dist(head, o[0]) <= tol) { cur = o.slice(1).reverse().concat(cur); }
        else continue;
        open.splice(i, 1); grew = true; break;
      }
      if (cur.length > 2 && dist(cur[0], cur[cur.length - 1]) <= tol) { cur.pop(); result.push({ points: cur, closed: true }); cur = []; break; }
    }
    if (cur.length >= 2) result.push({ points: cur, closed: false });
  }
  return result;
}

export function translate(p: Polyline, dx: number, dy: number): Polyline {
  return { points: p.points.map(q => ({ x: q.x + dx, y: q.y + dy })), closed: p.closed };
}

export function transformAll(polys: Polyline[], fn: (v: Vec2) => Vec2): Polyline[] {
  return polys.map(p => ({ points: p.points.map(fn), closed: p.closed }));
}

/** Sample an arc into points. Angles in radians, CCW positive. Does not include the end point if `includeEnd` is false. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, tol = 0.01, includeEnd = true): Vec2[] {
  const sweep = a1 - a0;
  const stepMax = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 2;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / Math.min(stepMax, Math.PI / 6)));
  const pts: Vec2[] = [];
  for (let i = 0; i <= (includeEnd ? n : n - 1); i++) {
    const a = a0 + (sweep * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

export function circle(cx: number, cy: number, r: number, tol = 0.01): Polyline {
  return { points: arcPoints(cx, cy, r, 0, Math.PI * 2, tol, false), closed: true };
}

/** Flatten a cubic bezier. */
export function cubicPoints(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, segments = 16): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments, mt = 1 - t;
    out.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

export function quadPoints(p0: Vec2, p1: Vec2, p2: Vec2, segments = 12): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments, mt = 1 - t;
    out.push({ x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x, y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y });
  }
  return out;
}

/** Nearest point on a polyline to `p`: the point, its arc length `s` from the start, and the distance. */
export function nearestOnPolyline(poly: Polyline, p: Vec2): { point: Vec2; s: number; dist: number; angle: number } {
  const pts = poly.points; const n = poly.closed ? pts.length : pts.length - 1;
  let best = { point: pts[0] ?? { x: 0, y: 0 }, s: 0, dist: Infinity, angle: 0 }; let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]; const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    const q = { x: a.x + dx * t, y: a.y + dy * t }; const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.dist) best = { point: q, s: acc + Math.sqrt(L2) * t, dist: d, angle: Math.atan2(dy, dx) };
    acc += Math.sqrt(L2);
  }
  return best;
}

/** Point and tangent angle at arc length `s` along a polyline (wraps for closed loops). */
export function pointAtLength(poly: Polyline, s: number): { point: Vec2; angle: number } {
  const pts = poly.points; const n = poly.closed ? pts.length : pts.length - 1; const L = perimeter(poly);
  if (L === 0) return { point: pts[0], angle: 0 };
  let rem = ((s % L) + L) % L;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]; const d = dist(a, b);
    if (rem <= d || i === n - 1) { const t = d === 0 ? 0 : rem / d; return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: Math.atan2(b.y - a.y, b.x - a.x) }; }
    rem -= d;
  }
  return { point: pts[0], angle: 0 };
}
