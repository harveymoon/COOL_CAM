import type { Mesh } from './mesh.js';
import { meshBBox, placedMesh } from './mesh.js';
import type { Polyline } from './geometry/polyline.js';
import { signedArea, simplify } from './geometry/polyline.js';
import { union, difference, intersection, offsetPolygons, area as polyArea } from './geometry/offset.js';
import type { Job, Shape } from './job.js';
import { getModel, stockBounds } from './job.js';
import type { Op, Tabs, PocketOp, ProfileOp, DrillOp, Rough3DOp, Finish3DOp } from './ops.js';
import type { Tool } from './tools.js';
import { rect } from './primitives.js';
import { feedsAndSpeeds, MATERIALS } from './feeds.js';
import type { MaterialId } from './feeds.js';

/** An upward-facing planar level of a mesh: the floor area at height z (outers CCW, holes CW). */
export interface PlanarLevel { z: number; area: number; region: Polyline[] }
export interface CircleFeature { cx: number; cy: number; diameter: number; z: number; through: boolean }
export interface ModelFeatures {
  top: number; base: number;
  /** XY projection of the whole mesh. */
  footprint: Polyline[];
  /** Planar floors sorted from highest to lowest. */
  levels: PlanarLevel[];
  /** Circular holes found in level regions / the footprint. */
  circles: CircleFeature[];
  planarArea: number; verticalArea: number; curvedArea: number; footprintArea: number;
}

const tri = (p: Float32Array, t: number) => [[p[t], p[t + 1], p[t + 2]], [p[t + 3], p[t + 4], p[t + 5]], [p[t + 6], p[t + 7], p[t + 8]]] as [number, number, number][];
function normalOf(a: number[], b: number[], c: number[]): [number, number, number] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
}
const area3 = (a: number[], b: number[], c: number[]) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); };
function ccwLoop(pts: { x: number; y: number }[]): Polyline | null {
  const p: Polyline = { points: pts, closed: true }; const a = signedArea(p);
  if (Math.abs(a) < 1e-9) return null; return a < 0 ? { points: [...pts].reverse(), closed: true } : p;
}
/** Union many small polygons in batches (Clipper copes better with chunks). */
function unionAll(polys: Polyline[]): Polyline[] {
  let acc: Polyline[] = [];
  for (let i = 0; i < polys.length; i += 400) acc = union(acc.concat(polys.slice(i, i + 400)));
  return acc.map(l => simplify(l, 0.002));
}

/** XY projection of the mesh portion at or above z (exact for planar geometry, union of clipped triangles). */
export function footprintAbove(mesh: Mesh, z: number): Polyline[] {
  const p = mesh.positions; const polys: Polyline[] = [];
  for (let t = 0; t < p.length; t += 9) {
    const v = tri(p, t); const out: { x: number; y: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3]; const ina = a[2] >= z, inb = b[2] >= z;
      if (ina) out.push({ x: a[0], y: a[1] });
      if (ina !== inb) { const f = (z - a[2]) / (b[2] - a[2]); out.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f }); }
    }
    if (out.length >= 3) { const l = ccwLoop(out); if (l) polys.push(l); }
  }
  return unionAll(polys);
}

export function extractFeatures(mesh: Mesh, opts: { zTol?: number; minArea?: number } = {}): ModelFeatures {
  const zTol = opts.zTol ?? 0.02, minArea = opts.minArea ?? 1;
  const p = mesh.positions; const bb = meshBBox(mesh);
  const upByZ = new Map<number, Polyline[]>(); const all: Polyline[] = [];
  let planarArea = 0, verticalArea = 0, curvedArea = 0;
  for (let t = 0; t < p.length; t += 9) {
    const [a, b, c] = tri(p, t); const n = normalOf(a, b, c); const A = area3(a, b, c);
    const loop = ccwLoop([{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, { x: c[0], y: c[1] }]);
    if (loop) all.push(loop);
    if (n[2] > 0.99995) { // truly flat: tessellated curves never get this close to horizontal
      planarArea += A;
      const z = (a[2] + b[2] + c[2]) / 3; const key = Math.round(z / zTol) * zTol;
      const arr = upByZ.get(key) ?? []; if (loop) arr.push(loop); upByZ.set(key, arr);
    } else if (Math.abs(n[2]) < 0.05) verticalArea += A;
    else if (n[2] > -0.995) curvedArea += A; // downward-facing planar (the bottom) is ignored
  }
  const footprint = unionAll(all); const footprintArea0 = polyArea(footprint);
  const levels: PlanarLevel[] = [];
  for (const [z, polys] of [...upByZ.entries()].sort((x, y) => y[0] - x[0])) {
    // drop slivers (tessellation facets on curved surfaces) and require at least one real face
    const region = unionAll(polys).filter(l => Math.abs(signedArea(l)) > 1);
    const outers = region.filter(l => signedArea(l) > 0);
    const largest = outers.reduce((m, l) => Math.max(m, signedArea(l)), 0);
    const area = polyArea(region);
    if (area >= minArea && largest >= Math.max(minArea, 4, 0.0025 * footprintArea0)) levels.push({ z: Math.round(z * 1000) / 1000, area, region });
  }
  // merge levels closer than zTol (rounding boundary artefacts)
  const merged: PlanarLevel[] = [];
  for (const l of levels) { const last = merged[merged.length - 1]; if (last && Math.abs(last.z - l.z) <= zTol * 1.5) { last.region = union(last.region.concat(l.region)); last.area = polyArea(last.region); } else merged.push(l); }
  const circles: CircleFeature[] = [];
  const findCircles = (loops: Polyline[], z: number, through: boolean) => {
    for (const l of loops) {
      if (signedArea(l) >= 0 || l.points.length < 8) continue;
      let cx = 0, cy = 0; for (const q of l.points) { cx += q.x; cy += q.y; } cx /= l.points.length; cy /= l.points.length;
      const rs = l.points.map(q => Math.hypot(q.x - cx, q.y - cy)); const r = rs.reduce((s, v) => s + v, 0) / rs.length;
      if (rs.every(v => Math.abs(v - r) < Math.max(0.05, r * 0.03))) circles.push({ cx: Math.round(cx * 100) / 100, cy: Math.round(cy * 100) / 100, diameter: Math.round(r * 200) / 100, z, through });
    }
  };
  findCircles(footprint, bb.min[2], true);
  for (const l of merged) findCircles(l.region, l.z, false);
  for (let i = circles.length - 1; i >= 0; i--) { const c = circles[i]; const dup = circles.findIndex(o => o !== c && Math.hypot(o.cx - c.cx, o.cy - c.cy) < 0.2 && Math.abs(o.diameter - c.diameter) < 0.2); if (dup >= 0 && dup < i) { if (c.through) circles[dup].through = true; circles.splice(i, 1); } }
  // a blind circle's floor shows up as its own tiny level; mark circles that coincide with a footprint hole as through
  for (const c of circles) if (!c.through && circles.some(o => o.through && Math.hypot(o.cx - c.cx, o.cy - c.cy) < 0.2 && Math.abs(o.diameter - c.diameter) < 0.2)) c.through = true;
  return { top: bb.max[2], base: bb.min[2], footprint, levels: merged, circles, planarArea, verticalArea, curvedArea, footprintArea: polyArea(footprint) };
}

export interface ProposalOptions {
  modelId: string;
  /** Margin machined around the footprint (default: largest endmill diameter). */
  boundary?: number;
  /** Cut the part free with a tabbed profile when it sits on the bed (default true). */
  cutout?: boolean;
  tabs?: Tabs;
  /** Stock left by 3D roughing when curved faces exist (default 0.3). */
  stockToLeave?: number;
  /** Ids get this prefix (default: model id). */
  prefix?: string;
  /** Restrict tools to these ids (default: all job tools). */
  toolIds?: string[];
}
export interface Proposal { shapes: Shape[]; ops: Op[]; notes: string[]; features: Omit<ModelFeatures, 'footprint' | 'levels'> & { levels: { z: number; area: number; loops: number }[] } }

/** Turn a placed model into shapes + operations: exact 2.5D pockets at each planar floor, drills for matching holes, 3D rough/finish for curved faces, and a tabbed cutout. Does not mutate the job. */
export function proposeOperations(job: Job, opts: ProposalOptions): Proposal {
  const model = getModel(job, opts.modelId);
  const mesh = placedMesh(model); const f = extractFeatures(mesh);
  const sb = stockBounds(job.stock); const top = sb.top;
  const prefix = opts.prefix ?? model.id;
  const notes: string[] = []; const shapes: Shape[] = []; const ops: Op[] = [];
  const tools = job.tools.filter(t => !opts.toolIds || opts.toolIds.includes(t.id));
  // largest first; in wood-type materials multi-flute cutters come before single flutes (O-flutes are for metals and plastics)
  const material0 = job.material && job.material in MATERIALS ? job.material : undefined;
  const woody = !material0 || ['softwood', 'hardwood', 'plywood', 'mdf', 'foam'].includes(material0);
  const endmills = tools.filter(t => t.type === 'endmill').sort((a, b) => (woody ? Number(b.flutes >= 2) - Number(a.flutes >= 2) : 0) || b.diameter - a.diameter);
  const balls = tools.filter(t => t.type === 'ballnose').sort((a, b) => a.diameter - b.diameter);
  if (!endmills.length) throw new Error('No flat endmill in the job tools.');
  const material = (job.material && job.material in MATERIALS ? job.material : undefined) as MaterialId | undefined;
  const fs = (tool: Tool) => { if (!material) return {}; const r = feedsAndSpeeds(tool, material); return { rpm: r.rpm, feed: r.feed, plunge: r.plunge }; };
  // 1.5 tool diameters of moat so the largest cutter has room to run around the part
  const boundary = opts.boundary ?? +(endmills[0].diameter * 1.5).toFixed(2);
  const stockRect = [rect(sb.x0, sb.y0, job.stock.width, job.stock.length)];
  const domain = intersection(offsetPolygons(f.footprint, boundary), stockRect);
  const addShapes = (loops: Polyline[], base: string): string[] => loops.map((l, i) => { const id = `${prefix}_${base}${loops.length > 1 ? `_${i + 1}` : ''}`; shapes.push({ id, name: base.replace(/_/g, ' '), polyline: simplify(l, 0.005) }); return id; });
  const fits = (tool: Tool, region: Polyline[]) => offsetPolygons(region, -(tool.diameter / 2 + 0.01)).some(l => Math.abs(signedArea(l)) > 0.5);
  const curved = f.curvedArea > 0.02 * Math.max(1, f.footprintArea);
  const stl = opts.stockToLeave ?? 0.3;
  const eps = 0.01;
  let n = 0;
  // 0) through-holes: drill when a tool matches the diameter, otherwise bore with the largest endmill that fits; keep them out of the level pockets
  const holeDiscs: Polyline[] = [];
  const holeOps: Op[] = [];
  for (const c of f.circles.filter(c => c.through)) {
    const disc: Polyline = { points: circlePts(c.cx, c.cy, c.diameter / 2), closed: true };
    const holeDepth = +(top - Math.max(sb.bottom, f.base)).toFixed(3);
    const drill = tools.find(t => (t.type === 'drill' || t.type === 'endmill') && Math.abs(t.diameter - c.diameter) <= 0.1);
    const borer = drill ? undefined : endmills.find(t => t.diameter <= c.diameter - 0.3);
    if (!drill && !borer) { notes.push(`Through hole Ø${c.diameter} at ${c.cx},${c.cy}: no tool small enough; left uncut.`); continue; }
    const id = `${prefix}_hole_${++n}`; shapes.push({ id, name: `hole Ø${c.diameter}`, polyline: disc }); holeDiscs.push(disc);
    if (drill) { holeOps.push({ id: `${prefix}_drill_${n}`, name: `Drill Ø${c.diameter} (${drill.name})`, type: 'drill', toolId: drill.id, shapeIds: [id], depth: holeDepth, peck: Math.min(3, drill.diameter), ...fs(drill) } as DrillOp); notes.push(`Through hole Ø${c.diameter} at ${c.cx},${c.cy}: drilled with ${drill.name}.`); }
    else if (borer) { holeOps.push({ id: `${prefix}_bore_${n}`, name: `Bore Ø${c.diameter} (${borer.name})`, type: 'pocket', toolId: borer.id, shapeIds: [id], depth: holeDepth, depthPerPass: Math.min(borer.diameter * 0.5, 3), stepover: +(borer.diameter * 0.4).toFixed(2), entry: 'helix', ...fs(borer) } as PocketOp); notes.push(`Through hole Ø${c.diameter} at ${c.cx},${c.cy}: no matching drill, bored with ${borer.name}.`); }
  }
  // 1) 3D roughing when there are curved faces (clears everything to +stl; the exact pockets below then finish the floors)
  if (curved) {
    const t = endmills[0];
    ops.push({ id: `${prefix}_rough`, name: `3D rough (${t.name})`, type: 'rough3d', toolId: t.id, modelId: model.id, shapeIds: [], depth: Math.min(job.stock.thickness, top - f.base + stl + 0.01), depthPerPass: Math.min(t.diameter * 0.5, 4), stepover: +(t.diameter * 0.45).toFixed(2), stockToLeave: stl, entry: 'helix', boundaryMode: 'silhouette', containment: 'outside', boundary, ...fs(t) } as Rough3DOp);
    notes.push(`Curved surface area is ${Math.round((100 * f.curvedArea) / Math.max(1, f.footprintArea))}% of the footprint: added 3D rough (+${stl} mm) and 3D finish.`);
  }
  // 2) planar levels below the stock top, plus the model base if it is above the bed
  const levelZs = f.levels.map(l => l.z).filter(z => z < top - 1e-3);
  if (f.base > sb.bottom + 1e-3 && !levelZs.some(z => Math.abs(z - f.base) < 1e-3)) levelZs.push(f.base);
  if (f.top < top - 1e-3 && !levelZs.some(z => Math.abs(z - f.top) < 1e-3)) levelZs.unshift(f.top);
  levelZs.sort((a, b) => b - a);
  let prevZ = top;
  for (const z of levelZs) {
    const region = difference(difference(domain, footprintAbove(mesh, z + eps)), holeDiscs).filter(l => Math.abs(signedArea(l)) > 0.5);
    if (!region.length) { prevZ = z; continue; }
    const tool = endmills.find(t => fits(t, region));
    const depth = +(top - z).toFixed(3), startDepth = +(top - prevZ).toFixed(3);
    const label = Math.abs(z - f.base) < 1e-3 ? 'base' : Math.abs(z - f.top) < 1e-3 ? 'top' : `z${z}`;
    if (tool) {
      const ids = addShapes(region, `level_${label}`);
      const startFrom = curved ? Math.max(startDepth, depth - stl - 0.3) : startDepth;
      ops.push({ id: `${prefix}_pocket_${++n}`, name: `Pocket to Z${z} (${tool.name})`, type: 'pocket', toolId: tool.id, shapeIds: ids, depth, startDepth: startFrom > 0 ? startFrom : undefined, depthPerPass: Math.min(tool.diameter * 0.5, 4), stepover: +(tool.diameter * 0.45).toFixed(2), entry: 'helix', ...fs(tool) } as PocketOp);
      // leftovers the big tool cannot reach (inside corners, small holes): a smaller endmill or a drill
      const reach = offsetPolygons(offsetPolygons(region, -(tool.diameter / 2)).filter(l => Math.abs(signedArea(l)) > 0.5), tool.diameter / 2 + 0.02);
      const leftover = difference(region, reach).filter(l => Math.abs(signedArea(l)) > 2);
      if (leftover.length) {
        const small = endmills.filter(t => t.diameter < tool.diameter).find(t => fits(t, leftover));
        if (small) {
          const restRegion = intersection(offsetPolygons(leftover, small.diameter), region);
          const rids = addShapes(restRegion, `rest_${label}`);
          ops.push({ id: `${prefix}_rest_${n}`, name: `Rest to Z${z} (${small.name})`, type: 'pocket', toolId: small.id, shapeIds: rids, depth, startDepth: startFrom > 0 ? startFrom : undefined, depthPerPass: Math.min(small.diameter * 0.5, 3), stepover: +(small.diameter * 0.4).toFixed(2), entry: 'helix', ...fs(small) } as PocketOp);
          notes.push(`Level Z${z}: ${tool.name} cannot reach ${Math.round(polyArea(leftover))} mm² of corners/holes; added a rest pass with ${small.name}.`);
        } else notes.push(`Level Z${z}: ${Math.round(polyArea(leftover))} mm² unreachable by any endmill (sharp inside corners or holes smaller than the smallest tool).`);
      }
    } else notes.push(`Level Z${z}: no endmill fits the region (${Math.round(polyArea(region))} mm²).`);
    prevZ = z;
  }
  // 3) holes (after the levels so their startDepth could be tuned later; today they run full depth)
  ops.push(...holeOps);
  // 4) 3D finish for curved faces
  if (curved) {
    const t = balls[0] ?? endmills[endmills.length - 1];
    ops.push({ id: `${prefix}_finish`, name: `3D finish (${t.name})`, type: 'finish3d', toolId: t.id, modelId: model.id, shapeIds: [], depth: Math.min(job.stock.thickness, top - f.base + 0.01), stepover: +(t.diameter * 0.1).toFixed(2), axis: 'x', boundaryMode: 'silhouette', containment: 'outside', boundary, ...fs(t) } as Finish3DOp);
  }
  // 5) cutout when the part sits on the bed
  if (opts.cutout !== false && f.base <= sb.bottom + 1e-3) {
    const outers = f.footprint.filter(l => signedArea(l) > 0);
    const ids = addShapes(outers, 'outline');
    const t = endmills.find(t => t.diameter <= boundary) ?? endmills[endmills.length - 1];
    const lastZ = levelZs.length ? levelZs[levelZs.length - 1] : top;
    ops.push({ id: `${prefix}_cutout`, name: `Cut out with tabs (${t.name})`, type: 'profile', toolId: t.id, shapeIds: ids, side: 'outside', depth: job.stock.thickness, startDepth: top - lastZ > 0 ? +(top - lastZ - 0.5).toFixed(3) : undefined, depthPerPass: Math.min(t.diameter * 0.6, 4), tabs: opts.tabs ?? { count: 4, width: 8, height: 2.5 }, ...fs(t) } as ProfileOp);
    notes.push('Part sits on the bed: added a tabbed outside profile to cut it free.');
  } else if (opts.cutout !== false) notes.push(`Model base is ${(f.base - sb.bottom).toFixed(2)} mm above the bed: no cutout, a base plate remains.`);
  notes.unshift(`${f.levels.length} planar level(s): ${f.levels.map(l => `Z${l.z} (${Math.round(l.area)} mm²)`).join(', ')}. ${f.circles.length} circular hole(s).`);
  return { shapes, ops, notes, features: { top: f.top, base: f.base, circles: f.circles, planarArea: f.planarArea, verticalArea: f.verticalArea, curvedArea: f.curvedArea, footprintArea: f.footprintArea, levels: f.levels.map(l => ({ z: l.z, area: Math.round(l.area), loops: l.region.length })) } };
}

function circlePts(cx: number, cy: number, r: number) { const pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; }
