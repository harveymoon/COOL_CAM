import { loadFont, textToPolylines, uid } from '@cool-cam/core';
import type { Shape, ShapeParams } from '@cool-cam/core';
import type { Ui } from './ui';
import { openShapeParams } from './actions';

type TextParams = Extract<ShapeParams, { kind: 'text' }>;
const buffers = new Map<string, Promise<ArrayBuffer>>();
async function fontData(name: string): Promise<ArrayBuffer> {
  let p = buffers.get(name);
  if (!p) { p = fetch(`/api/fonts/${encodeURIComponent(name)}`).then(r => { if (!r.ok) throw new Error(`font ${name} not found`); return r.arrayBuffer(); }); buffers.set(name, p); }
  return p;
}

/** Outline text into a group of shapes (outer loops + holes) that share params and a group id. */
export async function buildTextShapes(params: TextParams, group: string): Promise<Shape[]> {
  const font = loadFont(params.font, await fontData(params.font));
  const loops = textToPolylines(font, { text: params.text, size: params.size, x: params.x, y: params.y, align: params.align, spacing: params.spacing });
  return loops.map((pl, i) => ({ id: `${group}_${i + 1}`, name: `${params.text} ${i + 1}`, polyline: pl, params, group }));
}

export async function addText(ui: Ui, params: TextParams) {
  const group = uid('text');
  const shapes = await buildTextShapes(params, group);
  if (!shapes.length) return;
  ui.setJob(j => ({ ...j, shapes: [...j.shapes, ...shapes] }));
  openShapeParams(ui, shapes.map(s => s.id));
}

/** Rebuild all shapes of a text group from new params, keeping op references valid. */
export async function rebuildText(ui: Ui, id: string, params: TextParams) {
  const job = ui.job; if (!job) return;
  const group = job.shapes.find(s => s.id === id)?.group ?? id;
  const shapes = await buildTextShapes(params, group);
  ui.setJob(j => {
    const oldIds = j.shapes.filter(s => s.group === group).map(s => s.id); const newIds = shapes.map(s => s.id);
    const firstIdx = j.shapes.findIndex(s => s.group === group);
    const rest = j.shapes.filter(s => s.group !== group); rest.splice(Math.max(0, firstIdx), 0, ...shapes);
    return { ...j, shapes: rest, ops: j.ops.map(o => o.shapeIds.some(x => oldIds.includes(x)) ? { ...o, shapeIds: [...o.shapeIds.filter(x => !oldIds.includes(x)), ...newIds] } : o) };
  });
  ui.setSelectedShapes(shapes.map(s => s.id));
}
