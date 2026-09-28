// Builds one example job per test STL into jobs/example-*.json (+ .nc). Run after `npm run build`:
//   node examples/make-example-jobs.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../packages/core/dist/index.js';
import { postGrbl } from '../packages/post/dist/index.js';
import { simulate } from '../packages/sim/dist/index.js';

import { resolveToolLibrary, readToolLibrary } from '../packages/core/dist/node-paths.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const stlDir = path.join(root, 'examples', 'stl'), jobsDir = path.join(root, 'jobs');
// The examples are built for the cutters in the *user's* library (falling back to the bundled defaults), picked by role below.
const loc = resolveToolLibrary({ bundled: path.join(root, 'library', 'tools.json') });
const library = readToolLibrary(loc.file).length ? readToolLibrary(loc.file) : C.DEFAULT_TOOLS;
console.log(`tool library: ${loc.file} (${library.length} tools)`);
const feeds = (job, toolId) => { const f = C.feedsAndSpeeds(C.getTool(job, toolId), job.material); return { rpm: f.rpm, feed: f.feed, plunge: f.plunge }; };

/** Pick a cutter by role: the closest diameter of the given type, preferring more flutes (multi-flute cuts wood cleaner than a single flute). */
function pickTool(type, diameter, opts = {}) {
  const cands = library.filter(t => t.type === type && Math.abs(t.diameter - diameter) <= (opts.tol ?? 0.2) && (opts.minFlutes ? t.flutes >= opts.minFlutes : true) && (opts.angle ? t.tipAngle === opts.angle : true));
  cands.sort((a, b) => (b.flutes - a.flutes) || Math.abs(a.diameter - diameter) - Math.abs(b.diameter - diameter));
  return cands[0] ?? null;
}
const flat14 = pickTool('endmill', 6.35, { minFlutes: 2 }) ?? pickTool('endmill', 6.35);
const flat18 = pickTool('endmill', 3.175, { minFlutes: 2 }) ?? pickTool('endmill', 3.175);
const flat116 = pickTool('endmill', 1.5875, { minFlutes: 2 }) ?? pickTool('endmill', 1.5875);
const ball18 = pickTool('ballnose', 3.175);
const vbit = pickTool('vbit', 12.7, { angle: 60, tol: 20 }) ?? library.find(t => t.type === 'vbit') ?? null;
// a V-bit the user does not own yet: keep the sign example runnable with a clearly labelled placeholder
const vbitPlaceholder = { id: 'vbit60_todo', number: 302, name: '(to buy) 60° V-bit, 1/4" shank', type: 'vbit', diameter: 12.7, flutes: 2, tipAngle: 60, shankDiameter: 6.35, rpm: 18000, feed: 1000, plunge: 400, notes: 'Not in your library yet. Any 1/4"-shank 60° V-bit (e.g. Carbide 3D #302) — replace this entry with the real cutter.' };
for (const [role, t] of Object.entries({ flat14, flat18, flat116, ball18, vbit })) console.log(`  ${role.padEnd(8)} → ${t ? `T${t.number} ${t.name}` : 'none (placeholder will be used)'}`);
if (!flat14 || !flat18 || !ball18) throw new Error('The library needs a 1/4" flat, a 1/8" flat and a 1/8" ball nose to build the examples.');

const examples = [
  { file: 'dome-cap-2in-12mm.stl', name: 'Example — Dome cap', stock: [80, 80, 13], cutout: { kind: 'circle', d: 50.8 }, finishStep: 0.5 },
  { file: 'half-dodecahedron-2in-12mm.stl', name: 'Example — Dodecahedron', stock: [80, 80, 13], cutout: { kind: 'circle', d: 56 }, finishStep: 0.6 },
  { file: 'squat-pyramid-2in-12mm.stl', name: 'Example — Squat pyramid', stock: [80, 80, 13], cutout: { kind: 'rect', w: 50.8, h: 50.8 }, finishStep: 0.6 },
  { file: 'star-coaster-70mm-12mm.stl', name: 'Example — Star coaster', stock: [95, 95, 13], cutout: { kind: 'circle', d: 70 }, finishStep: 0.35 },
];

for (const ex of examples) {
  const mesh = C.parseStl(fs.readFileSync(path.join(stlDir, ex.file)));
  const job = C.newJob(ex.name, { width: ex.stock[0], length: ex.stock[1], thickness: ex.stock[2] });
  job.material = 'hardwood'; job.tools = library.map(t => ({ ...t }));
  job.notes = `Generated from examples/stl/${ex.file} by examples/make-example-jobs.mjs. Hardwood, 13 mm board, model 12 mm tall with its top at Z0.`;
  const cx = ex.stock[0] / 2, cy = ex.stock[1] / 2;
  const model = { id: 'model', name: ex.file, sourceFile: `examples/stl/${ex.file}`, positions: Array.from(mesh.positions, v => Math.round(v * 1000) / 1000), placement: { ...C.IDENTITY_PLACEMENT } };
  model.placement = C.placementFor(model, { centerX: cx, centerY: cy, top: 0 });
  job.models = [model];
  // cutout shape around the model footprint
  job.shapes = [{ id: 'cutout', name: 'cutout', polyline: ex.cutout.kind === 'circle' ? C.circleShape(cx, cy, ex.cutout.d) : C.rect(cx - ex.cutout.w / 2, cy - ex.cutout.h / 2, ex.cutout.w, ex.cutout.h, 3) }];
  job.ops = [
    { id: 'rough', name: `Rough ${flat14.name}`, type: 'rough3d', toolId: flat14.id, modelId: 'model', shapeIds: [], depth: 12.5, depthPerPass: 3, stepover: 2.8, stockToLeave: 0.3, entry: 'helix', boundaryMode: 'silhouette', containment: 'outside', boundary: 8, ...feeds(job, flat14.id) },
    { id: 'finish', name: `Finish ${ball18.name}`, type: 'finish3d', toolId: ball18.id, modelId: 'model', shapeIds: [], depth: 12.5, stepover: ex.finishStep, axis: 'x', boundaryMode: 'silhouette', containment: 'outside', boundary: 8, ...feeds(job, ball18.id) },
    { id: 'cutout', name: 'Cut out with tabs', type: 'profile', toolId: flat14.id, shapeIds: ['cutout'], side: 'outside', depth: 13, depthPerPass: 4, startDepth: 11, tabs: { count: 4, width: 8, height: 2.5 }, ...feeds(job, flat14.id) },
  ];
  job.tools = job.tools.filter(t => job.ops.some(o => o.toolId === t.id || o.flatToolId === t.id));
  const tps = C.generateToolpaths(job);
  const sim = simulate(job, tps, { resolution: 0.3 });
  const post = postGrbl(job, tps);
  const slug = ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  fs.writeFileSync(path.join(jobsDir, `${slug}.json`), JSON.stringify(job, null, 1));
  fs.writeFileSync(path.join(jobsDir, `${slug}.nc`), post.gcode);
  const errors = sim.events.filter(e => e.severity === 'error');
  console.log(`${slug}: ${tps.map(t => `${t.opName} ${t.moves.length}`).join(', ')} · est ${C.formatDuration(post.seconds)} · sim ${errors.length ? errors.length + ' ERRORS' : 'clean'} · ${post.lines} lines`, tps.flatMap(t => t.warnings));
}

// 2.5D bracket via feature extraction → proposed operations
{
  const mesh = C.parseStl(fs.readFileSync(path.join(stlDir, 'bracket-2p5d-12mm.stl')));
  const job = C.newJob('Example — Bracket (proposed ops)', { width: 90, length: 70, thickness: 12 });
  job.material = 'hardwood'; job.tools = library.map(t => ({ ...t }));
  job.notes = 'Generated by proposeOperations() from examples/stl/bracket-2p5d-12mm.stl: planar floors → exact pockets, holes → drill/bore, tabbed cutout.';
  const model = { id: 'bracket', name: 'bracket-2p5d-12mm.stl', sourceFile: 'examples/stl/bracket-2p5d-12mm.stl', positions: Array.from(mesh.positions, v => Math.round(v * 1000) / 1000), placement: { ...C.IDENTITY_PLACEMENT } };
  model.placement = C.placementFor(model, { centerX: 45, centerY: 35, top: 0 }); job.models = [model];
  // restrict the proposal to the wood cutters (the 10 mm single flute and the tiny DLC bits are not what a bracket wants)
  const p = C.proposeOperations(job, { modelId: 'bracket', toolIds: [flat14.id, flat18.id, flat116?.id, ball18.id].filter(Boolean) });
  job.shapes.push(...p.shapes); job.ops.push(...p.ops); job.notes += '\n' + p.notes.join('\n');
  job.tools = job.tools.filter(t => job.ops.some(o => o.toolId === t.id || o.flatToolId === t.id || o.restToolId === t.id));
  const tps = C.generateToolpaths(job); const sim = simulate(job, tps, { resolution: 0.3 }); const post = postGrbl(job, tps);
  fs.writeFileSync(path.join(jobsDir, 'example-bracket.json'), JSON.stringify(job, null, 1)); fs.writeFileSync(path.join(jobsDir, 'example-bracket.nc'), post.gcode);
  const errors = sim.events.filter(e => e.severity === 'error');
  console.log(`example-bracket: ${tps.map(t => `${t.opName} ${t.moves.length}`).join(', ')} · est ${C.formatDuration(post.seconds)} · sim ${errors.length ? errors.length + ' ERRORS' : 'clean'}`);
  for (const n of p.notes) console.log('  -', n);
}

// V-carved sign: text with a 60° V-bit, flat clearing with a 1/8" endmill, rounded plaque cut out with tabs
{
  const fontFile = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'].find(f => fs.existsSync(f));
  if (fontFile) {
    const job = C.newJob('Example — V-carved sign', { width: 200, length: 100, thickness: 13 });
    job.material = 'hardwood'; job.tools = library.map(t => ({ ...t }));
    const v = vbit ?? vbitPlaceholder; if (!vbit) job.tools.push({ ...vbitPlaceholder });
    job.notes = `Text outlined from a system font, V-carved with ${v.name} (depth cap 4 mm, flat clearing with ${flat18.name}), plaque cut out with ${flat14.name} and tabs.${vbit ? '' : ' The V-bit is a placeholder: buy a 60° V-bit and replace it in the job tools.'}`;
    const font = C.loadFont(fontFile, fs.readFileSync(fontFile).buffer.slice(0));
    const loops = C.textToPolylines(font, { text: 'COOL CAM', size: 28, x: 100, y: 40, align: 'center' });
    const params = { kind: 'text', text: 'COOL CAM', font: path.basename(fontFile).replace(/\.(ttf|otf)$/i, ''), size: 28, x: 100, y: 40, align: 'center' };
    job.shapes = [...loops.map((pl, i) => ({ id: `sign_${i + 1}`, name: `COOL CAM ${i + 1}`, polyline: pl, params, group: 'sign' })), { id: 'plaque', name: 'plaque', polyline: C.rect(15, 15, 170, 70, 10), params: { kind: 'rect', x: 15, y: 15, w: 170, h: 70, r: 10 } }];
    job.ops = [
      { id: 'carve', name: 'V-carve lettering', type: 'vcarve', toolId: v.id, shapeIds: loops.map((_, i) => `sign_${i + 1}`), depth: 4, stepover: 0.4, flatToolId: flat18.id, ...feeds(job, v.id) },
      { id: 'cutout', name: 'Cut out plaque', type: 'profile', toolId: flat14.id, shapeIds: ['plaque'], side: 'outside', depth: 13, depthPerPass: 4, entry: 'ramp', tabs: { count: 4, width: 8, height: 2.5 }, ...feeds(job, flat14.id) },
    ];
    job.tools = job.tools.filter(t => job.ops.some(o => o.toolId === t.id || o.flatToolId === t.id));
    const tps = C.generateToolpaths(job); const sim = simulate(job, tps, { resolution: 0.3 }); const post = postGrbl(job, tps);
    fs.writeFileSync(path.join(jobsDir, 'example-sign.json'), JSON.stringify(job, null, 1)); fs.writeFileSync(path.join(jobsDir, 'example-sign.nc'), post.gcode);
    const errors = sim.events.filter(e => e.severity === 'error');
    console.log(`example-sign: ${tps.map(t => `${t.opName} ${t.moves.length}`).join(', ')} · est ${C.formatDuration(post.seconds)} · ${post.arcs} arcs · sim ${errors.length ? errors.length + ' ERRORS' : 'clean'}`, tps.flatMap(t => t.warnings));
  }
}
