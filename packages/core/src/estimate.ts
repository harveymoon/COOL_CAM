import type { MachineProfile } from './machine.js';
import type { Move, Toolpath, ToolpathStats } from './toolpath.js';

/** Rough cycle-time model: trapezoidal accel, slowing at corners proportional to turn angle. */
export function estimate(tp: Toolpath, machine: MachineProfile, start: Move = { kind: 'rapid', x: 0, y: 0, z: 0 }): ToolpathStats {
  let seconds = 0, cutLength = 0, rapidLength = 0, minZ = Infinity;
  let prev = start; let prevDir: [number, number, number] | null = null;
  for (const m of tp.moves) {
    const dx = m.x - prev.x, dy = m.y - prev.y, dz = m.z - prev.z;
    const d = Math.hypot(dx, dy, dz);
    if (d === 0) { prev = m; continue; }
    const vertical = Math.hypot(dx, dy) < 1e-9;
    const rapid = m.kind === 'rapid';
    const vmax = rapid ? (vertical ? machine.rapid.z : machine.rapid.xy) : Math.min(m.f ?? 1000, vertical ? machine.maxFeed.z : machine.maxFeed.xy);
    const v = vmax / 60; // mm/s
    const a = vertical ? machine.accel.z : machine.accel.xy;
    const dir: [number, number, number] = [dx / d, dy / d, dz / d];
    let corner = 1;
    if (prevDir) { const c = prevDir[0] * dir[0] + prevDir[1] * dir[1] + prevDir[2] * dir[2]; corner = (1 - c) / 2; }
    // time to travel d with accel from a corner-dependent entry speed
    const tAccel = (v / a) * corner;
    seconds += d / v + tAccel;
    if (rapid) rapidLength += d; else cutLength += d;
    if (m.z < minZ) minZ = m.z;
    prevDir = dir; prev = m;
  }
  return { moves: tp.moves.length, cutLength, rapidLength, minZ: isFinite(minZ) ? minZ : 0, seconds };
}

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}
