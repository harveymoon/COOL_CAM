import { type Polyline, arcPoints, chain, cubicPoints, quadPoints } from '../geometry/polyline.js';
import type { Vec2 } from '../geometry/vec.js';

/**
 * Minimal SVG importer (no DOM required): path, rect, circle, ellipse, line, polyline, polygon, with transforms.
 * Output is in mm. Unit handling: if width/height carry mm/in units and a viewBox exists, scale from viewBox to physical size;
 * otherwise assume 96 px per inch. Y axis is flipped so +Y is up (CNC convention): page bottom-left becomes the origin when a viewBox exists.
 */
export interface SvgImportOptions { tolerance?: number; pxPerInch?: number; flipY?: boolean }

type Mat = [number, number, number, number, number, number]; // a b c d e f
const I: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, p: Vec2): Vec2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

function parseTransform(s: string | undefined): Mat {
  if (!s) return I;
  let m = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
    let t: Mat = I;
    switch (r[1]) {
      case 'matrix': t = [a[0], a[1], a[2], a[3], a[4], a[5]]; break;
      case 'translate': t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': {
        const th = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
        t = [c, sn, -sn, c, 0, 0];
        if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': t = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, t);
  }
  return m;
}

interface El { tag: string; attrs: Record<string, string>; children: El[] }

/** Tiny XML parser sufficient for SVG. */
function parseXml(text: string): El {
  const root: El = { tag: 'root', attrs: {}, children: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(text))) {
    if (r[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (!r[2]) continue;
    const attrs: Record<string, string> = {};
    const ar = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a: RegExpExecArray | null;
    while ((a = ar.exec(r[3] ?? ''))) attrs[a[1]] = a[2] ?? a[3] ?? '';
    const el: El = { tag: r[2], attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!r[4]) stack.push(el);
  }
  return root;
}

function pathToPolylines(d: string, tol: number): Polyline[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Polyline[] = [];
  let cur: Vec2[] = []; let closed = false;
  let pos: Vec2 = { x: 0, y: 0 }, start: Vec2 = { x: 0, y: 0 }, lastCtrl: Vec2 | null = null, lastCmd = '';
  let i = 0; let cmd = '';
  const flush = () => { if (cur.length > 1) out.push({ points: cur, closed }); cur = []; closed = false; };
  const n = () => parseFloat(toks[i++]);
  const isNum = () => i < toks.length && !/[a-zA-Z]/.test(toks[i]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const P = (x: number, y: number): Vec2 => rel ? { x: pos.x + x, y: pos.y + y } : { x, y };
    switch (cmd.toUpperCase()) {
      case 'M': { flush(); const p = P(n(), n()); pos = p; start = p; cur = [p]; lastCtrl = null; break; }
      case 'L': { const p = P(n(), n()); cur.push(p); pos = p; lastCtrl = null; break; }
      case 'H': { const x = n(); const p = rel ? { x: pos.x + x, y: pos.y } : { x, y: pos.y }; cur.push(p); pos = p; lastCtrl = null; break; }
      case 'V': { const y = n(); const p = rel ? { x: pos.x, y: pos.y + y } : { x: pos.x, y }; cur.push(p); pos = p; lastCtrl = null; break; }
      case 'C': { const c1 = P(n(), n()), c2 = P(n(), n()), p = P(n(), n()); cur.push(...cubicPoints(pos, c1, c2, p)); lastCtrl = c2; pos = p; break; }
      case 'S': { const c1: Vec2 = lastCtrl && /[CS]/i.test(lastCmd) ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y } : pos; const c2 = P(n(), n()), p = P(n(), n()); cur.push(...cubicPoints(pos, c1, c2, p)); lastCtrl = c2; pos = p; break; }
      case 'Q': { const c1 = P(n(), n()), p = P(n(), n()); cur.push(...quadPoints(pos, c1, p)); lastCtrl = c1; pos = p; break; }
      case 'T': { const c1: Vec2 = lastCtrl && /[QT]/i.test(lastCmd) ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y } : pos; const p = P(n(), n()); cur.push(...quadPoints(pos, c1, p)); lastCtrl = c1; pos = p; break; }
      case 'A': {
        let rx = Math.abs(n()), ry = Math.abs(n()); const phi = (n() * Math.PI) / 180; const fa = n() !== 0, fs = n() !== 0; const p = P(n(), n());
        if (rx === 0 || ry === 0) { cur.push(p); pos = p; break; }
        // endpoint -> center parameterisation (SVG spec F.6.5)
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const dx = (pos.x - p.x) / 2, dy = (pos.y - p.y) / 2;
        const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
        const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
        if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
        const sq = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
        const sgn = fa === fs ? -1 : 1;
        const cxp = (sgn * sq * rx * y1) / ry, cyp = (-sgn * sq * ry * x1) / rx;
        const cx = cp * cxp - sp * cyp + (pos.x + p.x) / 2, cy = sp * cxp + cp * cyp + (pos.y + p.y) / 2;
        const ang = (ux: number, uy: number, vx: number, vy: number) => { const s = Math.sign(ux * vy - uy * vx) || 1; return s * Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))))); };
        const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
        let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
        if (!fs && dt > 0) dt -= 2 * Math.PI; if (fs && dt < 0) dt += 2 * Math.PI;
        const seg = Math.max(4, Math.ceil(Math.abs(dt) / (2 * Math.acos(1 - tol / Math.max(rx, ry)))));
        for (let k = 1; k <= seg; k++) {
          const t = t1 + (dt * k) / seg; const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
          cur.push({ x: cp * ex - sp * ey + cx, y: sp * ex + cp * ey + cy });
        }
        pos = p; lastCtrl = null; break;
      }
      case 'Z': { closed = true; flush(); pos = start; cur = [start]; lastCtrl = null; break; }
      default: i++;
    }
    lastCmd = cmd;
    if (cmd.toUpperCase() === 'Z' && !isNum()) { cur = []; }
  }
  flush();
  return out;
}

function shapeToPolylines(el: El, tol: number): Polyline[] {
  const a = el.attrs; const f = (k: string, d = 0) => (a[k] !== undefined ? parseFloat(a[k]) : d);
  switch (el.tag) {
    case 'path': return a.d ? pathToPolylines(a.d, tol) : [];
    case 'rect': {
      const x = f('x'), y = f('y'), w = f('width'), h = f('height'); let rx = f('rx', f('ry')), ry = f('ry', rx);
      if (rx <= 0 || ry <= 0) return [{ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true }];
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      const corner = (cx: number, cy: number, a0: number) => arcPoints(0, 0, 1, a0, a0 + Math.PI / 2, tol / Math.max(rx, ry)).map(p => ({ x: cx + p.x * rx, y: cy + p.y * ry }));
      return [{ points: [
        ...corner(x + w - rx, y + h - ry, 0), ...corner(x + rx, y + h - ry, Math.PI / 2), ...corner(x + rx, y + ry, Math.PI), ...corner(x + w - rx, y + ry, 1.5 * Math.PI),
      ], closed: true }];
    }
    case 'circle': { const r = f('r'); return [{ points: arcPoints(f('cx'), f('cy'), r, 0, 2 * Math.PI, tol, false), closed: true }]; }
    case 'ellipse': { const rx = f('rx'), ry = f('ry'); const n = Math.max(24, Math.ceil(2 * Math.PI / (2 * Math.acos(1 - tol / Math.max(rx, ry))))); const pts: Vec2[] = []; for (let k = 0; k < n; k++) { const t = (2 * Math.PI * k) / n; pts.push({ x: f('cx') + rx * Math.cos(t), y: f('cy') + ry * Math.sin(t) }); } return [{ points: pts, closed: true }]; }
    case 'line': return [{ points: [{ x: f('x1'), y: f('y1') }, { x: f('x2'), y: f('y2') }], closed: false }];
    case 'polyline': case 'polygon': {
      const nums = (a.points ?? '').split(/[\s,]+/).filter(Boolean).map(parseFloat); const pts: Vec2[] = [];
      for (let k = 0; k + 1 < nums.length; k += 2) pts.push({ x: nums[k], y: nums[k + 1] });
      return [{ points: pts, closed: el.tag === 'polygon' }];
    }
    default: return [];
  }
}

function lengthToMm(s: string | undefined, pxPerInch: number): number | null {
  if (!s) return null;
  const m = /^([\d.]+)\s*(mm|cm|in|px|pt)?$/.exec(s.trim()); if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2]) { case 'mm': return v; case 'cm': return v * 10; case 'in': return v * 25.4; case 'pt': return (v / 72) * 25.4; default: return (v / pxPerInch) * 25.4; }
}

export function parseSvg(text: string, opts: SvgImportOptions = {}): Polyline[] {
  const tol = opts.tolerance ?? 0.01, ppi = opts.pxPerInch ?? 96;
  const root = parseXml(text);
  const svg = root.children.find(c => c.tag === 'svg') ?? root;
  const out: Polyline[] = [];
  const walk = (el: El, m: Mat) => {
    const mm = mul(m, parseTransform(el.attrs.transform));
    if (el.tag === 'defs' || el.tag === 'clipPath' || el.tag === 'mask' || el.attrs.display === 'none') return;
    for (const p of shapeToPolylines(el, tol)) out.push({ points: p.points.map(q => apply(mm, q)), closed: p.closed });
    for (const c of el.children) walk(c, mm);
  };
  walk(svg, I);
  // units
  let scaleX = 25.4 / ppi, scaleY = 25.4 / ppi;
  const vb = (svg.attrs.viewBox ?? '').split(/[\s,]+/).filter(Boolean).map(parseFloat);
  const wmm = lengthToMm(svg.attrs.width, ppi), hmm = lengthToMm(svg.attrs.height, ppi);
  if (vb.length === 4 && wmm && hmm) { scaleX = wmm / vb[2]; scaleY = hmm / vb[3]; }
  let polys = out.map(p => ({ points: p.points.map(q => ({ x: q.x * scaleX, y: q.y * scaleY })), closed: p.closed }));
  if (opts.flipY !== false) {
    // Flip about the page height when a viewBox exists (keeps page layout), else about the content's extent.
    let maxY = -Infinity;
    if (vb.length === 4) maxY = (vb[1] + vb[3]) * scaleY;
    else for (const p of polys) for (const q of p.points) maxY = Math.max(maxY, q.y);
    polys = polys.map(p => ({ points: p.points.map(q => ({ x: q.x, y: maxY - q.y })), closed: p.closed }));
  }
  return chain(polys, 0.01);
}
