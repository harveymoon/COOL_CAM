export type ToolChangeMode = 'm6-prompt' | 'm0-pause' | 'none';

export interface MachineProfile {
  id: string;
  name: string;
  /** Controller family. The post emits the common GRBL dialect (G90 G21 G54, G0/G1/G2/G3, M3/M5/M6/M30) which these all accept. */
  controller: 'grbl' | 'grblhal' | 'fluidnc' | 'other';
  /** Work envelope in mm (X, Y, Z travel). */
  travel: { x: number; y: number; z: number };
  /** Max feed (mm/min) accepted for cutting moves. */
  maxFeed: { xy: number; z: number };
  /** Rapid rate (mm/min) used for time estimates. */
  rapid: { xy: number; z: number };
  /** Acceleration (mm/s²) used for time estimates. */
  accel: { xy: number; z: number };
  spindle: { minRpm: number; maxRpm: number; spinUpSeconds: number };
  /**
   * How tool changes are handled by the sender:
   *  - m6-prompt: `M6 T<n>` for every tool; Carbide Motion (BitSetter) and most senders prompt and probe.
   *  - m0-pause: `T<n>` then `M0`; senders without M6 support pause so you can swap the tool and re-zero Z.
   *  - none: a comment only; split the job into one file per tool if the sender cannot pause.
   */
  toolChange: ToolChangeMode;
  /** Machine-coordinate Z (G53) considered safe for tool changes and parking, e.g. -5 on a machine that homes Z at the top. */
  safeZMachine: number;
  notes?: string;
}

export const TOOL_CHANGE_MODES: { value: ToolChangeMode; label: string }[] = [
  { value: 'm6-prompt', label: 'M6 T<n> (Carbide Motion / BitSetter, senders that prompt on M6)' },
  { value: 'm0-pause', label: 'T<n> + M0 pause (gSender, UGS, bCNC, Candle…)' },
  { value: 'none', label: 'comment only (one file per tool)' },
];

const VERIFY = 'Starting point from public specs; verify travel, max rates ($110–$112) and acceleration ($120–$122) against your controller.';

/**
 * Shapeoko HDM defaults. Work area 690 x 610 mm, 80 mm water-cooled VFD spindle 8k–24k rpm, BitSetter fitted.
 * Rapid/accel numbers are GRBL defaults shipped by Carbide 3D and only affect time estimates. Verify against your $110/$111/$112 and $120–$122.
 */
export const SHAPEOKO_HDM: MachineProfile = {
  id: 'shapeoko-hdm',
  name: 'Shapeoko HDM',
  controller: 'grbl',
  travel: { x: 690, y: 610, z: 165 },
  maxFeed: { xy: 10000, z: 5000 },
  rapid: { xy: 10000, z: 5000 },
  accel: { xy: 500, z: 300 },
  spindle: { minRpm: 8000, maxRpm: 24000, spinUpSeconds: 3 },
  toolChange: 'm6-prompt',
  safeZMachine: -5,
  notes: 'Carbide Motion with BitSetter. 80 mm VFD spindle.',
};

/** Built-in machine presets. Users can copy any of them into their own machines file and edit the numbers. */
export const MACHINE_PRESETS: MachineProfile[] = [
  SHAPEOKO_HDM,
  { id: 'shapeoko-5pro-4x4', name: 'Shapeoko 5 Pro 4×4', controller: 'grbl', travel: { x: 1219, y: 1219, z: 101 }, maxFeed: { xy: 10000, z: 5000 }, rapid: { xy: 10000, z: 5000 }, accel: { xy: 400, z: 300 }, spindle: { minRpm: 12000, maxRpm: 30000, spinUpSeconds: 3 }, toolChange: 'm6-prompt', safeZMachine: -5, notes: `Carbide Motion with BitSetter; Carbide Compact Router (12k–30k). ${VERIFY}` },
  { id: 'shapeoko-4-xxl', name: 'Shapeoko 4 XXL', controller: 'grbl', travel: { x: 838, y: 838, z: 101 }, maxFeed: { xy: 5000, z: 3000 }, rapid: { xy: 5000, z: 3000 }, accel: { xy: 400, z: 300 }, spindle: { minRpm: 12000, maxRpm: 30000, spinUpSeconds: 3 }, toolChange: 'm6-prompt', safeZMachine: -5, notes: `Carbide Motion with BitSetter; Carbide Compact Router (12k–30k). ${VERIFY}` },
  { id: 'shapeoko-3-xxl', name: 'Shapeoko 3 XXL', controller: 'grbl', travel: { x: 838, y: 838, z: 80 }, maxFeed: { xy: 5000, z: 3000 }, rapid: { xy: 5000, z: 3000 }, accel: { xy: 400, z: 300 }, spindle: { minRpm: 12000, maxRpm: 30000, spinUpSeconds: 3 }, toolChange: 'm6-prompt', safeZMachine: -5, notes: `Carbide Motion (BitSetter optional; use the M0 mode without one). ${VERIFY}` },
  { id: 'nomad-3', name: 'Nomad 3', controller: 'grbl', travel: { x: 203, y: 203, z: 76 }, maxFeed: { xy: 2500, z: 2500 }, rapid: { xy: 2500, z: 2500 }, accel: { xy: 250, z: 250 }, spindle: { minRpm: 9000, maxRpm: 24000, spinUpSeconds: 3 }, toolChange: 'm6-prompt', safeZMachine: -5, notes: `Carbide Motion with the built-in tool-length probe. ${VERIFY}` },
  { id: 'onefinity-woodworker', name: 'Onefinity Woodworker', controller: 'other', travel: { x: 816, y: 816, z: 133 }, maxFeed: { xy: 10000, z: 5000 }, rapid: { xy: 10000, z: 5000 }, accel: { xy: 500, z: 300 }, spindle: { minRpm: 10000, maxRpm: 30000, spinUpSeconds: 3 }, toolChange: 'm0-pause', safeZMachine: -5, notes: `Buildbotics-based controller; Makita router (10k–30k). ${VERIFY}` },
  { id: 'longmill-mk2-30x30', name: 'LongMill MK2 30×30', controller: 'grbl', travel: { x: 792, y: 845, z: 108 }, maxFeed: { xy: 4000, z: 3000 }, rapid: { xy: 4000, z: 3000 }, accel: { xy: 300, z: 200 }, spindle: { minRpm: 10000, maxRpm: 30000, spinUpSeconds: 3 }, toolChange: 'm0-pause', safeZMachine: -5, notes: `gSender; Makita router (10k–30k). ${VERIFY}` },
  { id: 'x-carve-1000', name: 'X-Carve 1000 mm', controller: 'grbl', travel: { x: 750, y: 750, z: 65 }, maxFeed: { xy: 8000, z: 500 }, rapid: { xy: 8000, z: 500 }, accel: { xy: 300, z: 50 }, spindle: { minRpm: 16000, maxRpm: 27000, spinUpSeconds: 3 }, toolChange: 'm0-pause', safeZMachine: -5, notes: `Easel or UGS; DeWalt 611 (16k–27k). ${VERIFY}` },
  { id: 'genmitsu-3018-pro', name: 'Genmitsu 3018-PRO', controller: 'grbl', travel: { x: 300, y: 180, z: 45 }, maxFeed: { xy: 1500, z: 500 }, rapid: { xy: 2000, z: 500 }, accel: { xy: 100, z: 50 }, spindle: { minRpm: 1000, maxRpm: 10000, spinUpSeconds: 2 }, toolChange: 'm0-pause', safeZMachine: -3, notes: `Candle or UGS; 775 DC spindle. Keep feeds low. ${VERIFY}` },
  { id: 'generic-grbl', name: 'Generic GRBL machine', controller: 'grbl', travel: { x: 400, y: 400, z: 100 }, maxFeed: { xy: 3000, z: 1000 }, rapid: { xy: 3000, z: 1000 }, accel: { xy: 200, z: 100 }, spindle: { minRpm: 8000, maxRpm: 24000, spinUpSeconds: 3 }, toolChange: 'm0-pause', safeZMachine: -5, notes: `Conservative defaults for any GRBL / grblHAL / FluidNC machine. ${VERIFY}` },
];

export const MACHINES: Record<string, MachineProfile> = Object.fromEntries(MACHINE_PRESETS.map(m => [m.id, m]));

/** The machine a job runs on: a profile embedded in the job wins (custom machines), then a preset by id, then the HDM. */
export function machineFor(job: { machineId?: string; machine?: MachineProfile }): MachineProfile {
  if (job.machine && typeof job.machine === 'object' && job.machine.travel) return job.machine;
  return MACHINES[job.machineId ?? ''] ?? SHAPEOKO_HDM;
}

/** Sanity-check a profile coming from a file or an MCP call; returns the problems found. */
export function validateMachine(m: Partial<MachineProfile>): string[] {
  const p: string[] = [];
  if (!m.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(m.id)) p.push('id must be letters, digits, - or _');
  if (!m.name?.trim()) p.push('name is required');
  for (const k of ['travel', 'maxFeed', 'rapid', 'accel'] as const) { const v = m[k] as Record<string, number> | undefined; if (!v || !(v.x > 0 || v.xy > 0)) p.push(`${k} must be positive`); }
  if (!m.spindle || !(m.spindle.minRpm > 0) || !(m.spindle.maxRpm >= m.spindle.minRpm)) p.push('spindle range must be positive with max ≥ min');
  if (m.toolChange && !TOOL_CHANGE_MODES.some(t => t.value === m.toolChange)) p.push('unknown toolChange mode');
  if (typeof m.safeZMachine !== 'number' || m.safeZMachine > 0) p.push('safeZMachine must be a machine-coordinate Z at or below 0');
  return p;
}
