import type { Move } from '@cool-cam/core';

export type Segment = { kind: 'line'; m: Move } | { kind: 'arc'; m: Move; cw: boolean; cx: number; cy: number };

/**
 * Fit G2/G3 arcs over runs of consecutive cutting moves at constant Z and feed. Greedy: extend a run while every point stays
 * within `tol` of the circle through (first, middle, last) and the angle progresses monotonically; arcs are kept under 180°.
 */
export function fitArcs(moves: Move[], start: Move, tol = 0.01, minPts = 5): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < moves.length) {
    const m = moves[i];
    const prev = i === 0 ? start : moves[i - 1];
    // a cut that changes Z (a step down between passes) is never part of an arc: G2/G3 here carries no Z word; nor is a cut
    // from an unknown position (NaN start, right after a tool change), because I/J are relative to where the tool is
    if (m.kind !== 'cut' || !Number.isFinite(prev.x) || !Number.isFinite(prev.y) || !Number.isFinite(prev.z) || Math.abs(prev.z - m.z) > 1e-6) { out.push({ kind: 'line', m }); i++; continue; }
    // collect a run of cut moves at the same z/feed
    let j = i; while (j + 1 < moves.length && moves[j + 1].kind === 'cut' && Math.abs(moves[j + 1].z - m.z) < 1e-6 && moves[j + 1].f === m.f) j++;
    const pts = [prev, ...moves.slice(i, j + 1)];
    if (pts.length - 1 < minPts) { for (let k = i; k <= j; k++) out.push({ kind: 'line', m: moves[k] }); i = j + 1; continue; }
    // greedy arc extraction over pts (pts[0] is the current position)
    let a = 0;
    while (a < pts.length - 1) {
      let best: { end: number; cx: number; cy: number; cw: boolean } | null = null;
      let b = a + minPts;
      while (b < pts.length) {
        const fit = circleThrough(pts[a], pts[Math.floor((a + b) / 2)], pts[b]);
        if (!fit || fit.r > 2000 || fit.r < 0.2) break;
        let ok = true; let sweep = 0; let prevAng = Math.atan2(pts[a].y - fit.cy, pts[a].x - fit.cx); let dirSign = 0;
        for (let k = a + 1; k <= b && ok; k++) {
          const d = Math.abs(Math.hypot(pts[k].x - fit.cx, pts[k].y - fit.cy) - fit.r); if (d > tol) { ok = false; break; }
          const ang = Math.atan2(pts[k].y - fit.cy, pts[k].x - fit.cx); let da = ang - prevAng; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          if (Math.abs(da) < 1e-9) { ok = false; break; }
          const sgn = Math.sign(da); if (dirSign === 0) dirSign = sgn; else if (sgn !== dirSign) { ok = false; break; }
          sweep += Math.abs(da); prevAng = ang;
          // chord midpoint deviation: segments between samples must also hug the circle
          const mx = (pts[k - 1].x + pts[k].x) / 2, my = (pts[k - 1].y + pts[k].y) / 2; if (Math.abs(Math.hypot(mx - fit.cx, my - fit.cy) - fit.r) > tol * 3) { ok = false; break; }
        }
        if (!ok || sweep > Math.PI * 0.98) break;
        best = { end: b, cx: fit.cx, cy: fit.cy, cw: dirSign < 0 };
        b++;
      }
      if (best) { out.push({ kind: 'arc', m: pts[best.end] as Move, cw: best.cw, cx: best.cx, cy: best.cy }); a = best.end; }
      else { out.push({ kind: 'line', m: pts[a + 1] as Move }); a++; }
    }
    i = j + 1;
  }
  return out;
}

function circleThrough(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}
