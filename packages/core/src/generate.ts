import type { Job } from './job.js';
import type { Op } from './ops.js';
import type { Toolpath } from './toolpath.js';
import { generateProfile } from './ops/profile.js';
import { generatePocket } from './ops/pocket.js';
import { generateDrill } from './ops/drill.js';
import { generateRough3D } from './ops/rough3d.js';
import { generateFinish3D } from './ops/finish3d.js';
import { generateVCarve, flatMoves } from './ops/vcarve.js';
import { generateKeyhole } from './ops/keyhole.js';

export function generateOp(job: Job, op: Op): Toolpath {
  switch (op.type) {
    case 'profile': return generateProfile(job, op);
    case 'pocket': return generatePocket(job, op);
    case 'drill': return generateDrill(job, op);
    case 'rough3d': return generateRough3D(job, op);
    case 'finish3d': return generateFinish3D(job, op);
    case 'vcarve': return generateVCarve(job, op);
    case 'keyhole': return generateKeyhole(job, op);
    default: throw new Error(`Unknown op type ${(op as Op).type}`);
  }
}

export function generateToolpaths(job: Job): Toolpath[] {
  const out: Toolpath[] = [];
  for (const op of job.ops.filter(o => o.enabled !== false)) {
    try {
      const tp = generateOp(job, op);
      // advanced V-carve: the flat-clearing pass runs first with its own tool and its own toolpath id (`<op>:flat`)
      if (op.type === 'vcarve') { const flat = flatMoves.get(op.id); flatMoves.delete(op.id); if (flat && flat.moves.length) out.push({ opId: `${op.id}:flat`, opName: `${op.name ?? 'V-carve'} · flat clearing`, toolId: flat.toolId, rpm: flat.rpm, moves: flat.moves, warnings: flat.warnings, stepdown: flat.stepdown }); }
      out.push(tp);
    } catch (e) { out.push({ opId: op.id, opName: op.name ?? op.type, toolId: op.toolId, rpm: 0, moves: [], warnings: [`Generation failed: ${(e as Error).message}`] }); }
  }
  return out;
}
