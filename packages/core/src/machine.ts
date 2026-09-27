export interface MachineProfile {
  id: string;
  name: string;
  controller: 'grbl';
  /** Work envelope in mm (X, Y, Z travel). */
  travel: { x: number; y: number; z: number };
  /** Max feed (mm/min) accepted for cutting moves. */
  maxFeed: { xy: number; z: number };
  /** Rapid rate (mm/min) used for time estimates. */
  rapid: { xy: number; z: number };
  /** Acceleration (mm/s²) used for time estimates. */
  accel: { xy: number; z: number };
  spindle: { minRpm: number; maxRpm: number; spinUpSeconds: number };
  /** How tool changes are handled by the sender. */
  toolChange: 'm6-prompt' | 'm0-pause' | 'none';
  /** Machine-coordinate Z (G53) considered safe for tool changes and parking. */
  safeZMachine: number;
}

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
};

export const MACHINES: Record<string, MachineProfile> = { [SHAPEOKO_HDM.id]: SHAPEOKO_HDM };
