import type { Vec2 } from '../geometry/vec.js';
import { dist } from '../geometry/vec.js';
import { type Polyline, pointInPolygon } from '../geometry/polyline.js';
import type { Move, MoveKind } from '../toolpath.js';
import type { OpBase } from '../ops.js';
import type { Job } from '../job.js';
import { getTool, stockBounds } from '../job.js';
import type { Tool } from '../tools.js';

export interface OpContext {
  job: Job;
  tool: Tool;
  rpm: number;
  feed: number;
  plunge: number;
  safeZ: number;
  clearanceZ: number;
  stockTop: number;
  stockBottom: number;
  /** Z levels to cut, from first pass to final (absolute). */
  passes: number[];
  warnings: string[];
}

export function makeContext(job: Job, op: OpBase): OpContext {
  const tool = getTool(job, op.toolId);
  const b = stockBounds(job.stock);
  const rpm = op.rpm ?? tool.rpm ?? 18000;
  const feed = op.feed ?? tool.feed ?? 1000;
  const plunge = op.plunge ?? tool.plunge ?? Math.round(feed * 0.4);
  const start = op.startDepth ?? 0;
  const dpp = op.depthPerPass && op.depthPerPass > 0 ? op.depthPerPass : tool.diameter;
  const total = op.depth - start;
  const passes: number[] = [];
  const warnings: string[] = [];
  if (total <= 0) warnings.push(`Depth (${op.depth}) must exceed start depth (${start}); nothing to cut.`);
  else {
    const n = Math.ceil(total / dpp - 1e-9);
    for (let i = 1; i <= n; i++) passes.push(b.top - Math.min(op.depth, start + i * dpp));
  }
  if (tool.fluteLength && op.depth > tool.fluteLength) warnings.push(`Depth ${op.depth} mm exceeds flute length ${tool.fluteLength} mm of ${tool.name}.`);
  if (op.depth > job.stock.thickness + 1e-6) warnings.push(`Depth ${op.depth} mm is deeper than the stock (${job.stock.thickness} mm). The cutter will hit the wasteboard.`);
  return { job, tool, rpm, feed, plunge, safeZ: b.top + job.safeZ, clearanceZ: b.top + job.clearanceZ, stockTop: b.top, stockBottom: b.bottom, passes, warnings };
}

export class MoveList {
  moves: Move[] = [];
  private cur = { x: NaN, y: NaN, z: NaN };
  constructor(private ctx: OpContext) {}
  get position() { return { ...this.cur }; }
  rapid(x: number, y: number, z: number) { this.push('rapid', x, y, z); }
  cut(x: number, y: number, z: number, f = this.ctx.feed) { this.push('cut', x, y, z, f); }
  plunge(x: number, y: number, z: number, f = this.ctx.plunge) { this.push('plunge', x, y, z, f); }
  ramp(x: number, y: number, z: number, f = this.ctx.feed) { this.push('ramp', x, y, z, f); }
  retract(z = this.ctx.clearanceZ) { if (!isNaN(this.cur.x)) this.push('retract', this.cur.x, this.cur.y, Math.max(z, this.cur.z)); }
  /** Retract to clearance, rapid over, rapid down to just above the previous cut level then plunge. */
  moveTo(x: number, y: number, z: number, safeApproachZ: number) {
    this.retract();
    this.rapid(x, y, this.ctx.clearanceZ);
    if (safeApproachZ > z) this.rapid(x, y, safeApproachZ);
    this.plunge(x, y, z);
  }
  private push(kind: MoveKind, x: number, y: number, z: number, f?: number) {
    if (Math.abs(x - this.cur.x) < 1e-6 && Math.abs(y - this.cur.y) < 1e-6 && Math.abs(z - this.cur.z) < 1e-6) return;
    this.moves.push(f === undefined ? { kind, x, y, z } : { kind, x, y, z, f });
    this.cur = { x, y, z };
  }
}

/** Even-odd containment for a set of loops. */
export function insideRegion(pt: Vec2, region: Polyline[]): boolean {
  let inside = false;
  for (const p of region) if (pointInPolygon(pt, p)) inside = !inside;
  return inside;
}

/** Whether the straight segment a→b (sampled) lies within region. */
export function segmentInside(a: Vec2, b: Vec2, region: Polyline[], step = 0.5): boolean {
  const n = Math.max(2, Math.ceil(dist(a, b) / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!insideRegion({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, region)) return false;
  }
  return true;
}

/** Rotate a closed loop so it starts at the vertex nearest `p`. */
export function rotateToNearest(loop: Polyline, p: Vec2): Polyline {
  let best = 0, bd = Infinity;
  loop.points.forEach((q, i) => { const d = dist(q, p); if (d < bd) { bd = d; best = i; } });
  return { points: [...loop.points.slice(best), ...loop.points.slice(0, best)], closed: true };
}

/** Nearest-neighbour ordering of loops by their first point starting from `from`. */
export function orderByNearest<T extends { points: Vec2[] }>(items: T[], from: Vec2): T[] {
  const left = [...items]; const out: T[] = []; let cur = from;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((it, i) => { const d = dist(it.points[0], cur); if (d < bd) { bd = d; bi = i; } });
    const it = left.splice(bi, 1)[0]; out.push(it); cur = it.points[it.points.length - 1];
  }
  return out;
}

/** Cut along a loop (closed) or path (open) at constant Z, assuming the tool is already at the first point at depth. */
export function followPath(ml: MoveList, path: Polyline, z: number, feed?: number) {
  const pts = path.points;
  for (let i = 1; i < pts.length; i++) ml.cut(pts[i].x, pts[i].y, z, feed);
  if (path.closed) ml.cut(pts[0].x, pts[0].y, z, feed);
}

/** Helical entry: descend from zFrom to zTo around center with radius r, then finish at (center + r, 0) at depth. Returns false if no room. */
export function helixEntry(ml: MoveList, center: Vec2, r: number, zFrom: number, zTo: number, pitch: number, feed: number) {
  const depth = zFrom - zTo;
  const turns = Math.max(1, Math.ceil(depth / pitch));
  const segPerTurn = 24;
  const total = turns * segPerTurn;
  ml.rapid(center.x + r, center.y, zFrom);
  for (let i = 1; i <= total; i++) {
    const a = (i / segPerTurn) * Math.PI * 2;
    const z = zFrom - (depth * i) / total;
    ml.ramp(center.x + r * Math.cos(a), center.y + r * Math.sin(a), z, feed);
  }
  // final flat circle to clean the bottom
  for (let i = 1; i <= segPerTurn; i++) {
    const a = (i / segPerTurn) * Math.PI * 2;
    ml.cut(center.x + r * Math.cos(a), center.y + r * Math.sin(a), zTo, feed);
  }
}
