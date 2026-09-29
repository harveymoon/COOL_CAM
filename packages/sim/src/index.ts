import type { Job, Toolpath, Tool, Move, MachineProfile } from '@cool-cam/core';
import { MACHINES, SHAPEOKO_HDM, getTool, stockBounds } from '@cool-cam/core';

/**
 * Heightmap ("2.5D dexel") stock simulator. Good for 3-axis work: the stock is a grid of surface heights and each
 * tool move stamps the tool's footprint into the grid. Undercuts are not representable, which is fine for a router.
 */
export interface SimEvent {
  severity: 'error' | 'warning' | 'info';
  code: 'rapid-into-stock' | 'below-stock' | 'outside-envelope' | 'plunge-too-deep' | 'deep-engagement' | 'shank-contact' | 'no-cut';
  message: string;
  opId: string;
  moveIndex: number;
  x: number; y: number; z: number;
}

export interface SimOptions {
  /** Grid cell size in mm. Defaults to fit ~400k cells. */
  resolution?: number;
  /** Extra stock margin around the nominal block, mm. */
  margin?: number;
  /** Save a heightmap snapshot every N moves for fast scrubbing. 0 disables. */
  keyframeEvery?: number;
}

export interface SimSummary {
  removedVolume: number;
  cells: { w: number; h: number; res: number };
  minHeight: number;
  events: SimEvent[];
  moveCount: number;
}

interface Footprint {
  dx: Int16Array; dy: Int16Array; dz: Float32Array;
  /** 1 for cells well inside the rim (used for the engagement measurement) */
  inner: Uint8Array;
  count: number; radiusCells: number; radius: number;
  /** cells in a thin ring just outside the cutter: material standing there taller than the flutes means the shank is in the stock */
  rimDx: Int16Array; rimDy: Int16Array; rimCount: number;
}

export interface FlatMove extends Move { opId: string; toolId: string; index: number; /** planned max axial engagement for this op's cuts (see Toolpath.stepdown) */ stepdown?: number }

export class StockSim {
  readonly w: number; readonly h: number; readonly res: number;
  readonly x0: number; readonly y0: number; readonly top: number; readonly bottom: number;
  heights: Float32Array;
  removedVolume = 0;
  events: SimEvent[] = [];
  private footprints = new Map<string, Footprint>();
  private keyframes: { index: number; heights: Float32Array; removed: number }[] = [];
  readonly moves: FlatMove[] = [];
  readonly job: Job;
  readonly machine: MachineProfile;
  private keyframeEvery: number;

  constructor(job: Job, toolpaths: Toolpath[], opts: SimOptions = {}) {
    this.job = job;
    this.machine = MACHINES[job.machineId] ?? SHAPEOKO_HDM;
    const b = stockBounds(job.stock);
    const margin = opts.margin ?? 0;
    const W = job.stock.width + 2 * margin, H = job.stock.length + 2 * margin;
    // auto resolution targets ~400k cells but never coarser than half the smallest cutter radius, so a small tool's footprint
    // is still several cells wide and the rapid/engagement checks stay meaningful on a big stock
    const minRadius = Math.min(...toolpaths.filter(tp => tp.moves.length).map(tp => { try { return getTool(job, tp.toolId).diameter / 2; } catch { return Infinity; } }), Infinity);
    const res = opts.resolution ?? Math.max(0.1, Math.min(1.0, Math.sqrt((W * H) / 400000), isFinite(minRadius) ? minRadius / 2 : 1.0));
    this.res = res;
    this.x0 = b.x0 - margin; this.y0 = b.y0 - margin;
    this.w = Math.max(1, Math.ceil(W / res)); this.h = Math.max(1, Math.ceil(H / res));
    this.top = b.top; this.bottom = b.bottom;
    this.heights = new Float32Array(this.w * this.h).fill(b.top);
    this.keyframeEvery = opts.keyframeEvery ?? 250;
    for (const tp of toolpaths) for (const m of tp.moves) this.moves.push({ ...m, opId: tp.opId, toolId: tp.toolId, index: this.moves.length, stepdown: tp.stepdown });
  }

  private footprint(tool: Tool): Footprint {
    const key = tool.id;
    const cached = this.footprints.get(key); if (cached) return cached;
    const r = tool.diameter / 2; const rc = Math.ceil(r / this.res);
    const dx: number[] = [], dy: number[] = [], dz: number[] = [], inner: number[] = [], rimDx: number[] = [], rimDy: number[] = [];
    const half = ((tool.tipAngle ?? 118) * Math.PI) / 360;
    // cells whose centre lies within a cell diagonal of the rim straddle the boundary of what the tool really touches (a wall the
    // cutter only kisses); they still get stamped, but they are excluded from the engagement measurement
    const innerR = Math.max(0, r - this.res * 0.71);
    const rimR = r + Math.max(this.res * 1.5, 0.3);
    const rcOut = Math.ceil(rimR / this.res);
    for (let j = -rcOut; j <= rcOut; j++) for (let i = -rcOut; i <= rcOut; i++) {
      const d = Math.hypot(i * this.res, j * this.res);
      if (d > rimR) continue;
      if (d > r) { rimDx.push(i); rimDy.push(j); continue; }
      let z = 0;
      if (tool.type === 'ballnose') z = r - Math.sqrt(Math.max(0, r * r - d * d));
      else if (tool.type === 'vbit' || tool.type === 'drill') z = d / Math.tan(half);
      dx.push(i); dy.push(j); dz.push(z); inner.push(d <= innerR || (i === 0 && j === 0) ? 1 : 0);
    }
    const fp: Footprint = { dx: Int16Array.from(dx), dy: Int16Array.from(dy), dz: Float32Array.from(dz), inner: Uint8Array.from(inner), count: dx.length, radiusCells: rcOut, radius: r, rimDx: Int16Array.from(rimDx), rimDy: Int16Array.from(rimDy), rimCount: rimDx.length };
    this.footprints.set(key, fp); return fp;
  }

  /** Axial engagement of the last non-check stamp: the tallest column of material that stood above the tool's cutting surface (mm). */
  private lastEngagement = 0;
  /** Radial engagement of the last non-check stamp: the width of cutter (measured from the rim, across the direction of travel) that met material (mm). */
  private lastRadial = 0;
  /** Like lastEngagement but only over cells more than a quarter diameter inside the rim: bulk material, not a wall skin. */
  private lastBulk = 0;
  /** Material standing just outside the cutter, measured from the tool tip (mm): taller than the flutes means the shank is in the stock. */
  private lastWall = 0;

  /**
   * Tallest column of material above the tool's cutting surface at (x,y,z), without cutting (mm). Only cells more than a
   * quarter diameter inside the rim count: a plunge beside a wall skin (a finishing profile) must not read as a deep plunge.
   */
  private columnAbove(fp: Footprint, x: number, y: number, z: number): number {
    const ci = Math.round((x - this.x0) / this.res), cj = Math.round((y - this.y0) / this.res);
    let eng = 0; const H = this.heights; const w = this.w, h = this.h; const bulkR = fp.radius * 0.5;
    for (let k = 0; k < fp.count; k++) {
      if (!fp.inner[k] || Math.hypot(fp.dx[k] * this.res, fp.dy[k] * this.res) > bulkR) continue;
      const i = ci + fp.dx[k], j = cj + fp.dy[k];
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const e = H[j * w + i] - (z + fp.dz[k]); if (e > eng) eng = e;
    }
    return eng;
  }

  /** Stamp the tool at (x,y,z) travelling along the unit direction (ux,uy). Returns removed volume; if `check` is set, only tests for contact. */
  private stamp(fp: Footprint, x: number, y: number, z: number, check: boolean, ux = 0, uy = 0): number {
    const ci = Math.round((x - this.x0) / this.res), cj = Math.round((y - this.y0) / this.res);
    this.lastEngagement = 0; this.lastRadial = 0; this.lastWall = 0; this.lastBulk = 0;
    if (ci < -fp.radiusCells || cj < -fp.radiusCells || ci > this.w + fp.radiusCells || cj > this.h + fp.radiusCells) return 0;
    let removed = 0, eng = 0, radial = 0, bulk = 0; const H = this.heights; const w = this.w, h = this.h; const res = this.res, r = fp.radius;
    const moving = ux !== 0 || uy !== 0; const bulkWidth = r * 0.5;
    for (let k = 0; k < fp.count; k++) {
      const i = ci + fp.dx[k], j = cj + fp.dy[k];
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const idx = j * w + i; const zc = z + fp.dz[k];
      const cur = H[idx];
      if (cur > zc + 1e-6) {
        if (check) return 1;
        const e = cur - zc;
        if (fp.inner[k]) {
          if (e > eng) eng = e;
          // how far across the cutter (perpendicular to travel) this material sits: a full slot reaches the centre line
          const perp = moving ? Math.abs(fp.dx[k] * res * uy - fp.dy[k] * res * ux) : 0;
          const width = r - perp; if (width > radial) radial = width;
          if (width > bulkWidth && e > bulk) bulk = e;
        }
        removed += e; H[idx] = zc;
      }
    }
    if (!check) {
      let wall = 0;
      for (let k = 0; k < fp.rimCount; k++) {
        const i = ci + fp.rimDx[k], j = cj + fp.rimDy[k];
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const t = H[j * w + i] - z; if (t > wall) wall = t;
      }
      this.lastWall = wall;
    }
    this.lastEngagement = eng; this.lastRadial = radial; this.lastBulk = bulk;
    return check ? 0 : removed * this.res * this.res;
  }

  private applyMove(m: FlatMove, prev: { x: number; y: number; z: number }) {
    const tool = getTool(this.job, m.toolId);
    const fp = this.footprint(tool);
    const dx = m.x - prev.x, dy = m.y - prev.y, dz = m.z - prev.z;
    const len = Math.hypot(dx, dy, dz);
    const n = Math.max(1, Math.ceil(len / (this.res * 0.5)));
    const isRapid = m.kind === 'rapid' || m.kind === 'retract';
    const t = this.machine.travel; const b = stockBounds(this.job.stock);
    // machine envelope check: X/Y relative to stock origin can't be known without homing offsets; check Z and sanity only.
    if (m.z < b.bottom - 1e-6 && !isRapid) this.event('error', 'below-stock', `Cut goes ${(b.bottom - m.z).toFixed(2)} mm below the stock bottom (into the wasteboard).`, m);
    if (m.z > b.top + t.z) this.event('warning', 'outside-envelope', `Z ${m.z.toFixed(1)} exceeds Z travel.`, m);
    let removed = 0; let rapidHit = false; let engagement = 0; let radial = 0; let wall = 0; let bulk = 0;
    const lxy = Math.hypot(dx, dy); const ux = lxy > 1e-9 ? dx / lxy : 0, uy = lxy > 1e-9 ? dy / lxy : 0;
    // a plunge is sampled in thin slices, so measure the whole column it goes through before cutting it
    if (m.kind === 'plunge') { engagement = this.columnAbove(fp, m.x, m.y, m.z); radial = fp.radius; bulk = engagement; }
    for (let s = isRapid ? 0 : 1; s <= n; s++) {
      const f = s / n; const x = prev.x + dx * f, y = prev.y + dy * f, z = prev.z + dz * f;
      if (isRapid) {
        if (this.stamp(fp, x, y, z, true)) { rapidHit = true; break; }
      } else { removed += this.stamp(fp, x, y, z, false, ux, uy); if (this.lastEngagement > engagement) engagement = this.lastEngagement; if (this.lastRadial > radial) radial = this.lastRadial; if (this.lastWall > wall) wall = this.lastWall; if (this.lastBulk > bulk) bulk = this.lastBulk; }
    }
    if (rapidHit) this.event('error', 'rapid-into-stock', `Rapid move passes through uncut stock at Z ${m.z.toFixed(2)}.`, m);
    if (!isRapid) {
      // Engagement checks: material standing above the tool's cutting surface while it feeds. A cut that meets more than the
      // planned pass depth means the planner assumed cleared material that is still there; deeper than the flute length means
      // the shank or collet is in the material. Both break cutters, so they are errors.
      const deepest = Math.max(engagement, wall);
      if (tool.fluteLength && deepest > tool.fluteLength + 0.05) this.event('error', 'shank-contact', `Tool tip ${deepest.toFixed(1)} mm below the material beside it with ${tool.name}, beyond its ${tool.fluteLength} mm flute length: the shank/collet is in the stock.`, m);
      const planned = m.stepdown;
      if (planned !== undefined && planned > 0) {
        const tol = Math.max(0.6, planned * 0.2);
        // `bulk` is the deepest column among cells more than a quarter diameter inside the rim: a thin wall skin (a finishing
        // pass after roughing left stock) may run the full flute length, material across the cutter's width may not.
        // A V-bit plunges to its pass depth by design, so only endmills/ball noses get the plunge-vs-plan check.
        if (m.kind === 'plunge') { if (tool.type !== 'vbit' && engagement > planned + tol + 0.5) this.event('warning', 'plunge-too-deep', `Plunge meets ${engagement.toFixed(1)} mm of material, more than the planned ${planned.toFixed(1)} mm per pass.`, m); }
        else if (bulk > planned + tol) this.event('error', 'deep-engagement', `${m.kind === 'ramp' ? 'Ramp' : 'Cut'} meets ${bulk.toFixed(1)} mm of uncut material across the cutter (${radial.toFixed(1)} mm of its ${tool.diameter} mm width), more than the planned ${planned.toFixed(1)} mm per pass: the planner assumed this area was already cleared.`, m);
      }
      if (m.kind === 'plunge' && (tool.type === 'endmill' || tool.type === 'ballnose') && engagement > 2 * tool.diameter) {
        this.event('warning', 'plunge-too-deep', `Straight plunge through ${engagement.toFixed(1)} mm of material with a ${tool.diameter} mm ${tool.type} (more than two diameters): chips cannot clear. Peck, helix or ramp instead.`, m);
      } else if (m.kind === 'plunge' && tool.type === 'endmill' && tool.flutes >= 3 && (prev.z - m.z) > tool.diameter) {
        this.event('info', 'plunge-too-deep', `Straight plunge of ${(prev.z - m.z).toFixed(1)} mm with a ${tool.flutes}-flute endmill; consider a helix or ramp entry.`, m);
      }
    }
    this.removedVolume += removed;
  }

  private event(severity: SimEvent['severity'], code: SimEvent['code'], message: string, m: FlatMove) {
    if (this.events.length > 500) return;
    const last = this.events[this.events.length - 1];
    if (last && last.code === code && last.opId === m.opId && m.index - last.moveIndex < 3) return;
    this.events.push({ severity, code, message, opId: m.opId, moveIndex: m.index, x: m.x, y: m.y, z: m.z });
  }

  private startPos() { return { x: 0, y: 0, z: this.top + this.job.safeZ }; }

  /** Run the whole program, recording keyframes. */
  runAll(): SimSummary {
    let prev = this.startPos();
    for (let i = 0; i < this.moves.length; i++) {
      if (this.keyframeEvery > 0 && i % this.keyframeEvery === 0) this.keyframes.push({ index: i, heights: this.heights.slice(), removed: this.removedVolume });
      const m = this.moves[i]; this.applyMove(m, prev); prev = m;
    }
    return this.summary();
  }

  /** Restore state to just after move `upTo` (exclusive of later moves) using the nearest keyframe, then replay. Requires runAll() first. */
  seek(upTo: number): void {
    upTo = Math.max(0, Math.min(this.moves.length, upTo));
    let kf = this.keyframes[0];
    for (const k of this.keyframes) if (k.index <= upTo) kf = k; else break;
    if (!kf) { this.heights.fill(this.top); this.removedVolume = 0; }
    else { this.heights.set(kf.heights); this.removedVolume = kf.removed; }
    const saveEvents = this.events; this.events = [];
    let prev = kf && kf.index > 0 ? this.moves[kf.index - 1] : this.startPos();
    for (let i = kf ? kf.index : 0; i < upTo; i++) { const m = this.moves[i]; this.applyMove(m, prev); prev = m; }
    this.events = saveEvents;
  }

  summary(): SimSummary {
    let minH = Infinity; for (let i = 0; i < this.heights.length; i++) if (this.heights[i] < minH) minH = this.heights[i];
    return { removedVolume: this.removedVolume, cells: { w: this.w, h: this.h, res: this.res }, minHeight: minH, events: this.events, moveCount: this.moves.length };
  }

  /** Cumulative time (seconds) at the end of each move, for timeline scrubbing. */
  timeline(): Float64Array {
    const t = new Float64Array(this.moves.length); let acc = 0; let prev = this.startPos();
    for (let i = 0; i < this.moves.length; i++) {
      const m = this.moves[i]; const d = Math.hypot(m.x - prev.x, m.y - prev.y, m.z - prev.z);
      const rapid = m.kind === 'rapid' || m.kind === 'retract';
      const v = (rapid ? this.machine.rapid.xy : Math.min(m.f ?? 1000, this.machine.maxFeed.xy)) / 60;
      acc += d / v; t[i] = acc; prev = m;
    }
    return t;
  }
}

export function simulate(job: Job, toolpaths: Toolpath[], opts: SimOptions = {}): SimSummary {
  const sim = new StockSim(job, toolpaths, { keyframeEvery: 0, ...opts });
  return sim.runAll();
}
