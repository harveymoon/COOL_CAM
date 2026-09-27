import type { Job } from './job.js';
import type { Op } from './ops.js';
import type { Toolpath } from './toolpath.js';
import { generateProfile } from './ops/profile.js';
import { generatePocket } from './ops/pocket.js';
import { generateDrill } from './ops/drill.js';
import { generateRough3D } from './ops/rough3d.js';
import { generateFinish3D } from './ops/finish3d.js';

export function generateOp(job: Job, op: Op): Toolpath {
  switch (op.type) {
    case 'profile': return generateProfile(job, op);
    case 'pocket': return generatePocket(job, op);
    case 'drill': return generateDrill(job, op);
    case 'rough3d': return generateRough3D(job, op);
    case 'finish3d': return generateFinish3D(job, op);
    default: throw new Error(`Unknown op type ${(op as Op).type}`);
  }
}

export function generateToolpaths(job: Job): Toolpath[] {
  return job.ops.filter(o => o.enabled !== false).map(op => {
    try { return generateOp(job, op); }
    catch (e) { return { opId: op.id, opName: op.name ?? op.type, toolId: op.toolId, rpm: 0, moves: [], warnings: [`Generation failed: ${(e as Error).message}`] }; }
  });
}
