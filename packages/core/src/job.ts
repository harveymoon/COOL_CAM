import type { Polyline } from './geometry/polyline.js';
import type { Tool } from './tools.js';
import type { Op } from './ops.js';
import type { Model } from './mesh.js';
import { DEFAULT_TOOLS } from './tools.js';
import { SHAPEOKO_HDM } from './machine.js';
import type { MachineProfile } from './machine.js';

/** Parameters a primitive shape was built from, so it stays editable. Cleared when the shape is rotated, scaled or edited freeform. */
export type ShapeParams =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number }
  | { kind: 'circle'; cx: number; cy: number; d: number }
  | { kind: 'regular_polygon'; cx: number; cy: number; sides: number; d: number; rot: number }
  | { kind: 'slot'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { kind: 'text'; text: string; font: string; size: number; x: number; y: number; align: 'left' | 'center' | 'right'; spacing?: number };

export interface Shape {
  id: string;
  name?: string;
  polyline: Polyline;
  layer?: string;
  params?: ShapeParams;
  /** Text shapes produce several loops; siblings share a group id so they move together. */
  group?: string;
  /** Reference geometry (outlines, check marks): shown, selectable, never machined. Operations drop it with a warning. */
  reference?: boolean;
}

/**
 * A ready-made 3D tool-tip path (mm, job coordinates): from an external generator's JSON, a 3D DXF polyline, or Cool CAM's
 * own edge-following strategies. Points are where the tool tip goes: bottom centre of a flat cutter, bottom of a ball.
 */
export interface Path3D {
  id: string;
  name?: string;
  layer?: string;
  /** The generator's tool label (e.g. "B125"), used to group paths and suggest a tool. */
  tool?: string;
  points: [number, number, number][];
}

export interface Stock {
  /** X extent, mm. */
  width: number;
  /** Y extent, mm. */
  length: number;
  thickness: number;
  /** Where X0/Y0 sits on the stock. */
  origin: 'front-left' | 'center' | 'rear-left' | 'front-right' | 'rear-right';
  /** Z0 at stock top (recommended with BitSetter) or bottom. */
  zOrigin: 'top' | 'bottom';
  /**
   * Spoilboard allowance, mm: how far below the stock bottom cutting is planned and allowed (through-cuts into a sacrificial
   * board, mitres finished through the face). Planners floor at bottom − allowance; the simulator treats the spoilboard as
   * material and only reports `below-stock` beyond it. Default 0.
   */
  spoilboard?: number;
}

export interface Job {
  name: string;
  units: 'mm';
  /** Preset id (see MACHINE_PRESETS) or the id of the embedded custom machine below. */
  machineId: string;
  /** A custom machine profile embedded in the job so the post, simulator and MCP server see it without a machines file. */
  machine?: MachineProfile;
  material?: string;
  stock: Stock;
  /** Z for rapids between operations (relative to Z0). */
  safeZ: number;
  /** Z for short retracts inside an operation (relative to Z0). */
  clearanceZ: number;
  tools: Tool[];
  shapes: Shape[];
  /** 3D models (STL/OBJ) for rough3d / finish3d ops. */
  models?: Model[];
  /** 3D tool-tip paths for trace operations. */
  paths?: Path3D[];
  ops: Op[];
  notes?: string;
}

export function newJob(name: string, stock: Partial<Stock> = {}): Job {
  return {
    name,
    units: 'mm',
    machineId: SHAPEOKO_HDM.id,
    stock: { width: 200, length: 200, thickness: 18, origin: 'front-left', zOrigin: 'top', ...stock },
    safeZ: 10,
    clearanceZ: 3,
    tools: DEFAULT_TOOLS.map(t => ({ ...t })),
    shapes: [],
    ops: [],
  };
}

/** Stock bounds in work coordinates. */
export function stockBounds(stock: Stock) {
  let x0 = 0, y0 = 0;
  switch (stock.origin) {
    case 'center': x0 = -stock.width / 2; y0 = -stock.length / 2; break;
    case 'rear-left': y0 = -stock.length; break;
    case 'front-right': x0 = -stock.width; break;
    case 'rear-right': x0 = -stock.width; y0 = -stock.length; break;
  }
  const top = stock.zOrigin === 'top' ? 0 : stock.thickness;
  const bottom = top - stock.thickness;
  /** Lowest Z any cut may reach: the stock bottom minus the spoilboard allowance. */
  const floor = bottom - Math.max(0, stock.spoilboard ?? 0);
  return { x0, y0, x1: x0 + stock.width, y1: y0 + stock.length, top, bottom, floor };
}

export function getTool(job: Job, id: string): Tool {
  const t = job.tools.find(t => t.id === id || String(t.number) === id);
  if (!t) throw new Error(`Unknown tool '${id}'. Available: ${job.tools.map(t => t.id).join(', ')}`);
  return t;
}

export function getShapes(job: Job, ids: string[]): Shape[] {
  return ids.map(id => {
    const s = job.shapes.find(s => s.id === id);
    if (!s) throw new Error(`Unknown shape '${id}'. Available: ${job.shapes.map(s => s.id).join(', ')}`);
    return s;
  });
}

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${counter.toString(36)}`;
}

export function getModel(job: Job, id: string): Model {
  const m = job.models?.find(m => m.id === id);
  if (!m) throw new Error(`Unknown model '${id}'. Available: ${(job.models ?? []).map(m => m.id).join(', ') || 'none'}`);
  return m;
}
