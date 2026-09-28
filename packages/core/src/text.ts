import * as opentype from 'opentype.js';
import type { Polyline } from './geometry/polyline.js';
import { chain, cubicPoints, quadPoints, simplify } from './geometry/polyline.js';
import type { Vec2 } from './geometry/vec.js';

export interface TextOptions { text: string; size: number; x: number; y: number; align?: 'left' | 'center' | 'right'; spacing?: number; tolerance?: number }

const fontCache = new Map<string, opentype.Font>();
/** Parse a font file (TTF/OTF) once per key. */
export function loadFont(key: string, data: ArrayBuffer): opentype.Font {
  let f = fontCache.get(key); if (!f) { f = opentype.parse(data); fontCache.set(key, f); } return f;
}

/** Outline a string as closed loops in mm (Y up). `size` is the em size in mm; `y` is the baseline. */
export function textToPolylines(font: opentype.Font, o: TextOptions): Polyline[] {
  const spacing = o.spacing ?? 0;
  const width = font.getAdvanceWidth(o.text, o.size, { kerning: true, letterSpacing: spacing / o.size });
  const x0 = o.align === 'center' ? o.x - width / 2 : o.align === 'right' ? o.x - width : o.x;
  const path = font.getPath(o.text, x0, 0, o.size, { kerning: true, letterSpacing: spacing / o.size });
  const loops: Polyline[] = []; let cur: Vec2[] = []; let pos: Vec2 = { x: 0, y: 0 };
  const P = (x: number, y: number): Vec2 => ({ x, y: o.y - y }); // opentype's y grows downward
  const segs = Math.max(6, Math.round(o.size / 2));
  for (const c of path.commands) {
    switch (c.type) {
      case 'M': if (cur.length > 2) loops.push({ points: cur, closed: true }); cur = [P(c.x, c.y)]; pos = P(c.x, c.y); break;
      case 'L': cur.push(P(c.x, c.y)); pos = P(c.x, c.y); break;
      case 'C': cur.push(...cubicPoints(pos, P(c.x1, c.y1), P(c.x2, c.y2), P(c.x, c.y), segs)); pos = P(c.x, c.y); break;
      case 'Q': cur.push(...quadPoints(pos, P(c.x1, c.y1), P(c.x, c.y), segs)); pos = P(c.x, c.y); break;
      case 'Z': if (cur.length > 2) loops.push({ points: cur, closed: true }); cur = []; break;
    }
  }
  if (cur.length > 2) loops.push({ points: cur, closed: true });
  return chain(loops, 1e-6).filter(l => l.closed).map(l => simplify(l, o.tolerance ?? 0.01));
}
