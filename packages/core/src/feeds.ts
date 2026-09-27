import type { Tool } from './tools.js';

export type MaterialId = 'softwood' | 'hardwood' | 'plywood' | 'mdf' | 'acrylic' | 'hdpe' | 'aluminum' | 'brass' | 'foam';

interface MaterialSpec {
  name: string;
  /** Chip load per flute in mm for a 6.35 mm cutter; scaled roughly linearly with diameter. */
  chipload: number;
  rpm: number;
  /** Depth of cut per pass as a fraction of tool diameter. */
  docFraction: number;
  /** Pocket stepover as a fraction of diameter. */
  stepoverFraction: number;
  /** Plunge feed as a fraction of cutting feed. */
  plungeFraction: number;
  notes?: string;
}

/** Starting points for a rigid machine like the HDM with a 2.2 kW spindle. Conservative; tune by ear and chip colour. */
export const MATERIALS: Record<MaterialId, MaterialSpec> = {
  softwood: { name: 'Softwood (pine, poplar)', chipload: 0.06, rpm: 18000, docFraction: 0.8, stepoverFraction: 0.45, plungeFraction: 0.4 },
  hardwood: { name: 'Hardwood (maple, walnut, oak)', chipload: 0.045, rpm: 18000, docFraction: 0.5, stepoverFraction: 0.4, plungeFraction: 0.35 },
  plywood: { name: 'Plywood (Baltic birch)', chipload: 0.05, rpm: 18000, docFraction: 0.6, stepoverFraction: 0.45, plungeFraction: 0.4 },
  mdf: { name: 'MDF', chipload: 0.06, rpm: 18000, docFraction: 0.8, stepoverFraction: 0.5, plungeFraction: 0.5 },
  acrylic: { name: 'Acrylic (cast)', chipload: 0.045, rpm: 16000, docFraction: 0.5, stepoverFraction: 0.4, plungeFraction: 0.3, notes: 'Use single or 2-flute O-flute if available. Avoid low rpm/feed combos that melt.' },
  hdpe: { name: 'HDPE / Delrin', chipload: 0.06, rpm: 16000, docFraction: 0.6, stepoverFraction: 0.45, plungeFraction: 0.4 },
  aluminum: { name: 'Aluminum 6061', chipload: 0.025, rpm: 15000, docFraction: 0.25, stepoverFraction: 0.35, plungeFraction: 0.25, notes: 'Lubricate (WD-40/alcohol mist). Prefer 2-flute. Ramp or helix entries.' },
  brass: { name: 'Brass 360', chipload: 0.02, rpm: 12000, docFraction: 0.2, stepoverFraction: 0.3, plungeFraction: 0.25 },
  foam: { name: 'Rigid foam', chipload: 0.1, rpm: 12000, docFraction: 1.5, stepoverFraction: 0.6, plungeFraction: 0.6 },
};

export interface FeedsResult {
  material: string;
  tool: string;
  rpm: number;
  feed: number;
  plunge: number;
  depthPerPass: number;
  stepover: number;
  chipload: number;
  notes: string[];
}

export function feedsAndSpeeds(tool: Tool, materialId: MaterialId, opts: { maxRpm?: number; minRpm?: number; maxFeed?: number } = {}): FeedsResult {
  const m = MATERIALS[materialId];
  if (!m) throw new Error(`Unknown material ${materialId}. Known: ${Object.keys(MATERIALS).join(', ')}`);
  const notes: string[] = m.notes ? [m.notes] : [];
  const dia = tool.type === 'vbit' ? Math.min(tool.diameter, 3) : tool.diameter;
  let chipload = m.chipload * Math.min(1.2, Math.max(0.2, dia / 6.35));
  if (tool.type === 'vbit') { chipload *= 0.6; notes.push('V-bit: chipload derated 40%; depth per pass limited to 2 mm.'); }
  if (tool.type === 'ballnose') chipload *= 0.9;
  const rpm = Math.max(opts.minRpm ?? 8000, Math.min(opts.maxRpm ?? 24000, m.rpm));
  let feed = rpm * tool.flutes * chipload;
  if (opts.maxFeed) feed = Math.min(feed, opts.maxFeed);
  feed = Math.round(feed / 10) * 10;
  const plunge = Math.round((feed * m.plungeFraction) / 10) * 10;
  let depthPerPass = Math.round(dia * m.docFraction * 100) / 100;
  if (tool.type === 'vbit') depthPerPass = Math.min(depthPerPass, 2);
  if (tool.fluteLength) depthPerPass = Math.min(depthPerPass, tool.fluteLength);
  const stepover = Math.round(tool.diameter * m.stepoverFraction * 100) / 100;
  return { material: m.name, tool: tool.name, rpm, feed, plunge, depthPerPass, stepover, chipload: Math.round(chipload * 1000) / 1000, notes };
}
