import { uid, bbox, parseDxf, parseSvg, stockBounds, feedsAndSpeeds, parseStl, parseObj, placementFor, IDENTITY_PLACEMENT, proposeOperations, polylineFromParams, translateParams, scaleParams, union, difference, intersection, offsetPolygons, normalize, signedArea, newJob } from '@cool-cam/core';
import type { Op, Shape, MaterialId, Tool, Model, ShapeParams, Polyline } from '@cool-cam/core';
import type { Ui } from './ui';
import { showPanel } from './layout';

/** Shared, menu-callable actions so the menubar, panels and modals do the same thing. */

export function opDefaultName(op: Op) { return op.type === 'profile' ? `Profile ${op.side}` : op.type === 'pocket' ? 'Pocket' : op.type === 'drill' ? 'Drill' : op.type === 'rough3d' ? '3D Rough' : op.type === 'finish3d' ? '3D Finish' : op.type === 'vcarve' ? 'V-carve' : 'Keyhole'; }

export function addOperation(ui: Ui, type: Op['type']) {
  const job = ui.job; if (!job) return;
  // a job whose tool table is empty (or lacks the type this op wants) borrows from the library; the chosen tool is added to the job below
  const pool = [...job.tools, ...ui.library.filter(l => !job.tools.some(t => t.id === l.id))];
  const tool = job.tools[0] ?? pool[0]; const shapeIds = ui.selectedShapes.length ? ui.selectedShapes : job.shapes.slice(0, 1).map(s => s.id);
  const base = { id: uid(type), toolId: tool?.id ?? 't201', shapeIds, depth: Math.min(job.stock.thickness, 5), depthPerPass: tool ? Math.min(tool.diameter, job.stock.thickness) : 3 };
  let op: Op;
  const modelId = ui.selectedModel ?? job.models?.[0]?.id;
  if (type === 'pocket') op = { ...base, type: 'pocket', entry: 'helix' };
  else if (type === 'profile') op = { ...base, type: 'profile', side: 'outside', depth: job.stock.thickness, tabs: { count: 4, width: 6, height: 2 } };
  else if (type === 'drill') op = { ...base, type: 'drill', depth: job.stock.thickness, peck: 3 };
  else if (type === 'vcarve') { const v = pool.find(t => t.type === 'vbit'); op = { ...base, type: 'vcarve', toolId: v?.id ?? base.toolId, depth: 0, stepover: 0.4 }; }
  else if (type === 'keyhole') { const k = pool.find(t => t.type === 'keyhole'); op = { ...base, type: 'keyhole', toolId: k?.id ?? base.toolId, depth: Math.min(8, job.stock.thickness - 2), length: 20, angle: 90 }; }
  else if (type === 'rough3d') {
    if (!modelId) return;
    const flat = pool.find(t => t.type === 'endmill') ?? tool;
    op = { ...base, type: 'rough3d', modelId, shapeIds: [], toolId: flat?.id ?? base.toolId, depth: job.stock.thickness, depthPerPass: Math.min(3, flat?.diameter ?? 3), stepover: flat ? +(flat.diameter * 0.45).toFixed(2) : 3, stockToLeave: 0.3, entry: 'helix', boundaryMode: 'silhouette', containment: 'inside' };
  } else {
    if (!modelId) return;
    const ball = pool.find(t => t.type === 'ballnose') ?? tool;
    op = { ...base, type: 'finish3d', modelId, shapeIds: [], toolId: ball?.id ?? base.toolId, depth: job.stock.thickness, stepover: ball ? +(ball.diameter * 0.12).toFixed(2) : 0.5, axis: 'x', boundaryMode: 'silhouette', containment: 'inside' };
  }
  if (tool && job.material) { try { const f = feedsAndSpeeds(tool, job.material as MaterialId); Object.assign(op, { rpm: f.rpm, feed: f.feed, plunge: f.plunge, depthPerPass: Math.min(f.depthPerPass, op.depth) }); if (op.type === 'pocket') op.stepover = f.stepover; } catch { /* unknown material */ } }
  const chosen = pool.find(t => t.id === op.toolId);
  ui.setJob(j => ({ ...j, tools: chosen && !j.tools.some(t => t.id === chosen.id) ? [...j.tools, { ...chosen }].sort((a, b) => a.number - b.number) : j.tools, ops: [...j.ops, op] })); openOpEditor(ui, op.id);
}
export function moveOperation(ui: Ui, id: string, dir: -1 | 1) {
  ui.setJob(j => { const ops = [...j.ops]; const i = ops.findIndex(o => o.id === id); const k = i + dir; if (i < 0 || k < 0 || k >= ops.length) return j; [ops[i], ops[k]] = [ops[k], ops[i]]; return { ...j, ops }; });
}
export function removeOperation(ui: Ui, id: string) { ui.setJob(j => ({ ...j, ops: j.ops.filter(o => o.id !== id) })); if (ui.activeOp === id) ui.setActiveOp(null); }
export function duplicateOperation(ui: Ui, id: string) {
  ui.setJob(j => { const o = j.ops.find(x => x.id === id); if (!o) return j; const c = { ...o, id: uid(o.type), name: `${o.name ?? opDefaultName(o)} copy` } as Op; const ops = [...j.ops]; ops.splice(j.ops.indexOf(o) + 1, 0, c); return { ...j, ops }; });
}

export function duplicateShapes(ui: Ui) {
  const job = ui.job; if (!job) return;
  const t = job.shapes.filter(s => ui.selectedShapes.includes(s.id)); if (!t.length) return;
  const copies = t.map(s => ({ ...s, id: uid('copy'), name: `${s.name ?? s.id} copy`, polyline: { closed: s.polyline.closed, points: s.polyline.points.map(p => ({ x: p.x + 10, y: p.y + 10 })) } }));
  ui.setJob(j => ({ ...j, shapes: [...j.shapes, ...copies] })); ui.setSelectedShapes(copies.map(c => c.id));
}
export function deleteShapes(ui: Ui) {
  const ids = ui.selectedShapes; if (!ids.length) return;
  ui.setJob(j => ({ ...j, shapes: j.shapes.filter(s => !ids.includes(s.id)), ops: j.ops.map(o => ({ ...o, shapeIds: o.shapeIds.filter(id => !ids.includes(id)) })) })); ui.setSelectedShapes([]);
}

export async function importFile(ui: Ui, file: File, placeAtCorner = true) {
  const text = await file.text(); const ext = file.name.split('.').pop()?.toLowerCase();
  let polys = ext === 'dxf' ? parseDxf(text) : ext === 'svg' ? parseSvg(text) : null;
  if (!polys || polys.length === 0) return;
  const job = ui.job; const b = job ? stockBounds(job.stock) : { x0: 0, y0: 0 };
  if (placeAtCorner) { const bb = bbox(polys); polys = polys.map(p => ({ closed: p.closed, points: p.points.map(q => ({ x: q.x - bb.minX + b.x0 + 5, y: q.y - bb.minY + b.y0 + 5 })) })); }
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const shapes: Shape[] = polys.map((p, i) => ({ id: `${base}_${i + 1}`, name: `${base} ${i + 1}`, polyline: p }));
  if (!job) { const bb = bbox(polys); const j = newJob(file.name.replace(/\.[^.]+$/, ''), { width: Math.ceil(bb.maxX + 5), length: Math.ceil(bb.maxY + 5) }); j.shapes = shapes; ui.createJob(j); }
  else ui.setJob(j => { const ids = new Set(j.shapes.map(s => s.id)); for (const s of shapes) if (ids.has(s.id)) s.id = uid(base); return { ...j, shapes: [...j.shapes, ...shapes] }; });
  ui.setSelectedShapes(shapes.map(s => s.id));
}

export function downloadGcode(ui: Ui, force = false) {
  const job = ui.job, g = ui.derived?.gcode; if (!job || !g) return;
  const errors = ui.sim?.summary.events.filter(e => e.severity === 'error') ?? [];
  if (ui.simBusy && !force) { ui.openModal({ kind: 'confirm', title: 'Simulation still running', message: 'The simulation has not finished checking this job. Download the G-code anyway?', onConfirm: () => downloadGcode(ui, true) }); return; }
  if (errors.length && !force) {
    ui.openModal({ kind: 'confirm', title: `Simulation reports ${errors.length} problem(s)`, message: `${errors.slice(0, 5).map(e => e.message).join(' ')}${errors.length > 5 ? ' …' : ''} These moves can break a cutter. Download anyway?`, onConfirm: () => downloadGcode(ui, true) });
    return;
  }
  const blob = new Blob([g], { type: 'text/plain' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${job.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.nc`; a.click(); URL.revokeObjectURL(a.href);
}

export function syncToolsFromLibrary(ui: Ui, tools: Tool[]) {
  ui.setJob(j => { const own = j.tools.filter(t => !tools.some(l => l.id === t.id)); return { ...j, tools: [...tools.map(t => ({ ...t })), ...own] }; });
}

/** Show an operation in the dockable editor pane (opens it beside the viewport when needed). */
export function openOpEditor(ui: Ui, id: string) {
  ui.setActiveOp(id);
  const api = ui.dockRef.current; if (api) showPanel(api, 'opedit');
}

export async function importModelFile(ui: Ui, file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const mesh = ext === 'obj' ? parseObj(await file.text()) : parseStl(await file.arrayBuffer());
  if (!mesh.positions.length) return;
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const model: Model = { id: base, name: file.name, positions: Array.from(mesh.positions, v => Math.round(v * 1000) / 1000), placement: { ...IDENTITY_PLACEMENT } };
  if (!ui.job) { const j = newJob(file.name.replace(/\.[^.]+$/, '')); const b = stockBounds(j.stock); model.placement = placementFor(model, { centerX: (b.x0 + b.x1) / 2, centerY: (b.y0 + b.y1) / 2, top: b.top }); j.models = [model]; ui.createJob(j); ui.setSelectedModel(model.id); return; }
  ui.setJob(j => {
    const b = stockBounds(j.stock);
    if ((j.models ?? []).some(m => m.id === model.id)) model.id = uid(base);
    model.placement = placementFor(model, { centerX: (b.x0 + b.x1) / 2, centerY: (b.y0 + b.y1) / 2, top: b.top });
    return { ...j, models: [...(j.models ?? []), model] };
  });
  ui.setSelectedModel(model.id);
  const api = ui.dockRef.current; if (api) showPanel(api, 'models');
}
export function removeModel(ui: Ui, id: string) {
  ui.setJob(j => ({ ...j, models: (j.models ?? []).filter(m => m.id !== id), ops: j.ops.filter(o => !('modelId' in o) || (o as { modelId: string }).modelId !== id) }));
  if (ui.selectedModel === id) ui.setSelectedModel(null);
}

/** Run feature extraction on a model and append the proposed shapes + ops. Returns the notes. */
export function proposeForModel(ui: Ui, modelId: string): string[] {
  const job = ui.job; if (!job) return [];
  try {
    const p = proposeOperations(job, { modelId });
    const sids = new Set(p.shapes.map(s => s.id)), oids = new Set(p.ops.map(o => o.id));
    ui.setJob(j => ({ ...j, shapes: [...j.shapes.filter(s => !sids.has(s.id)), ...p.shapes], ops: [...j.ops.filter(o => !oids.has(o.id)), ...p.ops] }));
    const api = ui.dockRef.current; if (api) showPanel(api, 'ops');
    return p.notes;
  } catch (e) { return [`Proposal failed: ${(e as Error).message}`]; }
}

/** Show the Parameters panel in shape mode for the given shapes. */
export function openShapeParams(ui: Ui, ids: string[]) {
  ui.setSelectedShapes(ids); ui.setParamsMode('shape');
  const api = ui.dockRef.current; if (api) showPanel(api, 'opedit');
}

export interface TransformOpts { dx?: number; dy?: number; scale?: number; /** per-axis scale (overrides `scale` on that axis) */ scaleX?: number; scaleY?: number; rotateDeg?: number; mirrorX?: boolean; mirrorY?: boolean; aboutCenter?: boolean }
/**
 * Transform the selected shapes (or all when none selected). Pure translations keep primitive parameters; scaling keeps
 * them when the primitive can express the result (rectangles always, circles/polygons/slots only uniformly).
 */
export function transformShapes(ui: Ui, o: TransformOpts) {
  const job = ui.job; if (!job) return;
  const ids = new Set((ui.selectedShapes.length ? ui.selectedShapes : job.shapes.map(s => s.id)));
  const targets = job.shapes.filter(s => ids.has(s.id)); if (!targets.length) return;
  const bb = bbox(targets.map(s => s.polyline)); const c = o.aboutCenter === false ? { x: 0, y: 0 } : { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const dx = o.dx ?? 0, dy = o.dy ?? 0, kx = o.scaleX ?? o.scale ?? 1, ky = o.scaleY ?? o.scale ?? 1, th = ((o.rotateDeg ?? 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const mx = o.mirrorX ? -1 : 1, my = o.mirrorY ? -1 : 1;
  const pureMove = kx === 1 && ky === 1 && th === 0 && mx === 1 && my === 1;
  const pureScale = th === 0 && mx === 1 && my === 1 && dx === 0 && dy === 0;
  const f = (p: { x: number; y: number }) => { const x = (p.x - c.x) * kx * mx, y = (p.y - c.y) * ky * my; return { x: c.x + x * cs - y * sn + dx, y: c.y + x * sn + y * cs + dy }; };
  ui.setJob(j => ({ ...j, shapes: j.shapes.map(s => {
    if (!ids.has(s.id)) return s;
    const points = s.polyline.points.map(f); if (mx * my < 0) points.reverse();
    const params = s.params ? (pureMove ? translateParams(s.params, dx, dy) : pureScale ? scaleParams(s.params, c.x, c.y, kx, ky) : undefined) : undefined;
    // a parametric shape is rebuilt from its parameters so the outline stays exact (corner arcs, circle sampling)
    const pl = params && params.kind !== 'text' ? polylineFromParams(params) : null;
    return { ...s, polyline: pl ?? { closed: s.polyline.closed, points }, params };
  }) }));
}

/** Replace a parametric shape's parameters and rebuild its outline (text shapes are rebuilt by the text module). */
export function applyShapeParams(ui: Ui, id: string, params: ShapeParams) {
  if (params.kind === 'text') { void import('./text').then(m => m.rebuildText(ui, id, params)); return; }
  const pl = polylineFromParams(params); if (!pl) return;
  ui.setJob(j => ({ ...j, shapes: j.shapes.map(s => (s.id === id ? { ...s, polyline: pl, params } : s)) }));
}

/** Boolean the selected closed shapes into new shape(s); the originals are removed. */
export function booleanShapes(ui: Ui, mode: 'union' | 'subtract' | 'intersect') {
  const job = ui.job; if (!job) return;
  const sel = ui.selectedShapes.map(id => job.shapes.find(s => s.id === id)!).filter(s => s && s.polyline.closed);
  if (sel.length < 2) return;
  const a = normalize([sel[0].polyline]); const rest = normalize(sel.slice(1).map(s => s.polyline));
  const out: Polyline[] = mode === 'union' ? union(a.concat(rest)) : mode === 'subtract' ? difference(a, rest) : intersection(a, rest);
  if (!out.length) return;
  const base = `${sel[0].id}_${mode}`; const ids = new Set(sel.map(s => s.id));
  const shapes: Shape[] = out.map((pl, i) => ({ id: out.length > 1 ? `${base}_${i + 1}` : base, name: mode, polyline: pl }));
  ui.setJob(j => ({ ...j, shapes: [...j.shapes.filter(s => !ids.has(s.id)), ...shapes], ops: j.ops.map(o => ({ ...o, shapeIds: o.shapeIds.some(x => ids.has(x)) ? [...o.shapeIds.filter(x => !ids.has(x)), ...shapes.map(s => s.id)] : o.shapeIds })) }));
  openShapeParams(ui, shapes.map(s => s.id));
}

/** Offset the selected closed shapes by d mm (new shapes, originals kept). Open paths get a closed outline around them. */
export function offsetShapes(ui: Ui, d: number) {
  const job = ui.job; if (!job || !d) return;
  const sel = job.shapes.filter(s => ui.selectedShapes.includes(s.id)); if (!sel.length) return;
  const closed = normalize(sel.filter(s => s.polyline.closed).map(s => s.polyline));
  const out = offsetPolygons(closed, d).filter(l => Math.abs(signedArea(l)) > 0.01);
  if (!out.length) return;
  // ids must stay unique even when the same offset is applied again (the originals are kept)
  const taken = new Set(job.shapes.map(s => s.id));
  const shapes: Shape[] = out.map((pl, i) => { const base = `${sel[0].id}_off${d > 0 ? '+' : ''}${d}${out.length > 1 ? `_${i + 1}` : ''}`; const id = taken.has(base) ? uid(base) : base; taken.add(id); return { id, name: `offset ${d}`, polyline: pl }; });
  ui.setJob(j => ({ ...j, shapes: [...j.shapes, ...shapes] }));
  openShapeParams(ui, shapes.map(s => s.id));
}
