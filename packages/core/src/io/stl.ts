import type { Mesh } from '../mesh.js';

/** Parse binary or ASCII STL into a flat triangle soup (mm as-is). */
export function parseStl(data: ArrayBuffer | Uint8Array | string): Mesh {
  if (typeof data === 'string') return parseAsciiStl(data);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(80, bytes.length))).trim();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.length) return parseBinaryStl(dv, n);
  }
  if (head.startsWith('solid')) return parseAsciiStl(new TextDecoder().decode(bytes));
  if (bytes.length >= 84) return parseBinaryStl(dv, dv.getUint32(80, true));
  throw new Error('Not an STL file');
}

function parseBinaryStl(dv: DataView, n: number): Mesh {
  const pos = new Float32Array(n * 9);
  let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12; // normal
    for (let k = 0; k < 9; k++) { pos[i * 9 + k] = dv.getFloat32(o, true); o += 4; }
    o += 2;
  }
  return { positions: pos };
}

function parseAsciiStl(text: string): Mesh {
  const out: number[] = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  if (out.length % 9 !== 0) throw new Error('Malformed ASCII STL');
  return { positions: Float32Array.from(out) };
}

/** Minimal Wavefront OBJ: v and f lines (polygons fan-triangulated). */
export function parseObj(text: string): Mesh {
  const v: number[][] = []; const out: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'f') {
      const idx = t.slice(1).map(s => { const i = parseInt(s.split('/')[0], 10); return i < 0 ? v.length + i : i - 1; });
      for (let i = 1; i + 1 < idx.length; i++) for (const k of [idx[0], idx[i], idx[i + 1]]) out.push(...v[k]);
    }
  }
  return { positions: Float32Array.from(out) };
}

/** Serialize a mesh to binary STL (used for exporting placed models). */
export function toBinaryStl(mesh: Mesh): Uint8Array {
  const n = mesh.positions.length / 9; const buf = new ArrayBuffer(84 + n * 50); const dv = new DataView(buf);
  dv.setUint32(80, n, true); let o = 84; const p = mesh.positions;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 9], ay = p[i * 9 + 1], az = p[i * 9 + 2], bx = p[i * 9 + 3], by = p[i * 9 + 4], bz = p[i * 9 + 5], cx = p[i * 9 + 6], cy = p[i * 9 + 7], cz = p[i * 9 + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const f of [nx, ny, nz]) { dv.setFloat32(o, f, true); o += 4; }
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, p[i * 9 + k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}
