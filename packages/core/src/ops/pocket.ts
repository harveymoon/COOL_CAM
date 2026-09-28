import type { Job } from '../job.js';
import { getShapes, getTool } from '../job.js';
import type { PocketOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { type Polyline, setOrientation, signedArea, simplify, pointInPolygon } from '../geometry/polyline.js';
import { normalize, offsetPolygons, difference, intersection } from '../geometry/offset.js';
import type { Vec2 } from '../geometry/vec.js';
import { dist } from '../geometry/vec.js';
import { MoveList, followPath, helixEntry, insideRegion, makeContext, orderByNearest, rotateToNearest, segmentInside } from './common.js';

interface Ring { level: number; loop: Polyline; group: number }

export function generatePocket(job: Job, op: PocketOp): Toolpath {
  const ctx = makeContext(job, op);
  const shapes = getShapes(job, op.shapeIds);
  const tool = ctx.tool;
  const r = tool.diameter / 2;
  const stl = op.stockToLeave ?? 0;
  const stepover = op.stepover && op.stepover > 0 ? Math.min(op.stepover, tool.diameter * 0.95) : tool.diameter * 0.4;
  const climb = (op.direction ?? 'climb') === 'climb';
  const ml = new MoveList(ctx);

  const region = normalize(shapes.filter(s => s.polyline.closed).map(s => s.polyline));
  if (region.length === 0) { ctx.warnings.push('Pocket needs at least one closed shape.'); return empty(op, ctx); }

  // Tool-centre allowed region and the ring family.
  let allowed = offsetPolygons(region, -(r + stl));
  if (allowed.length === 0) { ctx.warnings.push(`No toolpath: ${tool.diameter} mm tool does not fit in the pocket.`); return empty(op, ctx); }
  if (op.restToolId) {
    // rest machining: keep only what the earlier tool left behind (its reach = region eroded then dilated by its radius)
    const prev = getTool(job, op.restToolId); const R = prev.diameter / 2 + stl;
    if (prev.diameter <= tool.diameter) ctx.warnings.push(`Rest machining: previous tool ${prev.name} is not larger than ${tool.name}; nothing is left to cut.`);
    const reached = offsetPolygons(offsetPolygons(region, -R).filter(l => Math.abs(signedArea(l)) > 0.5), R + 0.02);
    const leftover = difference(region, reached).filter(l => Math.abs(signedArea(l)) > 0.2);
    if (!leftover.length) { ctx.warnings.push('Rest machining: the previous tool already reached everything.'); return empty(op, ctx); }
    // tool-centre region for the leftover: within the pocket's allowed area and within a tool diameter of the leftover
    allowed = intersection(allowed, offsetPolygons(leftover, tool.diameter));
    if (!allowed.length) { ctx.warnings.push(`Rest machining: ${tool.name} cannot reach the leftover areas either.`); return empty(op, ctx); }
  }
  const rings = ringsFor(allowed, stepover, climb, r);

  const finishLoops = op.finishPass && stl > 0 ? offsetPolygons(region, -r).map(l => setOrientation(simplify(l), signedArea(l) > 0 ? climb : !climb)) : [];

  let cur: Vec2 = { x: 0, y: 0 };
  let prevZ = ctx.stockTop;
  for (const z of ctx.passes) {
    cur = clearRings(ml, ctx, rings, allowed, z, prevZ, { stepover, entry: op.entry ?? 'helix', cur });
    for (const fl0 of orderByNearest(finishLoops, cur)) {
      const fl = rotateToNearest(fl0, cur);
      ml.moveTo(fl.points[0].x, fl.points[0].y, z, prevZ + 0.5);
      followPath(ml, fl, z);
      ml.retract();
      cur = ml.position;
    }
    prevZ = z;
  }
  ml.retract(ctx.safeZ);
  return { opId: op.id, opName: op.name ?? 'Pocket', toolId: tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings, stepdown: ctx.stepdown };
}

export interface ClearOptions { stepover: number; entry: 'plunge' | 'helix' | 'ramp'; cur: Vec2; climb?: boolean }

/**
 * Build the concentric ring family for a tool-centre region (level 0 = region boundary itself).
 *
 * Coverage: a point at distance d from the region boundary is within (d − k·s) of ring k, so with a stepover s ≤ r every point is
 * within r of some ring. With s > r that only holds where ring k+1 exists locally: in a neck of the region narrower than 2(k+1)s
 * the next ring vanishes and a strip between k·s + r and (k+1)·s is left standing (the same happens at the core inside the
 * innermost ring). With `toolRadius` given, every such gap gets a fill ring at k·s + 0.9r, which covers up to k·s + 1.9r ≥ (k+1)·s
 * because the stepover is capped at 0.95·D. Fill rings sort between ring k+1 and ring k (fractional level) so cutting stays
 * innermost-first.
 */
export function ringsFor(allowed: Polyline[], stepover: number, climb = true, toolRadius?: number): Ring[] {
  const outers = allowed.filter(l => signedArea(l) > 0);
  const rings: Ring[] = [];
  const add = (level: number, loops: Polyline[]) => { for (const loop of loops) { const group = outers.findIndex(o => pointInPolygon(loop.points[0], o)); rings.push({ level, loop: simplify(loop), group: Math.max(0, group) }); } };
  const levels: Polyline[][] = [];
  for (let level = 0; ; level++) {
    const loops = level === 0 ? allowed : offsetPolygons(allowed, -level * stepover);
    if (loops.length === 0) break;
    levels.push(loops); add(level, loops);
    if (level > 5000) break;
  }
  if (toolRadius && stepover > toolRadius * 0.9) {
    const r = toolRadius;
    for (let k = 0; k < levels.length; k++) {
      // what ring k leaves: farther than r inside it, and not within r of the next ring's region
      const beyond = offsetPolygons(allowed, -(k * stepover + r)).filter(l => Math.abs(signedArea(l)) > 0.01);
      if (!beyond.length) continue;
      const next = levels[k + 1] ? offsetPolygons(levels[k + 1], r + 0.02) : [];
      const gap = (next.length ? difference(beyond, next) : beyond).filter(l => Math.abs(signedArea(l)) > 0.05);
      if (!gap.length) continue;
      const fill = offsetPolygons(allowed, -(k * stepover + 0.9 * r)).filter(l => Math.abs(signedArea(l)) > 0.01);
      if (fill.length) add(k + 0.5, fill);
    }
  }
  for (const rg of rings) rg.loop = setOrientation(rg.loop, signedArea(rg.loop) > 0 ? climb : !climb);
  return rings;
}

/** Clear a tool-centre region at one Z level (rings innermost-first per island group). Returns the end position. */
export function clearRegion(ml: MoveList, ctx: ReturnType<typeof makeContext>, allowed: Polyline[], z: number, prevZ: number, opts: ClearOptions): Vec2 {
  return clearRings(ml, ctx, ringsFor(allowed, opts.stepover, opts.climb ?? true, ctx.tool.diameter / 2), allowed, z, prevZ, opts);
}

function clearRings(ml: MoveList, ctx: ReturnType<typeof makeContext>, rings: Ring[], allowed: Polyline[], z: number, prevZ: number, opts: ClearOptions): Vec2 {
  const groups = new Map<number, Ring[]>();
  for (const rg of rings) { const g = groups.get(rg.group) ?? []; g.push(rg); groups.set(rg.group, g); }
  let cur = opts.cur; const r = ctx.tool.diameter / 2;
  for (const [, grp] of groups) {
    const levels = [...new Set(grp.map(g => g.level))].sort((a, b) => b - a);
    let first = true;
    for (const lv of levels) {
      const loops = orderByNearest(grp.filter(g => g.level === lv).map(g => g.loop), cur);
      for (const loop0 of loops) {
        const loop = rotateToNearest(loop0, cur);
        const p0 = loop.points[0];
        if (first) { enter(ml, ctx, opts.entry, p0, r, opts.stepover, prevZ, z, allowed, loop); first = false; }
        else {
          const at = ml.position;
          if (Math.abs(at.z - z) < 1e-6 && segmentInside({ x: at.x, y: at.y }, p0, allowed)) ml.cut(p0.x, p0.y, z);
          else ml.moveTo(p0.x, p0.y, z, prevZ + 0.5);
        }
        followPath(ml, loop, z);
        cur = ml.position;
      }
    }
    ml.retract();
  }
  return cur;
}

function enter(ml: MoveList, ctx: ReturnType<typeof makeContext>, entry: 'plunge' | 'helix' | 'ramp', p0: Vec2, r: number, stepover: number, prevZ: number, z: number, allowed: Polyline[], loop: Polyline) {
  const approach = prevZ + 0.5;
  if (entry === 'helix') {
    // helix radius: fits inside the tool-centre region around p0
    let hr = Math.min(r * 0.8, stepover);
    let center = p0;
    const fits = (c: Vec2, rad: number) => { for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; if (!insideRegion({ x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) }, allowed)) return false; } return true; };
    // move centre inward along the loop's local normal if needed
    while (hr > 0.3 && !fits(center, hr)) hr *= 0.7;
    if (hr > 0.3) {
      ml.retract();
      ml.rapid(center.x + hr, center.y, ctx.clearanceZ);
      ml.rapid(center.x + hr, center.y, approach);
      helixEntry(ml, center, hr, approach, z, Math.max(0.5, ctx.tool.diameter * 0.15), ctx.plunge * 1.5);
      ml.cut(p0.x, p0.y, z);
      return;
    }
    ctx.warnings.push('Helix entry did not fit; plunged instead.');
  }
  if (entry === 'ramp') {
    const pts = loop.points; const rampLen = Math.max(3 * r, (prevZ - z) / Math.tan((3 * Math.PI) / 180));
    ml.retract(); ml.rapid(p0.x, p0.y, ctx.clearanceZ); ml.rapid(p0.x, p0.y, approach);
    // zig-zag along the first segment(s)
    let len = 0; const segs: { a: Vec2; b: Vec2 }[] = [];
    for (let i = 0; i < pts.length && len < rampLen; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push({ a, b }); len += dist(a, b); }
    const total = Math.min(len, rampLen); const depth = approach - z;
    let done = 0; let curZ = approach;
    const walk = (fwd: boolean, portion: number) => {
      const list = fwd ? segs : [...segs].reverse();
      for (const sgm of list) { const a = fwd ? sgm.a : sgm.b, b = fwd ? sgm.b : sgm.a; const d = dist(a, b); if (d === 0) continue; const n = Math.max(1, Math.ceil(d / 2)); for (let k = 1; k <= n; k++) { const t = k / n; curZ = Math.max(z, curZ - (portion * depth * d) / (total * n)); ml.ramp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, curZ, ctx.feed); } }
      done += portion;
    };
    walk(true, 0.5); walk(false, 0.5);
    ml.cut(p0.x, p0.y, z);
    void done;
    return;
  }
  ml.moveTo(p0.x, p0.y, z, approach);
}

function empty(op: PocketOp, ctx: ReturnType<typeof makeContext>): Toolpath {
  return { opId: op.id, opName: op.name ?? 'Pocket', toolId: ctx.tool.id, rpm: ctx.rpm, moves: [], warnings: ctx.warnings, stepdown: ctx.stepdown };
}
