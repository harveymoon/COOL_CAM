import { type Polyline, arcPoints, chain, circle } from '../geometry/polyline.js';
import type { Vec2 } from '../geometry/vec.js';

/**
 * Minimal DXF (ASCII) importer: LINE, LWPOLYLINE (with bulges), POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE, SPLINE.
 * Units are taken as-is ($INSUNITS honoured: 1=inch → converted to mm, otherwise assumed mm).
 */
export interface DxfImportOptions { tolerance?: number; chainTolerance?: number; toMm?: boolean }

interface Pair { code: number; value: string }

function pairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    out.push({ code, value: lines[i + 1].trim() });
  }
  return out;
}

type Ent = { type: string; data: Map<number, string[]> };

function collectEntities(ps: Pair[]): { entities: Ent[]; insunits: number } {
  const entities: Ent[] = [];
  let insunits = 0;
  let section = '';
  let cur: Ent | null = null;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.code === 0 && p.value === 'SECTION') { section = ps[i + 1]?.value ?? ''; continue; }
    if (p.code === 0 && p.value === 'ENDSEC') { section = ''; cur = null; continue; }
    if (section === 'HEADER' && p.code === 9 && p.value === '$INSUNITS') { insunits = parseInt(ps[i + 1]?.value ?? '0', 10); }
    if (section !== 'ENTITIES') continue;
    if (p.code === 0) {
      cur = { type: p.value, data: new Map() };
      entities.push(cur);
    } else if (cur) {
      const arr = cur.data.get(p.code) ?? [];
      arr.push(p.value); cur.data.set(p.code, arr);
    }
  }
  return { entities, insunits };
}

const num = (e: Ent, code: number, i = 0, dflt = 0) => { const v = e.data.get(code)?.[i]; return v === undefined ? dflt : parseFloat(v); };
const nums = (e: Ent, code: number) => (e.data.get(code) ?? []).map(parseFloat);

function bulgeArc(a: Vec2, b: Vec2, bulge: number, tol: number): Vec2[] {
  // bulge = tan(theta/4). Positive = CCW.
  const theta = 4 * Math.atan(bulge);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d === 0 || Math.abs(theta) < 1e-9) return [b];
  const r = d / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
  const nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d;
  const sign = (theta > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const cx = mx + sign * h * nx, cy = my + sign * h * ny;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const pts = arcPoints(cx, cy, r, a0, a0 + theta, tol, true);
  pts.shift();
  return pts;
}

/** De Boor evaluation of a NURBS curve. */
function evalNurbs(deg: number, ctrl: Vec2[], knots: number[], weights: number[] | undefined, u: number): Vec2 {
  const n = ctrl.length - 1;
  let k = -1;
  for (let i = deg; i <= n; i++) if (u >= knots[i] && u < knots[i + 1]) { k = i; break; }
  if (k < 0) k = n;
  const w = weights ?? ctrl.map(() => 1);
  const d = [] as { x: number; y: number; w: number }[];
  for (let j = 0; j <= deg; j++) { const c = ctrl[k - deg + j]; const ww = w[k - deg + j]; d.push({ x: c.x * ww, y: c.y * ww, w: ww }); }
  for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
    const i = k - deg + j;
    const den = knots[i + deg - r + 1] - knots[i];
    const alpha = den === 0 ? 0 : (u - knots[i]) / den;
    d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x, y: (1 - alpha) * d[j - 1].y + alpha * d[j].y, w: (1 - alpha) * d[j - 1].w + alpha * d[j].w };
  }
  return { x: d[deg].x / d[deg].w, y: d[deg].y / d[deg].w };
}

export function parseDxf(text: string, opts: DxfImportOptions = {}): Polyline[] {
  const tol = opts.tolerance ?? 0.01;
  const { entities, insunits } = collectEntities(pairs(text));
  const raw: Polyline[] = [];
  for (let idx = 0; idx < entities.length; idx++) {
    const e = entities[idx];
    switch (e.type) {
      case 'LINE':
        raw.push({ points: [{ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }], closed: false });
        break;
      case 'LWPOLYLINE': {
        const xs = nums(e, 10), ys = nums(e, 20);
        const flags = num(e, 70);
        const closed = (flags & 1) === 1;
        // bulge (42) is per-vertex but optional; rebuild by scanning original order is lost — approximate: if count matches use it.
        const bulges = nums(e, 42);
        const pts: Vec2[] = [];
        const useBulge = bulges.length === xs.length;
        for (let i = 0; i < xs.length; i++) {
          const a = { x: xs[i], y: ys[i] };
          if (i === 0) pts.push(a); 
          const nextIdx = i + 1 < xs.length ? i + 1 : (closed ? 0 : -1);
          if (nextIdx < 0) break;
          const b = { x: xs[nextIdx], y: ys[nextIdx] };
          const bl = useBulge ? bulges[i] : 0;
          if (bl !== 0) pts.push(...bulgeArc(a, b, bl, tol)); else if (nextIdx !== 0) pts.push(b);
        }
        raw.push({ points: pts, closed });
        break;
      }
      case 'POLYLINE': {
        const flags = num(e, 70);
        const closed = (flags & 1) === 1;
        const pts: Vec2[] = [];
        let j = idx + 1;
        while (j < entities.length && entities[j].type === 'VERTEX') { pts.push({ x: num(entities[j], 10), y: num(entities[j], 20) }); j++; }
        if (j < entities.length && entities[j].type === 'SEQEND') j++;
        idx = j - 1;
        raw.push({ points: pts, closed });
        break;
      }
      case 'CIRCLE':
        raw.push(circle(num(e, 10), num(e, 20), num(e, 40), tol));
        break;
      case 'ARC': {
        const a0 = (num(e, 50) * Math.PI) / 180; let a1 = (num(e, 51) * Math.PI) / 180;
        if (a1 <= a0) a1 += Math.PI * 2;
        raw.push({ points: arcPoints(num(e, 10), num(e, 20), num(e, 40), a0, a1, tol), closed: false });
        break;
      }
      case 'ELLIPSE': {
        const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 0, 1);
        const a0 = num(e, 41, 0, 0), a1 = num(e, 42, 0, Math.PI * 2);
        const rx = Math.hypot(mx, my), ry = rx * ratio, rot = Math.atan2(my, mx);
        const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
        const n = Math.max(16, Math.ceil(Math.abs(a1 - a0) / (2 * Math.acos(1 - tol / Math.max(rx, ry)))));
        const pts: Vec2[] = [];
        for (let i = 0; i <= (full ? n - 1 : n); i++) {
          const t = a0 + ((a1 - a0) * i) / n;
          const px = rx * Math.cos(t), py = ry * Math.sin(t);
          pts.push({ x: cx + px * Math.cos(rot) - py * Math.sin(rot), y: cy + px * Math.sin(rot) + py * Math.cos(rot) });
        }
        raw.push({ points: pts, closed: full });
        break;
      }
      case 'SPLINE': {
        const deg = num(e, 71, 0, 3);
        const flags = num(e, 70);
        const closed = (flags & 1) === 1;
        const knots = nums(e, 40);
        const cxs = nums(e, 10), cys = nums(e, 20);
        const weights = e.data.has(41) ? nums(e, 41) : undefined;
        const ctrl = cxs.map((x, i) => ({ x, y: cys[i] }));
        if (ctrl.length > deg && knots.length >= ctrl.length + deg + 1) {
          const u0 = knots[deg], u1 = knots[ctrl.length];
          const n = Math.max(24, ctrl.length * 12);
          const pts: Vec2[] = [];
          for (let i = 0; i <= n; i++) pts.push(evalNurbs(deg, ctrl, knots, weights, u0 + ((u1 - u0) * i) / n * (i === n ? 0.999999 : 1)));
          raw.push({ points: pts, closed });
        } else {
          const fx = nums(e, 11), fy = nums(e, 21);
          if (fx.length) raw.push({ points: fx.map((x, i) => ({ x, y: fy[i] })), closed });
        }
        break;
      }
      default: break;
    }
  }
  let result = chain(raw, opts.chainTolerance ?? 0.01);
  if (opts.toMm !== false && insunits === 1) result = result.map(p => ({ points: p.points.map(q => ({ x: q.x * 25.4, y: q.y * 25.4 })), closed: p.closed }));
  return result;
}
