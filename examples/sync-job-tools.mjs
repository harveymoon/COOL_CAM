// Re-points every operation in the given job files at the matching cutter in the user's tool library (by type, diameter,
// tip angle; more flutes preferred), trims each job's embedded tool table to the tools its operations use, then re-posts
// the .nc and re-simulates. Run after `npm run build`:
//   node examples/sync-job-tools.mjs            # all jobs/*.json
//   node examples/sync-job-tools.mjs jobs/foo.json ...
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../packages/core/dist/index.js';
import { postGrbl } from '../packages/post/dist/index.js';
import { simulate } from '../packages/sim/dist/index.js';
import { resolveToolLibrary, readToolLibrary } from '../packages/core/dist/node-paths.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const jobsDir = path.join(root, 'jobs');
const loc = resolveToolLibrary({ bundled: path.join(root, 'library', 'tools.json') });
const library = readToolLibrary(loc.file);
if (!library.length) { console.error(`tool library ${loc.file} is empty`); process.exit(1); }
console.log(`library: ${loc.file} (${library.length} tools)`);

/** Closest library cutter for a tool spec: same type, nearest diameter (within 25% or 0.3 mm), same V angle, more flutes preferred. */
function match(spec) {
  const exact = library.find(t => t.id === spec.id);
  if (exact) return { tool: exact, how: 'same id' };
  const cands = library.filter(t => t.type === spec.type && (spec.type !== 'vbit' || Math.abs((t.tipAngle ?? 0) - (spec.tipAngle ?? 0)) < 1))
    .map(t => ({ t, dd: Math.abs(t.diameter - spec.diameter) }))
    .filter(c => c.dd <= Math.max(0.3, spec.diameter * 0.25))
    .sort((a, b) => a.dd - b.dd || b.t.flutes - a.t.flutes);
  if (cands.length) return { tool: cands[0].t, how: `${spec.type} Ø${spec.diameter} → Ø${cands[0].t.diameter}` };
  return null;
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(jobsDir).filter(f => f.endsWith('.json')).map(f => path.join(jobsDir, f));
for (const file of files) {
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  const oldTools = job.tools ?? [];
  const notes = [];
  const remap = new Map();
  const needed = new Map();
  const resolve = (id, what) => {
    if (remap.has(id)) return remap.get(id);
    const spec = oldTools.find(t => t.id === id) ?? library.find(t => t.id === id);
    let picked = spec ? match(spec) : null;
    let tool = picked?.tool;
    if (!tool) {
      // keep the old definition so the job still generates, clearly labelled as something the user does not own
      tool = spec ? { ...spec, name: spec.name.startsWith('(to buy)') ? spec.name : `(to buy) ${spec.name}`, notes: `Not in your library. ${spec.notes ?? ''}`.trim() } : null;
      if (!tool) { notes.push(`${what}: unknown tool '${id}' left as is`); return id; }
      notes.push(`${what}: no library match for ${spec.name}; kept as a placeholder`);
    } else if (picked.how !== 'same id') notes.push(`${what}: ${spec.name} → ${tool.name} (${picked.how})`);
    remap.set(id, tool.id); needed.set(tool.id, tool);
    return tool.id;
  };
  for (const op of job.ops) {
    op.toolId = resolve(op.toolId, op.name ?? op.id);
    if (op.flatToolId) op.flatToolId = resolve(op.flatToolId, `${op.name ?? op.id} (flat clearing)`);
    if (op.restToolId) op.restToolId = resolve(op.restToolId, `${op.name ?? op.id} (rest of)`);
  }
  job.tools = [...needed.values()].sort((a, b) => a.number - b.number);
  delete job._rev; delete job._savedAt;
  const tps = C.generateToolpaths(job);
  const sim = simulate(job, tps);
  const errors = sim.events.filter(e => e.severity === 'error');
  const post = postGrbl(job, tps, { headerNotes: [errors.length ? `Simulation: ${errors.length} error(s)` : 'Simulation: clean'] });
  fs.writeFileSync(file, JSON.stringify(job, null, 1));
  const nc = file.replace(/\.json$/, '.nc');
  if (fs.existsSync(nc) || /example-/.test(file)) fs.writeFileSync(nc, post.gcode);
  console.log(`${path.basename(file)}: ${oldTools.length} → ${job.tools.length} tools [${job.tools.map(t => 'T' + t.number).join(' ')}] · ${tps.length} toolpaths · sim ${errors.length ? errors.length + ' ERRORS' : 'clean'}`);
  for (const n of notes) console.log('   -', n);
}
