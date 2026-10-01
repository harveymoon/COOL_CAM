import type { Path3D } from '../job.js';

/**
 * Tool-tip paths from JSON. Accepts a bare array of paths or an object with a `paths` array; each path is
 * `{ id?, name?, tool?, op?|layer?, points: [[x, y, z], ...] }`. Points are mm in job coordinates.
 * An object may carry `units: "inch"` (or `"in"`), in which case everything is converted to mm.
 */
export function parsePathsJson(text: string, opts: { prefix?: string } = {}): Path3D[] {
  const raw = JSON.parse(text) as unknown;
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as { paths?: unknown }).paths)) ? (raw as { paths: unknown[] }).paths : null;
  if (!list) throw new Error('Expected a JSON array of paths or an object with a "paths" array.');
  const units = !Array.isArray(raw) ? String((raw as { units?: unknown }).units ?? 'mm').toLowerCase() : 'mm';
  const k = units === 'inch' || units === 'in' ? 25.4 : 1;
  const prefix = opts.prefix ?? 'path';
  const out: Path3D[] = [];
  list.forEach((p, i) => {
    const o = p as { id?: unknown; name?: unknown; tool?: unknown; op?: unknown; layer?: unknown; points?: unknown };
    if (!Array.isArray(o.points)) throw new Error(`Path ${i + 1} has no points array.`);
    const points = o.points.map((q, j) => {
      if (!Array.isArray(q) || q.length < 3 || q.slice(0, 3).some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error(`Path ${i + 1}, point ${j + 1}: expected [x, y, z] numbers.`);
      return [q[0] * k, q[1] * k, q[2] * k] as [number, number, number];
    });
    const id = o.id !== undefined && o.id !== null ? `${prefix}_${String(o.id)}` : `${prefix}_${i + 1}`;
    const layer = typeof o.layer === 'string' ? o.layer : typeof o.op === 'string' ? o.op : undefined;
    out.push({ id, name: typeof o.name === 'string' ? o.name : undefined, tool: typeof o.tool === 'string' ? o.tool : undefined, layer, points });
  });
  return out;
}
