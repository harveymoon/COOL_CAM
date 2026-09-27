import type { Job } from '../job.js';
import { getShapes, getTool } from '../job.js';
import type { ProfileOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { type Polyline, isCCW, nearestOnPolyline, perimeter, pointAtLength, reversed, setOrientation, signedArea, simplify } from '../geometry/polyline.js';
import type { Tabs } from '../ops.js';
import { normalize, offsetPolygons } from '../geometry/offset.js';
import { dist } from '../geometry/vec.js';
import type { Vec2 } from '../geometry/vec.js';
import { MoveList, followPath, makeContext, orderByNearest, rotateToNearest } from './common.js';

interface TabInterval { s0: number; s1: number }

/** Tab intervals (arc length along `loop`) for auto or manual tabs, normalised into [0, L) and split at the seam. */
function tabIntervals(loop: Polyline, tabs: Tabs, toolDia: number): TabInterval[] {
  const L = perimeter(loop);
  if (L <= 0) return [];
  const half = tabs.width / 2 + toolDia / 2;
  const centers: number[] = [];
  if (tabs.mode === 'manual') {
    for (const p of tabs.points ?? []) { const n = nearestOnPolyline(loop, p); if (n.dist <= Math.max(toolDia * 2, tabs.width) + 2) centers.push(n.s); }
  } else if (tabs.count > 0) {
    const spacing = L / tabs.count;
    for (let i = 0; i < tabs.count; i++) centers.push(spacing * (i + 0.5));
  }
  const out: TabInterval[] = [];
  for (const c of centers) {
    let s0 = c - half, s1 = c + half;
    if (s1 - s0 >= L) { out.push({ s0: 0, s1: L }); continue; }
    s0 = ((s0 % L) + L) % L; s1 = ((s1 % L) + L) % L;
    if (s0 <= s1) out.push({ s0, s1 }); else { out.push({ s0, s1: L }); out.push({ s0: 0, s1 }); }
  }
  // merge overlaps so events stay well-formed
  out.sort((a, b) => a.s0 - b.s0);
  const merged: TabInterval[] = [];
  for (const iv of out) { const last = merged[merged.length - 1]; if (last && iv.s0 <= last.s1) last.s1 = Math.max(last.s1, iv.s1); else merged.push({ ...iv }); }
  return merged;
}

/** The loops a profile op will cut (offset applied), before orientation. Shared with the viewer for tab markers. */
export function profileLoops(job: Job, op: ProfileOp): Polyline[] {
  const tool = getTool(job, op.toolId);
  const shapes = getShapes(job, op.shapeIds).filter(s => s.polyline.closed).map(s => s.polyline);
  const r = tool.diameter / 2 + (op.stockToLeave ?? 0);
  if (op.side === 'on') return shapes.map(l => simplify(l));
  return offsetPolygons(normalize(shapes), op.side === 'outside' ? r : -r).map(l => simplify(l));
}

/** Centre point and tangent angle of every tab the op will produce (for display). */
export function profileTabCenters(job: Job, op: ProfileOp): { x: number; y: number; angle: number; loop: number }[] {
  const tabs = op.tabs; if (!tabs) return [];
  const tool = getTool(job, op.toolId);
  const out: { x: number; y: number; angle: number; loop: number }[] = [];
  profileLoops(job, op).forEach((loop, li) => {
    const L = perimeter(loop); if (L <= 0) return;
    if (tabs.mode === 'manual') {
      for (const p of tabs.points ?? []) { const n = nearestOnPolyline(loop, p); if (n.dist <= Math.max(tool.diameter * 2, tabs.width) + 2) out.push({ x: n.point.x, y: n.point.y, angle: n.angle, loop: li }); }
    } else if (tabs.count > 0) {
      const spacing = L / tabs.count;
      for (let i = 0; i < tabs.count; i++) { const q = pointAtLength(loop, spacing * (i + 0.5)); out.push({ x: q.point.x, y: q.point.y, angle: q.angle, loop: li }); }
    }
  });
  return out;
}

/** Walk a closed loop at z, lifting to tabZ over tab intervals (measured by arc length). Tool assumed at loop.points[0] at z. */
function followWithTabs(ml: MoveList, loop: Polyline, z: number, tabZ: number, tabs: TabInterval[], feed: number, plungeFeed: number) {
  const pts = loop.points; const n = pts.length;
  const events: { s: number; up: boolean }[] = [];
  for (const t of tabs) { events.push({ s: t.s0, up: true }); events.push({ s: t.s1, up: false }); }
  events.sort((a, b) => a.s - b.s);
  let s = 0; let ei = 0; let atTab = false;
  const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = dist(a, b); if (d === 0) continue;
    let segStart = 0;
    while (ei < events.length && events[ei].s <= s + d + 1e-9) {
      const t = Math.max(0, Math.min(1, (events[ei].s - s) / d));
      const p = lerp(a, b, t);
      const curZ = atTab ? tabZ : z;
      if (t > segStart) ml.cut(p.x, p.y, curZ, feed);
      if (events[ei].up) { ml.cut(p.x, p.y, tabZ, feed); atTab = true; }
      else { ml.plunge(p.x, p.y, z, plungeFeed); atTab = false; }
      segStart = t; ei++;
    }
    ml.cut(b.x, b.y, atTab ? tabZ : z, feed);
    s += d;
  }
}

export function generateProfile(job: Job, op: ProfileOp): Toolpath {
  // NB: tab intervals include the tool radius so the tab is full width after the cutter passes.
  const ctx = makeContext(job, op);
  const shapes = getShapes(job, op.shapeIds);
  const r = ctx.tool.diameter / 2 + (op.stockToLeave ?? 0);
  const climb = (op.direction ?? 'climb') === 'climb';
  const ml = new MoveList(ctx);

  const closedShapes = shapes.filter(s => s.polyline.closed).map(s => s.polyline);
  const openShapes = shapes.filter(s => !s.polyline.closed).map(s => s.polyline);

  let loops: Polyline[] = profileLoops(job, op);
  if (loops.length === 0 && closedShapes.length && op.side !== 'on') ctx.warnings.push(`No toolpath: the ${ctx.tool.diameter} mm tool does not fit ${op.side} the selected shapes.`);
  void r;
  // Orientation: outers CCW (positive area) / holes CW after Clipper. For climb with CW spindle:
  //   material on the right of travel. Outside cut of an outer loop → CW; inside cut (or hole) → CCW.
  loops = loops.map(l => {
    const isOuter = signedArea(l) > 0;
    let ccw: boolean;
    if (op.side === 'outside') ccw = isOuter ? !climb : climb; // outers CW for climb, holes CCW for climb
    else if (op.side === 'inside') ccw = isOuter ? climb : !climb;
    else ccw = isOuter ? !climb : climb;
    return setOrientation(l, ccw);
  });

  const tabs = op.tabs && (op.tabs.mode === 'manual' ? (op.tabs.points?.length ?? 0) > 0 : op.tabs.count > 0) ? op.tabs : undefined;
  const finalZ = ctx.passes[ctx.passes.length - 1] ?? ctx.stockTop;
  const tabZ = finalZ + (tabs?.height ?? 0);

  let cur: Vec2 = { x: 0, y: 0 };
  const ordered = orderByNearest(loops, cur);
  for (const loop0 of ordered) {
    const loop = rotateToNearest(loop0, cur);
    const ivals = tabs ? tabIntervals(loop, tabs, ctx.tool.diameter) : [];
    let prevZ = ctx.stockTop;
    for (let pi = 0; pi < ctx.passes.length; pi++) {
      const z = ctx.passes[pi];
      const p0 = loop.points[0];
      if (pi === 0) ml.moveTo(p0.x, p0.y, z, ctx.stockTop + 0.5);
      else ml.plunge(p0.x, p0.y, z);
      if (tabs && z < tabZ - 1e-6) followWithTabs(ml, loop, z, tabZ, ivals, ctx.feed, ctx.plunge);
      else followPath(ml, loop, z);
      prevZ = z;
    }
    void prevZ;
    ml.retract();
    cur = ml.position;
  }
  // open paths: only meaningful for 'on'
  if (openShapes.length) {
    if (op.side !== 'on') ctx.warnings.push(`${openShapes.length} open shape(s) skipped: profile side '${op.side}' needs closed shapes. Use side 'on' to engrave open paths.`);
    else {
      const paths = orderByNearest(openShapes.map(p => simplify(p)), cur);
      for (const p of paths) {
        const path = dist(p.points[0], cur) <= dist(p.points[p.points.length - 1], cur) ? p : reversed(p);
        for (let pi = 0; pi < ctx.passes.length; pi++) {
          const z = ctx.passes[pi];
          const fwd = pi % 2 === 0 ? path : reversed(path);
          const p0 = fwd.points[0];
          if (pi === 0) ml.moveTo(p0.x, p0.y, z, ctx.stockTop + 0.5); else ml.plunge(p0.x, p0.y, z);
          followPath(ml, fwd, z);
        }
        ml.retract();
        cur = ml.position;
      }
    }
  }
  ml.retract(ctx.safeZ);
  void isCCW;
  return { opId: op.id, opName: op.name ?? `Profile ${op.side}`, toolId: ctx.tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings };
}
