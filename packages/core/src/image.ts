import type { Mesh } from './mesh.js';

/** Grayscale image (0..1 per pixel, row-major, top row first). */
export interface GrayImage { width: number; height: number; data: Float32Array }

export interface HeightmapMeshOptions {
  /** Physical width in mm (height follows the aspect ratio). */
  width: number;
  /** Relief height in mm between black and white. */
  depth: number;
  /** Invert brightness (white = low). */
  invert?: boolean;
  /** Box-blur radius in pixels. */
  blur?: number;
  /** Target grid columns (default 160, max 512). */
  columns?: number;
  /** Solid base below the lowest relief point, mm (default 1). */
  base?: number;
}

/** Turn a grayscale image into a closed relief mesh: white = high (unless inverted). */
export function heightmapToMesh(img: GrayImage, o: HeightmapMeshOptions): Mesh {
  const cols = Math.max(2, Math.min(512, Math.round(o.columns ?? 160)));
  const rows = Math.max(2, Math.round((cols * img.height) / img.width));
  const cell = o.width / (cols - 1); const cellY = ((o.width * img.height) / img.width) / (rows - 1);
  let g = img.data;
  if (o.blur && o.blur > 0) g = boxBlur(g, img.width, img.height, Math.round(o.blur));
  const sample = (u: number, v: number) => { // bilinear, u/v in 0..1 (v=0 at the image top)
    const fx = u * (img.width - 1), fy = v * (img.height - 1); const x0 = Math.floor(fx), y0 = Math.floor(fy); const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1); const tx = fx - x0, ty = fy - y0;
    return (g[y0 * img.width + x0] * (1 - tx) + g[y0 * img.width + x1] * tx) * (1 - ty) + (g[y1 * img.width + x0] * (1 - tx) + g[y1 * img.width + x1] * tx) * ty;
  };
  const base = o.base ?? 1;
  const z = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { let v = sample(i / (cols - 1), 1 - j / (rows - 1)); if (o.invert) v = 1 - v; z[j * cols + i] = base + v * o.depth; }
  const tris: number[] = [];
  const P = (i: number, j: number, zz?: number) => [i * cell, j * cellY, zz ?? z[j * cols + i]];
  const push = (...pts: number[][]) => { for (const p of pts) tris.push(p[0], p[1], p[2]); };
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { push(P(i, j), P(i + 1, j), P(i + 1, j + 1)); push(P(i, j), P(i + 1, j + 1), P(i, j + 1)); }
  // skirt + bottom so the mesh is a solid
  for (let i = 0; i < cols - 1; i++) { push(P(i, 0, 0), P(i + 1, 0, 0), P(i + 1, 0)); push(P(i, 0, 0), P(i + 1, 0), P(i, 0)); push(P(i + 1, rows - 1, 0), P(i, rows - 1, 0), P(i, rows - 1)); push(P(i + 1, rows - 1, 0), P(i, rows - 1), P(i + 1, rows - 1)); }
  for (let j = 0; j < rows - 1; j++) { push(P(0, j + 1, 0), P(0, j, 0), P(0, j)); push(P(0, j + 1, 0), P(0, j), P(0, j + 1)); push(P(cols - 1, j, 0), P(cols - 1, j + 1, 0), P(cols - 1, j + 1)); push(P(cols - 1, j, 0), P(cols - 1, j + 1), P(cols - 1, j)); }
  push(P(0, 0, 0), P(0, rows - 1, 0), P(cols - 1, rows - 1, 0)); push(P(0, 0, 0), P(cols - 1, rows - 1, 0), P(cols - 1, 0, 0));
  return { positions: Float32Array.from(tris) };
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } } tmp[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } } out[y * w + x] = s / n; }
  return out;
}

/** Decode a PNG or JPEG buffer to grayscale (Node only; the browser uses a canvas). */
export async function decodeImage(bytes: Uint8Array): Promise<GrayImage> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  let width: number, height: number, rgba: Uint8Array;
  if (isPng) { const { PNG } = await import('pngjs'); const png = PNG.sync.read(Buffer.from(bytes)); width = png.width; height = png.height; rgba = png.data; }
  else { const jpeg = await import('jpeg-js'); const j = jpeg.decode(bytes, { useTArray: true }); width = j.width; height = j.height; rgba = j.data; }
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) data[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  return { width, height, data };
}
