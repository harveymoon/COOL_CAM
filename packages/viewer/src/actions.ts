import { uid, bbox, parseDxf, parseSvg, stockBounds, feedsAndSpeeds, parseStl, parseObj, placementFor, IDENTITY_PLACEMENT, proposeOperations } from '@cool-cam/core';
import type { Op, Shape, MaterialId, Tool, Model } from '@cool-cam/core';
import type { Ui } from './ui';
import { showPanel } from './layout';

/** Shared, menu-callable actions so the menubar, panels and modals do the same thing. */

export function opDefaultName(op: Op) { return op.type === 'profile' ? `Profile ${op.side}` : op.type === 'pocket' ? 'Pocket' : op.type === 'drill' ? 'Drill' : op.type === 'rough3d' ? '3D Rough' : '3D Finish'; }

export function addOperation(ui: Ui, type: Op['type']) {
  const job = ui.job; if (!job) return;
  const tool = job.tools[0]; const shapeIds = ui.selectedShapes.length ? ui.selectedShapes : job.shapes.slice(0, 1).map(s => s.id);
  const base = { id: uid(type), toolId: tool?.id ?? 't201', shapeIds, depth: Math.min(job.stock.thickness, 5), depthPerPass: tool ? Math.min(tool.diameter, job.stock.thickness) : 3 };
  let op: Op;
  const modelId = ui.selectedModel ?? job.models?.[0]?.id;
  if (type === 'pocket') op = { ...base, type: 'pocket', entry: 'helix' };
  else if (type === 'profile') op = { ...base, type: 'profile', side: 'outside', depth: job.stock.thickness, tabs: { count: 4, width: 6, height: 2 } };
  else if (type === 'drill') op = { ...base, type: 'drill', depth: job.stock.thickness, peck: 3 };
  else if (type === 'rough3d') {
    if (!modelId) return;
    const flat = job.tools.find(t => t.type === 'endmill') ?? tool;
    op = { ...base, type: 'rough3d', modelId, shapeIds: [], toolId: flat?.id ?? base.toolId, depth: job.stock.thickness, depthPerPass: Math.min(3, flat?.diameter ?? 3), stepover: flat ? +(flat.diameter * 0.45).toFixed(2) : 3, stockToLeave: 0.3, entry: 'helix', boundaryMode: 'silhouette', containment: 'inside' };
  } else {
    if (!modelId) return;
    const ball = job.tools.find(t => t.type === 'ballnose') ?? tool;
    op = { ...base, type: 'finish3d', modelId, shapeIds: [], toolId: ball?.id ?? base.toolId, depth: job.stock.thickness, stepover: ball ? +(ball.diameter * 0.12).toFixed(2) : 0.5, axis: 'x', boundaryMode: 'silhouette', containment: 'inside' };
  }
  if (tool && job.material) { try { const f = feedsAndSpeeds(tool, job.material as MaterialId); Object.assign(op, { rpm: f.rpm, feed: f.feed, plunge: f.plunge, depthPerPass: Math.min(f.depthPerPass, op.depth) }); if (op.type === 'pocket') op.stepover = f.stepover; } catch { /* unknown material */ } }
  ui.setJob(j => ({ ...j, ops: [...j.ops, op] })); openOpEditor(ui, op.id);
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
  if (!job) { const bb = bbox(polys); ui.createJob(file.name); ui.setJob(j => ({ ...j, stock: { ...j.stock, width: Math.ceil(bb.maxX + 5), length: Math.ceil(bb.maxY + 5) }, shapes })); }
  else ui.setJob(j => { const ids = new Set(j.shapes.map(s => s.id)); for (const s of shapes) if (ids.has(s.id)) s.id = uid(base); return { ...j, shapes: [...j.shapes, ...shapes] }; });
  ui.setSelectedShapes(shapes.map(s => s.id));
}

export function downloadGcode(ui: Ui) {
  const job = ui.job, g = ui.derived?.gcode; if (!job || !g) return;
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
  if (!ui.job) ui.createJob(file.name.replace(/\.[^.]+$/, ''));
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const model: Model = { id: base, name: file.name, positions: Array.from(mesh.positions, v => Math.round(v * 1000) / 1000), placement: { ...IDENTITY_PLACEMENT } };
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
