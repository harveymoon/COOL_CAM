import type { Job, Toolpath, Tool, Move, MachineProfile } from '@cool-cam/core';
import { MACHINES, SHAPEOKO_HDM, getTool, stockBounds } from '@cool-cam/core';

/**
 * Heightmap ("2.5D dexel") stock simulator. Good for 3-axis work: the stock is a grid of surface heights and each
 * tool move stamps the tool's footprint into the grid. Undercuts are not representable, which is fine for a router.
 */
export interface SimEvent {
  severity: 'error' | 'warning' | 'info';
  code: 'rapid-into-stock' | 'below-stock' | 'outside-envelope' | 'plunge-too-deep' | 'no-cut';
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

interface Footprint { dx: Int16Array; dy: Int16Array; dz: Float32Array; count: number; radiusCells: number }

export interface FlatMove extends Move { opId: string; toolId: string; index: number }

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
    const res = opts.resolution ?? Math.max(0.15, Math.min(1.0, Math.sqrt((W * H) / 400000)));
    this.res = res;
    this.x0 = b.x0 - margin; this.y0 = b.y0 - margin;
    this.w = Math.max(1, Math.ceil(W / res)); this.h = Math.max(1, Math.ceil(H / res));
    this.top = b.top; this.bottom = b.bottom;
    this.heights = new Float32Array(this.w * this.h).fill(b.top);
    this.keyframeEvery = opts.keyframeEvery ?? 250;
    for (const tp of toolpaths) tp.moves.forEach((m, i) => this.moves.push({ ...m, opId: tp.opId, toolId: tp.toolId, index: this.moves.length }));
    void 0 === i0;
  }

  private footprint(tool: Tool): Footprint {
    const key = tool.id;
    const cached = this.footprints.get(key); if (cached) return cached;
    const r = tool.diameter / 2; const rc = Math.ceil(r / this.res);
    const dx: number[] = [], dy: number[] = [], dz: number[] = [];
    const half = ((tool.tipAngle ?? 118) * Math.PI) / 360;
    for (let j = -rc; j <= rc; j++) for (let i = -rc; i <= rc; i++) {
      const d = Math.hypot(i * this.res, j * this.res);
      if (d > r) continue;
      let z = 0;
      if (tool.type === 'ballnose') z = r - Math.sqrt(Math.max(0, r * r - d * d));
      else if (tool.type === 'vbit' || tool.type === 'drill') z = d / Math.tan(half);
      dx.push(i); dy.push(j); dz.push(z);
    }
    const fp: Footprint = { dx: Int16Array.from(dx), dy: Int16Array.from(dy), dz: Float32Array.from(dz), count: dx.length, radiusCells: rc };
    this.footprints.set(key, fp); return fp;
  }

  /** Stamp the tool at (x,y,z). Returns removed volume; if `check` is set, only tests for contact. */
  private stamp(fp: Footprint, x: number, y: number, z: number, check: boolean): number {
    const ci = Math.round((x - this.x0) / this.res), cj = Math.round((y - this.y0) / this.res);
    if (ci < -fp.radiusCells || cj < -fp.radiusCells || ci > this.w + fp.radiusCells || cj > this.h + fp.radiusCells) return 0;
    let removed = 0; const H = this.heights; const w = this.w, h = this.h;
    for (let k = 0; k < fp.count; k++) {
      const i = ci + fp.dx[k], j = cj + fp.dy[k];
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const idx = j * w + i; const zc = z + fp.dz[k];
      const cur = H[idx];
      if (cur > zc + 1e-6) {
        if (check) return 1;
        removed += cur - zc; H[idx] = zc;
      }
    }
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
    let removed = 0; let rapidHit = false;
    for (let s = isRapid ? 0 : 1; s <= n; s++) {
      const f = s / n; const x = prev.x + dx * f, y = prev.y + dy * f, z = prev.z + dz * f;
      if (isRapid) {
        if (this.stamp(fp, x, y, z, true)) { rapidHit = true; break; }
      } else removed += this.stamp(fp, x, y, z, false);
    }
    if (rapidHit) this.event('error', 'rapid-into-stock', `Rapid move passes through uncut stock at Z ${m.z.toFixed(2)}.`, m);
    if (!isRapid && m.kind === 'plunge' && tool.type === 'endmill' && tool.flutes >= 3 && (prev.z - m.z) > tool.diameter) {
      this.event('info', 'plunge-too-deep', `Straight plunge of ${(prev.z - m.z).toFixed(1)} mm with a ${tool.flutes}-flute endmill; consider a helix or ramp entry.`, m);
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

const i0 = 0;

export function simulate(job: Job, toolpaths: Toolpath[], opts: SimOptions = {}): SimSummary {
  const sim = new StockSim(job, toolpaths, { keyframeEvery: 0, ...opts });
  return sim.runAll();
}
