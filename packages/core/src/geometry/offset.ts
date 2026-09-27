import ClipperLib, { type IntPoint, type ClipType } from 'clipper-lib';
import type { Polyline } from './polyline.js';

const SCALE = 10000; // 0.1 micron integer resolution

type Path = IntPoint[];

function toPath(p: Polyline): Path {
  return p.points.map(q => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }));
}
function fromPath(path: Path, closed = true): Polyline {
  return { points: path.map(q => ({ x: q.X / SCALE, y: q.Y / SCALE })), closed };
}

export type JoinStyle = 'round' | 'square' | 'miter';

const joinMap = { round: ClipperLib.JoinType.jtRound, square: ClipperLib.JoinType.jtSquare, miter: ClipperLib.JoinType.jtMiter };

/**
 * Offset a set of closed polygons by `delta` (positive = outward for CCW outer loops).
 * Holes should be CW. Returns oriented result (outers CCW, holes CW) as computed by Clipper.
 */
export function offsetPolygons(polys: Polyline[], delta: number, join: JoinStyle = 'round', arcTol = 0.005): Polyline[] {
  const co = new ClipperLib.ClipperOffset(2, arcTol * SCALE);
  const closed = polys.filter(p => p.closed && p.points.length >= 3);
  if (closed.length === 0) return [];
  co.AddPaths(closed.map(toPath), joinMap[join], ClipperLib.EndType.etClosedPolygon);
  const sol: Path[] = [];
  co.Execute(sol, delta * SCALE);
  return sol.map(p => fromPath(p)).filter(p => p.points.length >= 3);
}

/** Offset open polylines: returns closed polygons enclosing the swept region (width 2*delta). */
export function offsetOpen(polys: Polyline[], delta: number, join: JoinStyle = 'round', arcTol = 0.005): Polyline[] {
  const co = new ClipperLib.ClipperOffset(2, arcTol * SCALE);
  co.AddPaths(polys.map(toPath), joinMap[join], ClipperLib.EndType.etOpenRound);
  const sol: Path[] = [];
  co.Execute(sol, delta * SCALE);
  return sol.map(p => fromPath(p));
}

function boolean(a: Polyline[], b: Polyline[], type: ClipType): Polyline[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a.map(toPath), ClipperLib.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b.map(toPath), ClipperLib.PolyType.ptClip, true);
  const sol: Path[] = [];
  c.Execute(type, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol.map(p => fromPath(p));
}

export const union = (a: Polyline[], b: Polyline[] = []): Polyline[] => boolean(a, b, ClipperLib.ClipType.ctUnion);
export const difference = (a: Polyline[], b: Polyline[]): Polyline[] => boolean(a, b, ClipperLib.ClipType.ctDifference);
export const intersection = (a: Polyline[], b: Polyline[]): Polyline[] => boolean(a, b, ClipperLib.ClipType.ctIntersection);

/** Normalise a set of loops into a proper polygon set: outers CCW, holes CW, using even-odd fill. */
export function normalize(polys: Polyline[]): Polyline[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(polys.filter(p => p.closed).map(toPath), ClipperLib.PolyType.ptSubject, true);
  const sol: Path[] = [];
  c.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return sol.map(p => fromPath(p));
}

export function area(polys: Polyline[]): number {
  return polys.reduce((s, p) => s + ClipperLib.Clipper.Area(toPath(p)) / (SCALE * SCALE), 0);
}
