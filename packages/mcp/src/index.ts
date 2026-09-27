#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  newJob, parseDxf, parseSvg, bbox, uid, generateToolpaths, estimate, formatDuration, feedsAndSpeeds, MATERIALS, MACHINES, SHAPEOKO_HDM,
  rect, circleShape, polygon, regularPolygon, slot, signedArea, perimeter, stockBounds, getTool,
  parseStl, parseObj, meshBBox, placedMesh, placementFor, IDENTITY_PLACEMENT, getModel, proposeOperations,
} from '@cool-cam/core';
import type { Job, Op, Tool, Shape, Polyline, MaterialId, Model } from '@cool-cam/core';
import { postGrbl, summarizePost } from '@cool-cam/post';
import { simulate } from '@cool-cam/sim';
import { JobState } from './state.js';

const jobsDir = process.env.COOL_CAM_JOBS_DIR ?? path.resolve(process.cwd(), 'jobs');
const libraryFile = process.env.COOL_CAM_LIBRARY ?? path.resolve(jobsDir, '..', 'library', 'tools.json');
function readLibrary(): Tool[] { try { const t = JSON.parse(fs.readFileSync(libraryFile, 'utf8')); return Array.isArray(t) && t.length ? t : []; } catch { return []; } }
function writeLibrary(tools: Tool[]) { fs.mkdirSync(path.dirname(libraryFile), { recursive: true }); fs.writeFileSync(libraryFile, JSON.stringify(tools, null, 1)); }
const state = new JobState(jobsDir);

const server = new McpServer({ name: 'cool-cam', version: '0.1.0' }, {
  instructions: `Cool CAM: 2.5D CAM for a Shapeoko HDM (GRBL, Carbide Motion, BitSetter). Units are mm. Work coordinates: X0/Y0 at the stock origin corner (default front-left), Z0 at stock top. Depths are positive numbers below the stock top.
Typical flow: new_job → import_geometry / add_shape / import_model → (feeds_and_speeds) → add_operation (pocket / profile / drill / rough3d / finish3d) → generate → simulate → export_gcode. Every change is saved to ${jobsDir}/current.json which the web viewer (npm run dev) watches live.`,
});

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
function guarded<T extends Record<string, unknown>>(fn: (args: T) => unknown) {
  return async (args: T) => { try { return text(await fn(args)); } catch (e) { return fail((e as Error).message); } };
}

function shapeSummary(s: Shape) {
  const b = bbox(s.polyline);
  return { id: s.id, name: s.name, layer: s.layer, closed: s.polyline.closed, points: s.polyline.points.length,
    bbox: { minX: r2(b.minX), minY: r2(b.minY), maxX: r2(b.maxX), maxY: r2(b.maxY) }, width: r2(b.maxX - b.minX), height: r2(b.maxY - b.minY),
    area: s.polyline.closed ? r2(Math.abs(signedArea(s.polyline))) : undefined, length: r2(perimeter(s.polyline)) };
}
const r2 = (n: number) => Math.round(n * 100) / 100;
function modelSummary(m: Model) {
  const bb = meshBBox(placedMesh(m));
  return { id: m.id, name: m.name, triangles: m.positions.length / 9, placement: m.placement, placedBBox: { min: bb.min.map(r2), max: bb.max.map(r2) }, size: { x: r2(bb.max[0] - bb.min[0]), y: r2(bb.max[1] - bb.min[1]), z: r2(bb.max[2] - bb.min[2]) } };
}

function jobSummary(job: Job) {
  const b = stockBounds(job.stock);
  return {
    name: job.name, machine: MACHINES[job.machineId]?.name ?? job.machineId, material: job.material,
    stock: { ...job.stock, bounds: b }, safeZ: job.safeZ, clearanceZ: job.clearanceZ,
    tools: job.tools.map(t => ({ id: t.id, number: t.number, name: t.name, type: t.type, diameter: t.diameter, flutes: t.flutes, fluteLength: t.fluteLength, tipAngle: t.tipAngle, rpm: t.rpm, feed: t.feed, plunge: t.plunge })),
    shapes: job.shapes.map(shapeSummary),
    models: (job.models ?? []).map(modelSummary),
    ops: job.ops,
    savedTo: path.join(jobsDir, `${state.slug(job.name)}.json`),
  };
}

const stockSchema = z.object({
  width: z.number().positive().describe('X extent, mm'),
  length: z.number().positive().describe('Y extent, mm'),
  thickness: z.number().positive().describe('Z thickness, mm'),
  origin: z.enum(['front-left', 'center', 'rear-left', 'front-right', 'rear-right']).optional().describe('Where X0 Y0 sits on the stock (default front-left)'),
  zOrigin: z.enum(['top', 'bottom']).optional().describe('Z0 at stock top (default, use with BitSetter) or bottom'),
});

server.registerTool('new_job', {
  title: 'New job',
  description: 'Start a new CAM job with a stock block. Loads the default Carbide 3D tool library (#201, #202, #102, #101, #112, #302, #301).',
  inputSchema: { name: z.string(), stock: stockSchema, material: z.enum(Object.keys(MATERIALS) as [MaterialId, ...MaterialId[]]).optional(), safeZ: z.number().optional().describe('Rapid height above Z0 between operations (default 10)'), clearanceZ: z.number().optional().describe('Retract height above Z0 within an operation (default 3)') },
}, guarded(({ name, stock, material, safeZ, clearanceZ }) => {
  state.job = newJob(name, stock); state.invalidate();
  const lib = readLibrary(); if (lib.length) state.job.tools = lib.map(t => ({ ...t }));
  if (material) state.job.material = material;
  if (safeZ !== undefined) state.job.safeZ = safeZ;
  if (clearanceZ !== undefined) state.job.clearanceZ = clearanceZ;
  state.save();
  return jobSummary(state.job);
}));

server.registerTool('load_job', { title: 'Load job', description: 'Load a saved job by name or path. Omit the name to list saved jobs.', inputSchema: { name: z.string().optional() } },
  guarded(({ name }) => { if (!name) return { jobs: state.list(), dir: jobsDir }; const j = state.load(name); state.save(); return jobSummary(j); }));

server.registerTool('get_job', { title: 'Get job', description: 'Current job summary: stock, tools, shapes (with bounding boxes), operations.', inputSchema: {} },
  guarded(() => jobSummary(state.require())));

server.registerTool('set_stock', { title: 'Set stock', description: 'Change the stock block, origin, material or clearance heights.', inputSchema: { stock: stockSchema.partial().optional(), material: z.string().optional(), safeZ: z.number().optional(), clearanceZ: z.number().optional(), name: z.string().optional() } },
  guarded(({ stock, material, safeZ, clearanceZ, name }) => {
    const job = state.require();
    if (stock) job.stock = { ...job.stock, ...stock };
    if (material !== undefined) job.material = material;
    if (safeZ !== undefined) job.safeZ = safeZ;
    if (clearanceZ !== undefined) job.clearanceZ = clearanceZ;
    if (name) job.name = name;
    state.invalidate(); state.save(); return jobSummary(job);
  }));

server.registerTool('import_geometry', {
  title: 'Import DXF/SVG',
  description: 'Import closed and open contours from a DXF or SVG file into the job as shapes. Returns each shape with its id and bounding box. Use transform_shapes to position them on the stock.',
  inputSchema: { path: z.string().describe('Absolute path to a .dxf or .svg file'), prefix: z.string().optional().describe('Id prefix for the new shapes (default: file name)'), tolerance: z.number().optional().describe('Curve flattening tolerance, mm (default 0.01)') },
}, guarded(({ path: file, prefix, tolerance }) => {
  const job = state.require();
  const txt = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  const polys = ext === '.dxf' ? parseDxf(txt, { tolerance }) : ext === '.svg' ? parseSvg(txt, { tolerance }) : (() => { throw new Error('Only .dxf and .svg are supported'); })();
  const base = prefix ?? path.basename(file, ext).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const added: Shape[] = polys.map((p, i) => ({ id: `${base}_${i + 1}`, polyline: p, name: `${base} ${i + 1}` }));
  for (const s of added) { if (job.shapes.some(x => x.id === s.id)) s.id = uid(base); job.shapes.push(s); }
  state.invalidate(); state.save();
  const all = bbox(added.map(s => s.polyline));
  return { imported: added.length, overallBBox: all, shapes: added.map(shapeSummary), hint: 'Shapes keep the drawing coordinates. Check overallBBox against the stock and use transform_shapes to move them.' };
}));

server.registerTool('import_model', {
  title: 'Import 3D model',
  description: 'Import an STL or OBJ mesh as a model for rough3d/finish3d operations. By default it is centred on the stock with its top flush with the stock top (Z0). Use place_model to adjust.',
  inputSchema: { path: z.string().describe('Absolute path to .stl or .obj'), id: z.string().optional(), scale: z.number().optional().describe('e.g. 25.4 for a model authored in inches'), rotX: z.number().optional(), rotY: z.number().optional(), rotZ: z.number().optional().describe('degrees; applied before placement'), place: z.enum(['center-top', 'corner-top', 'none']).optional() },
}, guarded(({ path: file, id, scale, rotX, rotY, rotZ, place }) => {
  const job = state.require();
  const ext = path.extname(file).toLowerCase();
  const mesh = ext === '.stl' ? parseStl(fs.readFileSync(file)) : ext === '.obj' ? parseObj(fs.readFileSync(file, 'utf8')) : (() => { throw new Error('Only .stl and .obj are supported'); })();
  if (mesh.positions.length === 0) throw new Error('Mesh has no triangles');
  const model: Model = { id: id ?? uid('model'), name: path.basename(file), sourceFile: file, positions: Array.from(mesh.positions, v => Math.round(v * 1000) / 1000), placement: { ...IDENTITY_PLACEMENT, scale: scale ?? 1, rotX: rotX ?? 0, rotY: rotY ?? 0, rotZ: rotZ ?? 0 } };
  const b = stockBounds(job.stock);
  if ((place ?? 'center-top') === 'center-top') model.placement = placementFor(model, { centerX: (b.x0 + b.x1) / 2, centerY: (b.y0 + b.y1) / 2, top: b.top });
  else if (place === 'corner-top') model.placement = placementFor(model, { minX: b.x0 + 5, minY: b.y0 + 5, top: b.top });
  job.models = [...(job.models ?? []).filter(m => m.id !== model.id), model];
  state.invalidate(); state.save();
  const sum = modelSummary(model);
  const warn: string[] = [];
  if (sum.size.z > job.stock.thickness + 1e-6) warn.push(`Model is ${sum.size.z} mm tall but the stock is only ${job.stock.thickness} mm.`);
  if (sum.placedBBox.min[0] < b.x0 || sum.placedBBox.max[0] > b.x1 || sum.placedBBox.min[1] < b.y0 || sum.placedBBox.max[1] > b.y1) warn.push('Model extends outside the stock.');
  return { model: sum, warnings: warn, next: 'add_operation with type rough3d (large flat endmill, stockToLeave 0.3) then finish3d (ball nose, small stepover).' };
}));

server.registerTool('place_model', {
  title: 'Place model',
  description: 'Move, rotate or scale a model. Absolute placement fields replace the current ones; the align options then snap the placed model to the stock.',
  inputSchema: { modelId: z.string(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), rotX: z.number().optional(), rotY: z.number().optional(), rotZ: z.number().optional(), scale: z.number().optional(), align: z.object({ centerX: z.number().optional(), centerY: z.number().optional(), minX: z.number().optional(), minY: z.number().optional(), top: z.number().optional(), bottom: z.number().optional() }).optional().describe('snap the placed bbox: e.g. {centerX:100, centerY:75, top:0}'), remove: z.boolean().optional() },
}, guarded(({ modelId, x, y, z: zz, rotX, rotY, rotZ, scale, align, remove }) => {
  const job = state.require(); const m = getModel(job, modelId);
  if (remove) { job.models = (job.models ?? []).filter(k => k.id !== modelId); job.ops = job.ops.filter(o => !('modelId' in o) || (o as { modelId: string }).modelId !== modelId); state.invalidate(); state.save(); return { models: (job.models ?? []).map(k => k.id) }; }
  m.placement = { ...m.placement, ...(x !== undefined && { x }), ...(y !== undefined && { y }), ...(zz !== undefined && { z: zz }), ...(rotX !== undefined && { rotX }), ...(rotY !== undefined && { rotY }), ...(rotZ !== undefined && { rotZ }), ...(scale !== undefined && { scale }) };
  if (align) m.placement = placementFor(m, align);
  state.invalidate(); state.save();
  return modelSummary(m);
}));

server.registerTool('propose_operations', {
  title: 'Propose operations from a model',
  description: 'Analyse an imported model: planar floors become exact 2.5D pockets (largest endmill that fits, plus a rest pass for corners), matching through-holes become drills, curved faces get 3D rough + finish, and a part sitting on the bed gets a tabbed cutout. With apply=true (default) the shapes and ops are appended to the job.',
  inputSchema: { modelId: z.string(), apply: z.boolean().optional(), boundary: z.number().optional(), cutout: z.boolean().optional(), stockToLeave: z.number().optional(), toolIds: z.array(z.string()).optional(), tabs: z.object({ count: z.number().int(), width: z.number(), height: z.number() }).optional() },
}, guarded(({ modelId, apply, boundary, cutout, stockToLeave, toolIds, tabs }) => {
  const job = state.require();
  const p = proposeOperations(job, { modelId, boundary, cutout, stockToLeave, toolIds, tabs });
  if (apply !== false) {
    const sids = new Set(p.shapes.map(s => s.id)), oids = new Set(p.ops.map(o => o.id));
    job.shapes = [...job.shapes.filter(s => !sids.has(s.id)), ...p.shapes];
    job.ops = [...job.ops.filter(o => !oids.has(o.id)), ...p.ops];
    state.invalidate(); state.save();
  }
  return { applied: apply !== false, notes: p.notes, features: p.features, ops: p.ops.map(o => ({ id: o.id, name: o.name, type: o.type, tool: o.toolId, depth: o.depth, startDepth: o.startDepth })), shapes: p.shapes.map(s => s.id) };
}));

server.registerTool('add_shape', {
  title: 'Add primitive shape',
  description: 'Add a rectangle, circle, slot, regular polygon or free polygon as a shape (mm, in work coordinates).',
  inputSchema: {
    kind: z.enum(['rect', 'circle', 'slot', 'regular_polygon', 'polygon']),
    id: z.string().optional(),
    name: z.string().optional(),
    x: z.number().optional().describe('rect: left edge; circle/regular_polygon: centre X'),
    y: z.number().optional().describe('rect: bottom edge; circle/regular_polygon: centre Y'),
    width: z.number().optional().describe('rect width (X)'),
    height: z.number().optional().describe('rect height (Y)'),
    cornerRadius: z.number().optional(),
    diameter: z.number().optional().describe('circle diameter or regular polygon circumscribed diameter'),
    sides: z.number().int().min(3).optional(),
    rotation: z.number().optional().describe('degrees'),
    x2: z.number().optional().describe('slot end X'), y2: z.number().optional().describe('slot end Y'), slotWidth: z.number().optional(),
    points: z.array(z.object({ x: z.number(), y: z.number() })).optional().describe('polygon vertices'),
    closed: z.boolean().optional().describe('polygon: closed loop (default true)'),
  },
}, guarded((a) => {
  const job = state.require();
  let pl: Polyline;
  switch (a.kind) {
    case 'rect': pl = rect(a.x ?? 0, a.y ?? 0, a.width!, a.height!, a.cornerRadius ?? 0); break;
    case 'circle': pl = circleShape(a.x ?? 0, a.y ?? 0, a.diameter!); break;
    case 'slot': pl = slot(a.x ?? 0, a.y ?? 0, a.x2!, a.y2!, a.slotWidth!); break;
    case 'regular_polygon': pl = regularPolygon(a.x ?? 0, a.y ?? 0, a.sides ?? 6, a.diameter!, a.rotation ?? 0); break;
    case 'polygon': pl = polygon(a.points!, a.closed ?? true); break;
  }
  if (!pl.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('Missing or invalid parameters for ' + a.kind);
  const s: Shape = { id: a.id ?? uid(a.kind), name: a.name, polyline: pl };
  if (job.shapes.some(x => x.id === s.id)) throw new Error(`Shape id ${s.id} already exists`);
  job.shapes.push(s); state.invalidate(); state.save();
  return shapeSummary(s);
}));

server.registerTool('transform_shapes', {
  title: 'Move/scale/rotate shapes',
  description: 'Translate, scale (about origin or shape centre) and rotate shapes. Use to place imported drawings on the stock.',
  inputSchema: { shapeIds: z.array(z.string()).optional().describe('Default: all shapes'), dx: z.number().optional(), dy: z.number().optional(), scale: z.number().optional(), rotateDeg: z.number().optional(), aboutCenter: z.boolean().optional().describe('Scale/rotate about the shapes\' combined bbox centre (default true)'), moveMinTo: z.object({ x: z.number(), y: z.number() }).optional().describe('Translate so the combined bbox min corner lands here (applied first)') },
}, guarded(({ shapeIds, dx, dy, scale, rotateDeg, aboutCenter, moveMinTo }) => {
  const job = state.require();
  const targets = shapeIds ? shapeIds.map(id => { const s = job.shapes.find(x => x.id === id); if (!s) throw new Error(`Unknown shape ${id}`); return s; }) : job.shapes;
  if (!targets.length) throw new Error('No shapes to transform');
  const b0 = bbox(targets.map(s => s.polyline));
  let tx = dx ?? 0, ty = dy ?? 0;
  if (moveMinTo) { tx += moveMinTo.x - b0.minX; ty += moveMinTo.y - b0.minY; }
  const c = aboutCenter === false ? { x: 0, y: 0 } : { x: (b0.minX + b0.maxX) / 2, y: (b0.minY + b0.maxY) / 2 };
  const th = ((rotateDeg ?? 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th), k = scale ?? 1;
  for (const s of targets) s.polyline = { closed: s.polyline.closed, points: s.polyline.points.map(p => {
    const x = (p.x - c.x) * k, y = (p.y - c.y) * k;
    return { x: c.x + x * cs - y * sn + tx, y: c.y + x * sn + y * cs + ty };
  }) };
  state.invalidate(); state.save();
  return { transformed: targets.length, bbox: bbox(targets.map(s => s.polyline)) };
}));

server.registerTool('remove_shapes', { title: 'Remove shapes', description: 'Delete shapes by id (and drop them from operations).', inputSchema: { shapeIds: z.array(z.string()) } },
  guarded(({ shapeIds }) => { const job = state.require(); job.shapes = job.shapes.filter(s => !shapeIds.includes(s.id)); for (const op of job.ops) op.shapeIds = op.shapeIds.filter(id => !shapeIds.includes(id)); state.invalidate(); state.save(); return { shapes: job.shapes.length }; }));

const toolSchema = z.object({
  id: z.string(), number: z.number().int(), name: z.string(), type: z.enum(['endmill', 'ballnose', 'vbit', 'drill']), diameter: z.number().positive(), flutes: z.number().int().positive(),
  fluteLength: z.number().optional(), tipAngle: z.number().optional(), rpm: z.number().optional(), feed: z.number().optional(), plunge: z.number().optional(), notes: z.string().optional(),
});
server.registerTool('add_tool', { title: 'Add/replace tool', description: 'Add a cutter to the job (replaces an existing id). With library=true it is also saved to the shared tool library used for new jobs and by the viewer.', inputSchema: { tool: toolSchema, library: z.boolean().optional() } },
  guarded(({ tool, library }) => { const job = state.require(); job.tools = job.tools.filter(t => t.id !== tool.id); job.tools.push(tool as Tool); job.tools.sort((a, b) => a.number - b.number); state.invalidate(); state.save(); if (library) { const lib = readLibrary().filter(t => t.id !== tool.id); lib.push(tool as Tool); lib.sort((a, b) => a.number - b.number); writeLibrary(lib); } return { tools: job.tools.map(t => t.id), library: library ? libraryFile : undefined }; }));

server.registerTool('library_tools', { title: 'Tool library', description: 'List the shared tool library (library/tools.json). Use add_tool with library=true to add cutters; remove with removeId.', inputSchema: { removeId: z.string().optional() } },
  guarded(({ removeId }) => { let lib = readLibrary(); if (removeId) { lib = lib.filter(t => t.id !== removeId); writeLibrary(lib); } return { file: libraryFile, tools: lib }; }));

server.registerTool('feeds_and_speeds', {
  title: 'Feeds and speeds',
  description: `Recommend rpm, feed, plunge, depth per pass and stepover for a tool in a material on the HDM. Materials: ${Object.keys(MATERIALS).join(', ')}. Conservative starting points.`,
  inputSchema: { toolId: z.string(), material: z.enum(Object.keys(MATERIALS) as [MaterialId, ...MaterialId[]]) },
}, guarded(({ toolId, material }) => { const job = state.require(); const m = MACHINES[job.machineId] ?? SHAPEOKO_HDM; return feedsAndSpeeds(getTool(job, toolId), material, { minRpm: m.spindle.minRpm, maxRpm: m.spindle.maxRpm, maxFeed: m.maxFeed.xy }); }));

const opBase = {
  id: z.string().optional(), name: z.string().optional(), toolId: z.string(), shapeIds: z.array(z.string()).min(1),
  depth: z.number().positive().describe('Total depth below stock top, mm'), depthPerPass: z.number().positive().optional().describe('Default: tool diameter'),
  startDepth: z.number().optional(), rpm: z.number().optional(), feed: z.number().optional().describe('mm/min'), plunge: z.number().optional().describe('mm/min'), enabled: z.boolean().optional(),
};
const opSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('profile'), ...opBase, side: z.enum(['outside', 'inside', 'on']), direction: z.enum(['climb', 'conventional']).optional(), tabs: z.object({ mode: z.enum(['auto', 'manual']).optional().describe('auto: evenly spaced `count` tabs; manual: tabs at `points`'), count: z.number().int(), width: z.number(), height: z.number(), points: z.array(z.object({ x: z.number(), y: z.number() })).optional().describe('manual tab locations (world XY on or near the contour)') }).optional(), stockToLeave: z.number().optional() }),
  z.object({ type: z.literal('pocket'), ...opBase, stepover: z.number().positive().optional().describe('mm, default 40% of diameter'), direction: z.enum(['climb', 'conventional']).optional(), entry: z.enum(['plunge', 'helix', 'ramp']).optional().describe('default helix'), stockToLeave: z.number().optional(), finishPass: z.boolean().optional() }),
  z.object({ type: z.literal('drill'), ...opBase, peck: z.number().optional().describe('Peck depth mm (0 = single plunge)'), dwell: z.number().optional() }),
  z.object({ type: z.literal('rough3d'), ...opBase, shapeIds: z.array(z.string()).optional(), modelId: z.string(), stepover: z.number().positive().optional().describe('mm, default 40% of diameter'), direction: z.enum(['climb', 'conventional']).optional(), entry: z.enum(['plunge', 'helix', 'ramp']).optional(), stockToLeave: z.number().optional().describe('default 0.3 mm'), boundary: z.number().optional().describe('offset applied to the machining boundary, mm (default 0)'), boundaryMode: z.enum(['silhouette', 'bbox', 'stock', 'shapes']).optional().describe('machining boundary: model silhouette (default), model bbox, whole stock, or the op shapeIds'), containment: z.enum(['inside', 'center', 'outside']).optional().describe('tool inside the boundary (default), centre on it, or fully outside'), avoidShapeIds: z.array(z.string()).optional().describe('closed shapes excluded from machining'), resolution: z.number().positive().optional() }),
  z.object({ type: z.literal('finish3d'), ...opBase, shapeIds: z.array(z.string()).optional(), modelId: z.string(), stepover: z.number().positive().optional().describe('mm, default 10% of diameter'), axis: z.enum(['x', 'y']).optional(), stockToLeave: z.number().optional(), boundary: z.number().optional().describe('offset applied to the machining boundary, mm (default 0)'), boundaryMode: z.enum(['silhouette', 'bbox', 'stock', 'shapes']).optional(), containment: z.enum(['inside', 'center', 'outside']).optional(), avoidShapeIds: z.array(z.string()).optional(), finishFloor: z.boolean().optional().describe('also raster the flat floor at the model base (default false)'), resolution: z.number().positive().optional() }),
]);

server.registerTool('add_operation', {
  title: 'Add operation',
  description: 'Append a machining operation. profile: cut outside/inside/on a contour (tabs supported, open paths need side "on"). pocket: clear the inside of closed shapes (nested shapes become islands). drill: peck-drill at the centre of each shape. rough3d: Z-level roughing of an imported model (depthPerPass = stepdown). finish3d: parallel raster finishing of a model (ball nose recommended).',
  inputSchema: { op: opSchema },
}, guarded(({ op }) => {
  const job = state.require();
  getTool(job, op.toolId);
  for (const id of op.shapeIds ?? []) if (!job.shapes.some(s => s.id === id)) throw new Error(`Unknown shape ${id}`);
  if ('modelId' in op) getModel(job, op.modelId);
  const full = { ...op, shapeIds: op.shapeIds ?? [], id: op.id ?? uid(op.type) } as Op;
  if (job.ops.some(o => o.id === full.id)) throw new Error(`Op id ${full.id} exists; use update_operation`);
  job.ops.push(full); state.invalidate(); state.save();
  const tp = generateToolpaths({ ...job, ops: [full] })[0];
  const st = estimate(tp, MACHINES[job.machineId] ?? SHAPEOKO_HDM);
  return { op: full, preview: { moves: st.moves, cutLength: r2(st.cutLength), minZ: st.minZ, estimated: formatDuration(st.seconds), warnings: tp.warnings } };
}));

server.registerTool('update_operation', { title: 'Update operation', description: 'Patch fields of an existing operation by id.', inputSchema: { id: z.string(), patch: z.record(z.unknown()) } },
  guarded(({ id, patch }) => { const job = state.require(); const op = job.ops.find(o => o.id === id); if (!op) throw new Error(`Unknown op ${id}`); Object.assign(op, patch); state.invalidate(); state.save(); return op; }));

server.registerTool('remove_operation', { title: 'Remove operation', description: 'Delete an operation by id.', inputSchema: { id: z.string() } },
  guarded(({ id }) => { const job = state.require(); const n = job.ops.length; job.ops = job.ops.filter(o => o.id !== id); if (job.ops.length === n) throw new Error(`Unknown op ${id}`); state.invalidate(); state.save(); return { ops: job.ops.map(o => o.id) }; }));

server.registerTool('reorder_operations', { title: 'Reorder operations', description: 'Set the execution order of operations (ids not listed keep their relative order at the end).', inputSchema: { ids: z.array(z.string()) } },
  guarded(({ ids }) => { const job = state.require(); const picked = ids.map(id => { const o = job.ops.find(x => x.id === id); if (!o) throw new Error(`Unknown op ${id}`); return o; }); job.ops = [...picked, ...job.ops.filter(o => !ids.includes(o.id))]; state.invalidate(); state.save(); return { ops: job.ops.map(o => o.id) }; }));

function ensureToolpaths() {
  const job = state.require();
  if (!state.toolpaths) state.toolpaths = generateToolpaths(job);
  return state.toolpaths;
}

server.registerTool('generate', { title: 'Generate toolpaths', description: 'Compute toolpaths for all enabled operations and return per-op stats and warnings.', inputSchema: {} },
  guarded(() => {
    const job = state.require(); state.invalidate(); const tps = ensureToolpaths(); const m = MACHINES[job.machineId] ?? SHAPEOKO_HDM;
    let total = 0;
    const ops = tps.map(tp => { const st = estimate(tp, m); total += st.seconds; return { op: tp.opId, name: tp.opName, tool: tp.toolId, moves: st.moves, cutLength: r2(st.cutLength), rapidLength: r2(st.rapidLength), minZ: r2(st.minZ), estimated: formatDuration(st.seconds), warnings: tp.warnings }; });
    return { ops, totalEstimated: formatDuration(total), viewer: 'Open the viewer (npm run dev) to see the toolpaths; it reloads automatically.' };
  }));

server.registerTool('simulate', { title: 'Simulate', description: 'Run the material-removal simulation and report problems: rapids through stock, cuts below the stock bottom, deep plunges. Also reports removed volume.', inputSchema: { resolution: z.number().positive().optional().describe('Grid cell size mm (default auto)') } },
  guarded(({ resolution }) => {
    const job = state.require(); const tps = ensureToolpaths();
    const s = simulate(job, tps, { resolution });
    const errors = s.events.filter(e => e.severity === 'error');
    return { removedVolumeCm3: r2(s.removedVolume / 1000), minZ: r2(s.minHeight), grid: s.cells, problems: s.events.slice(0, 50), verdict: errors.length ? `${errors.length} error(s) — fix before cutting` : 'No collisions or over-depth cuts detected' };
  }));

server.registerTool('export_gcode', {
  title: 'Export G-code',
  description: 'Post-process all toolpaths to GRBL G-code for Carbide Motion (M6 tool changes with BitSetter) and write it to a file. Returns a summary and the first lines.',
  inputSchema: { path: z.string().optional().describe('Output .nc path (default jobs/<name>.nc)'), toolChange: z.enum(['m6-prompt', 'm0-pause', 'none']).optional().describe('m6-prompt for Carbide Motion; m0-pause for gSender/CNCjs'), parkAtOrigin: z.boolean().optional() },
}, guarded(({ path: out, toolChange, parkAtOrigin }) => {
  const job = state.require(); const tps = ensureToolpaths();
  const r = postGrbl(job, tps, { toolChange, parkAtOrigin });
  const file = out ?? path.join(jobsDir, `${state.slug()}.nc`);
  fs.writeFileSync(file, r.gcode);
  const allWarnings = [...r.warnings, ...tps.flatMap(t => t.warnings.map(w => `${t.opName}: ${w}`))];
  return { file, summary: summarizePost(r), warnings: allWarnings, head: r.gcode.split('\n').slice(0, 30).join('\n') };
}));

server.registerTool('machine_info', { title: 'Machine info', description: 'Machine profile (travel, feeds, spindle) and the list of materials known to the feeds calculator.', inputSchema: {} },
  guarded(() => ({ machine: SHAPEOKO_HDM, materials: Object.entries(MATERIALS).map(([id, m]) => ({ id, name: m.name })) })));

server.registerResource('current-job', 'cool-cam://job/current', { title: 'Current job', description: 'The current job as JSON', mimeType: 'application/json' },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: state.job ? JSON.stringify(state.job, null, 2) : '{}' }] }));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[cool-cam] MCP server ready. Jobs dir: ${jobsDir}`);
}
main().catch(e => { console.error(e); process.exit(1); });
