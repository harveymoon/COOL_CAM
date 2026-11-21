#!/usr/bin/env node
// Check job files without the app: generate, simulate and post each one, and print what matters before cutting.
//   npm run build && node scripts/check-job.mjs jobs/foo.json [more.json ...] [--nc out.nc]
// Exit code 1 when any job has a simulation error or the post refuses it.
import fs from 'node:fs';
import * as C from '../packages/core/dist/index.js';
import { postGrbl, summarizePost } from '../packages/post/dist/index.js';
import { simulate } from '../packages/sim/dist/index.js';

const args = process.argv.slice(2);
const ncAt = args.indexOf('--nc'); const ncOut = ncAt >= 0 ? args.splice(ncAt, 2)[1] : null;
if (!args.length) { console.error('usage: node scripts/check-job.mjs <job.json> [...] [--nc out.nc]'); process.exit(2); }
let bad = false;
for (const file of args) {
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  const machine = C.machineFor(job); const b = C.stockBounds(job.stock);
  console.log(`\n${job.name}  (${file})`);
  console.log(`  ${machine.name}, ${machine.toolChange}; stock ${job.stock.width} x ${job.stock.length} x ${job.stock.thickness}, Z0 at ${job.stock.zOrigin ?? 'top'}, floor ${b.floor}`);
  const t0 = Date.now(); const tps = C.generateToolpaths(job); const ms = Date.now() - t0;
  for (const tp of tps) {
    const cuts = tp.moves.filter(m => m.kind !== 'rapid' && m.kind !== 'retract');
    const z = cuts.length ? `${Math.min(...cuts.map(m => m.z)).toFixed(3)}..${Math.max(...cuts.map(m => m.z)).toFixed(3)}` : 'no cuts';
    console.log(`  ${tp.opName}  [T${(() => { try { return C.getTool(job, tp.toolId).number; } catch { return '?'; } })()}, ${tp.moves.length} moves, cut Z ${z}]`);
    const counts = new Map(); for (const w of tp.warnings) counts.set(w, (counts.get(w) ?? 0) + 1);
    for (const [w, n] of counts) console.log(`    ! ${w}${n > 1 ? `  (x${n})` : ''}`);
  }
  const sim = simulate(job, tps);
  const errors = sim.events.filter(e => e.severity === 'error'), warns = sim.events.filter(e => e.severity !== 'error');
  console.log(`  simulation: ${errors.length ? `${errors.length} ERROR(S)` : 'clean'}${warns.length ? `, ${warns.length} warning(s)` : ''}; lowest point ${sim.minHeight.toFixed(3)}; generated in ${ms} ms`);
  for (const e of [...errors, ...warns].slice(0, 10)) console.log(`    ${e.severity}: ${e.message}`);
  const post = postGrbl(job, tps, { headerNotes: [errors.length ? `Simulation: ${errors.length} error(s)` : 'Simulation: clean'] });
  if (!post.gcode) { console.log(`  post REFUSED: ${post.warnings.join(' ')}`); bad = true; continue; }
  const changes = post.gcode.split('\n').filter(l => /^M6 /.test(l)).map(l => l.slice(3));
  console.log(`  post: ${summarizePost(post)}; tool changes ${changes.join(' -> ') || 'none'}`);
  if (ncOut && args.length === 1) { fs.writeFileSync(ncOut, post.gcode); console.log(`  wrote ${ncOut}`); }
  if (errors.length) bad = true;
}
process.exit(bad ? 1 : 0);
