/// <reference lib="webworker" />
/**
 * Toolpath generation off the main thread: generate every enabled operation, estimate, post to G-code, and return the
 * derived bundle the UI renders. The store terminates and restarts this worker to cancel an in-flight generation.
 */
import { generateToolpaths, estimate, MACHINES, SHAPEOKO_HDM } from '@cool-cam/core';
import type { Job, Toolpath, ToolpathStats } from '@cool-cam/core';
import { postGrbl } from '@cool-cam/post';

export type GenRequest = { type: 'generate'; id: number; job: Job };
export type GenResponse =
  | { type: 'done'; id: number; toolpaths: Toolpath[]; stats: ToolpathStats[]; gcode: string; totalSeconds: number; signature: string; postWarnings: string[]; ms: number }
  | { type: 'error'; id: number; message: string };

/** Cheap signature of everything the simulation depends on: stock, tool geometry, every move including feeds. */
function signatureOf(job: Job, toolpaths: Toolpath[]): string {
  let sig = `${job.stock.width}x${job.stock.length}x${job.stock.thickness}:${job.stock.origin}:${job.stock.zOrigin}:${job.safeZ}`;
  for (const t of job.tools) sig += `|${t.id}:${t.type}:${t.diameter}:${t.tipAngle ?? ''}:${t.flutes}`;
  for (const tp of toolpaths) {
    let h = 0;
    for (const m of tp.moves) { h = (h * 31 + Math.round(m.x * 1000)) | 0; h = (h * 31 + Math.round(m.y * 1000)) | 0; h = (h * 31 + Math.round(m.z * 1000)) | 0; h = (h * 31 + Math.round(m.f ?? 0) + (m.kind === 'rapid' ? 7 : m.kind === 'retract' ? 11 : 0)) | 0; }
    sig += `|${tp.opId}:${tp.toolId}:${tp.moves.length}:${h}`;
  }
  return sig;
}

self.onmessage = (ev: MessageEvent<GenRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'generate') return;
  const t0 = performance.now();
  try {
    const job = msg.job;
    const machine = MACHINES[job.machineId] ?? SHAPEOKO_HDM;
    const toolpaths = generateToolpaths(job);
    const stats = toolpaths.map(tp => estimate(tp, machine));
    const post = postGrbl(job, toolpaths);
    const out: GenResponse = { type: 'done', id: msg.id, toolpaths, stats, gcode: post.gcode, totalSeconds: post.seconds, signature: signatureOf(job, toolpaths), postWarnings: post.warnings, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(out);
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: 'error', id: msg.id, message: (e as Error).message } satisfies GenResponse);
  }
};
