import { type Polyline, circle } from './geometry/polyline.js';

/** Convenience constructors so a job can be designed without importing a drawing. */
export function rect(x: number, y: number, w: number, h: number, cornerRadius = 0): Polyline {
  if (cornerRadius <= 0) return { points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true };
  const r = Math.min(cornerRadius, w / 2, h / 2);
  const pts = [] as { x: number; y: number }[];
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 8; i++) { const a = a0 + (Math.PI / 2) * (i / 8); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return { points: pts, closed: true };
}

export function circleShape(cx: number, cy: number, diameter: number): Polyline {
  return circle(cx, cy, diameter / 2, 0.005);
}

export function polygon(points: { x: number; y: number }[], closed = true): Polyline {
  return { points: points.map(p => ({ x: p.x, y: p.y })), closed };
}

export function regularPolygon(cx: number, cy: number, sides: number, circumDiameter: number, rotationDeg = 0): Polyline {
  const r = circumDiameter / 2; const pts = [] as { x: number; y: number }[];
  for (let i = 0; i < sides; i++) { const a = (rotationDeg * Math.PI) / 180 + (i / sides) * Math.PI * 2; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return { points: pts, closed: true };
}

export function slot(x1: number, y1: number, x2: number, y2: number, width: number): Polyline {
  const r = width / 2; const dx = x2 - x1, dy = y2 - y1; const L = Math.hypot(dx, dy) || 1; const a = Math.atan2(dy, dx);
  const pts = [] as { x: number; y: number }[];
  for (let i = 0; i <= 12; i++) { const t = a - Math.PI / 2 + (Math.PI * i) / 12; pts.push({ x: x2 + r * Math.cos(t), y: y2 + r * Math.sin(t) }); }
  for (let i = 0; i <= 12; i++) { const t = a + Math.PI / 2 + (Math.PI * i) / 12; pts.push({ x: x1 + r * Math.cos(t), y: y1 + r * Math.sin(t) }); }
  void L;
  return { points: pts, closed: true };
}

import type { ShapeParams } from './job.js';
/** Rebuild the polyline of a parametric (non-text) shape. Returns null for kinds this module cannot build. */
export function polylineFromParams(p: ShapeParams): Polyline | null {
  switch (p.kind) {
    case 'rect': return rect(p.x, p.y, p.w, p.h, p.r);
    case 'circle': return circleShape(p.cx, p.cy, p.d);
    case 'regular_polygon': return regularPolygon(p.cx, p.cy, p.sides, p.d, p.rot);
    case 'slot': return slot(p.x1, p.y1, p.x2, p.y2, p.w);
    default: return null;
  }
}
/**
 * Scale a shape's parameters about (cx, cy) by kx / ky. Returns undefined when the primitive cannot express the result
 * (a circle or regular polygon scaled non-uniformly, text), in which case the caller drops the parameters.
 */
export function scaleParams(p: ShapeParams, cx: number, cy: number, kx: number, ky: number): ShapeParams | undefined {
  const uniform = Math.abs(kx - ky) < 1e-9;
  const sx = (x: number) => cx + (x - cx) * kx, sy = (y: number) => cy + (y - cy) * ky;
  switch (p.kind) {
    case 'rect': { const x0 = Math.min(sx(p.x), sx(p.x + p.w)), y0 = Math.min(sy(p.y), sy(p.y + p.h)); return { ...p, x: x0, y: y0, w: p.w * Math.abs(kx), h: p.h * Math.abs(ky), r: Math.min(p.r * Math.min(Math.abs(kx), Math.abs(ky)), (p.w * Math.abs(kx)) / 2, (p.h * Math.abs(ky)) / 2) }; }
    case 'circle': return uniform ? { ...p, cx: sx(p.cx), cy: sy(p.cy), d: p.d * Math.abs(kx) } : undefined;
    case 'regular_polygon': return uniform ? { ...p, cx: sx(p.cx), cy: sy(p.cy), d: p.d * Math.abs(kx) } : undefined;
    case 'slot': return uniform ? { ...p, x1: sx(p.x1), y1: sy(p.y1), x2: sx(p.x2), y2: sy(p.y2), w: p.w * Math.abs(kx) } : undefined;
    default: return undefined;
  }
}
/** Translate a shape's parameters (used when moving parametric shapes). */
export function translateParams(p: ShapeParams, dx: number, dy: number): ShapeParams {
  switch (p.kind) {
    case 'rect': return { ...p, x: p.x + dx, y: p.y + dy };
    case 'circle': case 'regular_polygon': return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case 'slot': return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    case 'text': return { ...p, x: p.x + dx, y: p.y + dy };
  }
}
