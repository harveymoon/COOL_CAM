import type { Job } from '../job.js';
import { getShapes, getTool } from '../job.js';
import type { ProfileOp } from '../ops.js';
import type { Toolpath } from '../toolpath.js';
import { type Polyline, nearestOnPolyline, perimeter, pointAtLength, reversed, setOrientation, signedArea, simplify, walkLoop } from '../geometry/polyline.js';
import type { Tabs } from '../ops.js';
import { normalize, offsetPolygons } from '../geometry/offset.js';
import { dist } from '../geometry/vec.js';
import type { Vec2 } from '../geometry/vec.js';
import { MoveList, followPath, makeContext, orderByNearest, rotateToNearest } from './common.js';

interface TabInterval { s0: number; s1: number }

/** A cut loop with its tab centres (world XY) and tab intervals (arc length along the loop, from its start). */
export interface PreparedLoop { loop: Polyline; centers: { x: number; y: number; angle: number }[]; ivals: TabInterval[] }

const mod = (s: number, L: number) => ((s % L) + L) % L;

/** Normalise an [s0, s1] range into [0, L) intervals, splitting at the seam. */
function pushRange(out: TabInterval[], s0: number, s1: number, L: number) {
  if (s1 - s0 >= L - 1e-9) { out.push({ s0: 0, s1: L }); return; }
  s0 = mod(s0, L); s1 = mod(s1, L);
  if (s0 <= s1) out.push({ s0, s1 }); else { out.push({ s0, s1: L }); out.push({ s0: 0, s1 }); }
}

/** Sort and merge overlapping intervals so tab events stay well-formed. */
function mergeIntervals(out: TabInterval[]): TabInterval[] {
  out.sort((a, b) => a.s0 - b.s0);
  const merged: TabInterval[] = [];
  for (const iv of out) { const last = merged[merged.length - 1]; if (last && iv.s0 <= last.s1 + 1e-9) last.s1 = Math.max(last.s1, iv.s1); else merged.push({ ...iv }); }
  return merged;
}

/** Tab intervals for fixed world-space tab centres projected onto `loop`. The interval includes the tool radius so the tab is full width after the cutter passes. */
function intervalsFromCenters(loop: Polyline, centers: Vec2[], tabs: Tabs, toolDia: number): TabInterval[] {
  const L = perimeter(loop);
  if (L <= 0) return [];
  const half = tabs.width / 2 + toolDia / 2;
  const out: TabInterval[] = [];
  for (const c of centers) { const n = nearestOnPolyline(loop, c); pushRange(out, n.s - half, n.s + half, L); }
  return mergeIntervals(out);
}

/** Re-express intervals measured from arc length 0 of a loop for the same loop restarted at arc length `shift`. */
function shiftIntervals(ivals: TabInterval[], shift: number, L: number): TabInterval[] {
  if (shift === 0) return ivals;
  const out: TabInterval[] = [];
  for (const iv of ivals) pushRange(out, iv.s0 - shift, iv.s1 - shift, L);
  return mergeIntervals(out);
}

/** Whether the arc-length range [from, from + len] (wrapping) touches any interval. */
function rangeHits(ivals: TabInterval[], from: number, len: number, L: number): boolean {
  const probe: TabInterval[] = []; pushRange(probe, from, from + len, L);
  return probe.some(p => ivals.some(iv => iv.s0 <= p.s1 + 1e-9 && iv.s1 >= p.s0 - 1e-9));
}

/** Rotate a closed loop so it starts at the point at arc length `s` (inserting that point as a vertex). */
export function rotateLoopAt(loop: Polyline, s: number): Polyline {
  const pts = loop.points, n = pts.length; const L = perimeter(loop);
  if (L <= 0 || n < 2) return loop;
  let rem = mod(s, L);
  if (rem < 1e-9) return loop;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n]; const d = dist(a, b);
    if (rem <= d + 1e-9 || i === n - 1) {
      const t = d === 0 ? 0 : Math.min(1, rem / d);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const after = pts.slice(i + 1).concat(pts.slice(0, i + 1)); // b … a
      const out: Vec2[] = [p];
      for (const q of after) if (dist(q, out[out.length - 1]) > 1e-9) out.push(q);
      if (out.length > 1 && dist(out[0], out[out.length - 1]) <= 1e-9) out.pop();
      return { points: out, closed: true };
    }
    rem -= d;
  }
  return loop;
}

/** The loops a profile op will cut (offset applied), before orientation. */
export function profileLoops(job: Job, op: ProfileOp): Polyline[] {
  const tool = getTool(job, op.toolId);
  const shapes = getShapes(job, op.shapeIds).filter(s => s.polyline.closed).map(s => s.polyline);
  const r = tool.diameter / 2 + (op.stockToLeave ?? 0);
  if (op.side === 'on') return shapes.map(l => simplify(l));
  return offsetPolygons(normalize(shapes), op.side === 'outside' ? r : -r).map(l => simplify(l));
}

const activeTabs = (op: ProfileOp): Tabs | undefined => op.tabs && (op.tabs.mode === 'manual' ? (op.tabs.points?.length ?? 0) > 0 : op.tabs.count > 0) ? op.tabs : undefined;

/**
 * The loops exactly as generateProfile will cut them: oriented for climb/conventional, ordered nearest-first from the origin,
 * each started at the vertex nearest the previous loop, and with the seam moved out of any tab so plunges never sever one.
 * Shared with the viewer so tab markers sit where the tabs are actually left.
 */
export function prepareProfileLoops(job: Job, op: ProfileOp): PreparedLoop[] {
  const tool = getTool(job, op.toolId);
  const climb = (op.direction ?? 'climb') === 'climb';
  const tabs = activeTabs(op);
  // Orientation: outers CCW (positive area) / holes CW after Clipper. For climb with CW spindle:
  //   material on the right of travel. Outside cut of an outer loop → CW; inside cut (or hole) → CCW.
  const loops = profileLoops(job, op).map(l => {
    const isOuter = signedArea(l) > 0;
    let ccw: boolean;
    if (op.side === 'outside') ccw = isOuter ? !climb : climb;
    else if (op.side === 'inside') ccw = isOuter ? climb : !climb;
    else ccw = isOuter ? !climb : climb;
    return setOrientation(l, ccw);
  });
  const out: PreparedLoop[] = [];
  let cur: Vec2 = { x: 0, y: 0 };
  for (const loop0 of orderByNearest(loops, cur)) {
    let loop = rotateToNearest(loop0, cur);
    let centers: Vec2[] = [];
    let ivals: TabInterval[] = [];
    if (tabs) {
      const L = perimeter(loop);
      if (tabs.mode === 'manual') centers = (tabs.points ?? []).filter(p => nearestOnPolyline(loop, p).dist <= Math.max(tool.diameter * 2, tabs.width) + 2).map(p => nearestOnPolyline(loop, p).point);
      else if (L > 0) { const spacing = L / tabs.count; for (let i = 0; i < tabs.count; i++) centers.push(pointAtLength(loop, spacing * (i + 0.5)).point); }
      ivals = intervalsFromCenters(loop, centers, tabs, tool.diameter);
      // a tab across the seam would be plunged through at every pass: restart the loop in the middle of the widest gap between tabs
      if (ivals.length && ivals.some(iv => iv.s0 <= 1e-9 || iv.s1 >= L - 1e-9)) {
        let best = -1, mid = 0;
        for (let k = 0; k < ivals.length; k++) {
          const a = ivals[k].s1, b = k + 1 < ivals.length ? ivals[k + 1].s0 : ivals[0].s0 + L;
          if (b - a > best) { best = b - a; mid = mod((a + b) / 2, L); }
        }
        if (best > 1e-6) { loop = rotateLoopAt(loop, mid); ivals = intervalsFromCenters(loop, centers, tabs, tool.diameter); }
      }
    }
    out.push({ loop, centers: centers.map(c => { const n = nearestOnPolyline(loop, c); return { x: n.point.x, y: n.point.y, angle: n.angle }; }), ivals });
    cur = loop.points[0];
  }
  return out;
}

/** Centre point and tangent angle of every tab the op will produce (for display). */
export function profileTabCenters(job: Job, op: ProfileOp): { x: number; y: number; angle: number; loop: number }[] {
  if (!op.tabs) return [];
  return prepareProfileLoops(job, op).flatMap((p, li) => p.centers.map(c => ({ ...c, loop: li })));
}

/**
 * Walk a closed loop at z, lifting to tabZ over tab intervals (measured by arc length from the loop start).
 * The tool is assumed at loop.points[0], at z or (when the start lies inside a tab) at tabZ. Ends where it started, at the
 * same height, so the next pass can plunge straight down without cutting a tab.
 */
function followWithTabs(ml: MoveList, loop: Polyline, z: number, tabZ: number, tabs: TabInterval[], feed: number, plungeFeed: number) {
  const pts = loop.points; const n = pts.length; const L = perimeter(loop);
  const events: { s: number; up: boolean }[] = [];
  for (const t of tabs) { events.push({ s: t.s0, up: true }); if (t.s1 < L - 1e-9) events.push({ s: t.s1, up: false }); }
  events.sort((a, b) => a.s - b.s);
  let s = 0; let ei = 0; let atTab = tabs.some(t => t.s0 <= 1e-9);
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
  const ctx = makeContext(job, op);
  const shapes = getShapes(job, op.shapeIds);
  const ml = new MoveList(ctx);

  const closedShapes = shapes.filter(s => s.polyline.closed).map(s => s.polyline);
  const openShapes = shapes.filter(s => !s.polyline.closed).map(s => s.polyline);

  const prepared = prepareProfileLoops(job, op);
  if (prepared.length === 0 && closedShapes.length && op.side !== 'on') ctx.warnings.push(`No toolpath: the ${ctx.tool.diameter} mm tool does not fit ${op.side} the selected shapes.`);

  const tabs = activeTabs(op);
  const finalZ = ctx.passes[ctx.passes.length - 1] ?? ctx.stockTop;
  const tabZ = finalZ + (tabs?.height ?? 0);

  let cur: Vec2 = { x: 0, y: 0 };
  for (const { loop, ivals } of prepared) {
    const L = perimeter(loop);
    let prevZ = ctx.stockTop;
    /** Arc length along `loop` where the tool currently sits (each pass starts where the previous one ended). */
    let sCur = 0;
    for (let pi = 0; pi < ctx.passes.length; pi++) {
      const z = ctx.passes[pi];
      const tabbed = !!tabs && z < tabZ - 1e-6;
      const ivalsHere = tabbed ? shiftIntervals(ivals, sCur, L) : [];
      const startInTab = ivalsHere.some(iv => iv.s0 <= 1e-9);
      const rampLen = (prevZ - z) / Math.tan(((op.rampAngle ?? 5) * Math.PI) / 180);
      const rampOk = op.entry === 'ramp' && rampLen > 0.1 && L > 0 && (!tabbed || !rangeHits(ivals, sCur, rampLen + 0.5, L)); // never ramp through a tab
      const start = sCur === 0 ? loop.points[0] : pointAtLength(loop, sCur).point;
      if (rampOk) {
        // ramp along the contour from the current position, then cut the whole loop from where the ramp ended
        if (pi === 0) { ml.retract(); ml.rapid(start.x, start.y, ctx.clearanceZ); ml.rapid(start.x, start.y, prevZ + 0.5); }
        const startZ = pi === 0 ? prevZ + 0.5 : prevZ; const len = Math.min(rampLen, L);
        const walk = walkLoop(loop, sCur, len);
        for (const w of walk.slice(1)) ml.ramp(w.point.x, w.point.y, startZ - (startZ - z) * Math.min(1, (w.s - sCur) / len));
        sCur = mod(sCur + len, L);
        const loop2 = rotateLoopAt(loop, sCur);
        ml.cut(loop2.points[0].x, loop2.points[0].y, z);
        if (tabbed) followWithTabs(ml, loop2, z, tabZ, shiftIntervals(ivals, sCur, L), ctx.feed, ctx.plunge);
        else followPath(ml, loop2, z);
        prevZ = z; continue;
      }
      const zStart = startInTab ? tabZ : z;
      if (pi === 0) ml.moveTo(start.x, start.y, zStart, ctx.stockTop + 0.5);
      else ml.plunge(start.x, start.y, zStart);
      const loopS = sCur === 0 ? loop : rotateLoopAt(loop, sCur);
      if (tabbed) followWithTabs(ml, loopS, z, tabZ, ivalsHere, ctx.feed, ctx.plunge);
      else followPath(ml, loopS, z);
      prevZ = z;
    }
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
  return { opId: op.id, opName: op.name ?? `Profile ${op.side}`, toolId: ctx.tool.id, rpm: ctx.rpm, moves: ml.moves, warnings: ctx.warnings, stepdown: ctx.stepdown };
}
