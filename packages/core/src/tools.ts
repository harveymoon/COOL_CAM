export type ToolType = 'endmill' | 'ballnose' | 'vbit' | 'drill';

export interface Tool {
  id: string;
  /** T number emitted by the post (Carbide Motion shows it in the tool-change prompt). */
  number: number;
  name: string;
  type: ToolType;
  /** Cutting diameter, mm. */
  diameter: number;
  flutes: number;
  /** Usable flute length, mm. */
  fluteLength?: number;
  /** Included tip angle in degrees (V-bits, drills). */
  tipAngle?: number;
  /** Default spindle speed, feed and plunge (rpm, mm/min). Ops can override. */
  rpm?: number;
  feed?: number;
  plunge?: number;
  notes?: string;
}

/** Carbide 3D catalogue cutters commonly run on a Shapeoko HDM. Feeds are conservative wood defaults; use feedsAndSpeeds() for material-specific numbers. */
export const DEFAULT_TOOLS: Tool[] = [
  { id: 't201', number: 201, name: '#201 1/4" square endmill', type: 'endmill', diameter: 6.35, flutes: 3, fluteLength: 19, rpm: 18000, feed: 2000, plunge: 600 },
  { id: 't202', number: 202, name: '#202 1/4" ballnose', type: 'ballnose', diameter: 6.35, flutes: 3, fluteLength: 19, rpm: 18000, feed: 2000, plunge: 600 },
  { id: 't102', number: 102, name: '#102 1/8" square endmill', type: 'endmill', diameter: 3.175, flutes: 2, fluteLength: 12.7, rpm: 18000, feed: 1200, plunge: 400 },
  { id: 't101', number: 101, name: '#101 1/8" ballnose', type: 'ballnose', diameter: 3.175, flutes: 2, fluteLength: 12.7, rpm: 18000, feed: 1200, plunge: 400 },
  { id: 't112', number: 112, name: '#112 1/16" square endmill', type: 'endmill', diameter: 1.5875, flutes: 2, fluteLength: 6.35, rpm: 20000, feed: 600, plunge: 200 },
  { id: 't302', number: 302, name: '#302 60° V-bit', type: 'vbit', diameter: 12.7, flutes: 2, tipAngle: 60, rpm: 18000, feed: 1000, plunge: 400 },
  { id: 't301', number: 301, name: '#301 90° V-bit', type: 'vbit', diameter: 12.7, flutes: 2, tipAngle: 90, rpm: 18000, feed: 1000, plunge: 400 },
];

/** Effective cutting radius of a V-bit at a given depth below the tip. */
export function vbitRadiusAtDepth(tool: Tool, depth: number): number {
  const half = ((tool.tipAngle ?? 90) * Math.PI) / 360;
  return Math.min(tool.diameter / 2, depth * Math.tan(half));
}
