import { describe, it, expect } from 'vitest';
import { offsetSurface, toolProfile, newJob, generateToolpaths, IDENTITY_PLACEMENT } from '../src/index.js';
import type { Heightmap, Tool, Finish3DOp } from '../src/index.js';

/** The original brute-force drop cutter, kept here as the reference the fast path must reproduce exactly. */
function bruteForce(hm: Heightmap, tool: Tool, stockToLeave = 0, radialExtra = 0): Float32Array {
  const r = tool.diameter / 2 + stockToLeave + radialExtra; const rc = Math.ceil(r / hm.res);
  const dx: number[] = [], dy: number[] = [], dz: number[] = [];
  for (let j = -rc; j <= rc; j++) for (let i = -rc; i <= rc; i++) { const d = Math.hypot(i * hm.res, j * hm.res); if (d <= r) { dx.push(i); dy.push(j); dz.push(toolProfile(tool, d, r)); } }
  const out = new Float32Array(hm.w * hm.h);
  for (let j = 0; j < hm.h; j++) for (let i = 0; i < hm.w; i++) {
    let best = hm.floor;
    for (let k = 0; k < dx.length; k++) { const ii = i + dx[k], jj = j + dy[k]; const zz = (ii < 0 || jj < 0 || ii >= hm.w || jj >= hm.h ? hm.floor : hm.z[jj * hm.w + ii]) - dz[k]; if (zz > best) best = zz; }
    out[j * hm.w + i] = best + stockToLeave;
  }
  return out;
}

const randomMap = (w: number, h: number, seed: number): Heightmap => {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const z = new Float32Array(w * h);
  for (let k = 0; k < z.length; k++) z[k] = -10 + rnd() * (rnd() < 0.1 ? 10 : 2); // a rough floor with tall spikes
  return { w, h, res: 0.25, x0: 0, y0: 0, z, floor: -10 };
};
const endmill = (d: number): Tool => ({ id: 'e', number: 1, name: 'e', type: 'endmill', diameter: d, flutes: 2 });

describe('3D surface size', () => {
  it('refuses a heightmap past the cell limit with a usable resolution, instead of exhausting memory', () => {
    const j = newJob('big', { width: 600, length: 600, thickness: 10 });
    const box = new Float32Array([0, 0, -5, 500, 0, -5, 500, 500, 0, 0, 0, -5, 500, 500, 0, 0, 500, 0]); // two triangles, a ramp
    j.models = [{ id: 'm', positions: Array.from(box), placement: { ...IDENTITY_PLACEMENT, x: 50, y: 50 } }];
    j.ops = [{ id: 'f', type: 'finish3d', toolId: 't201', modelId: 'm', shapeIds: [], depth: 10, resolution: 0.05, boundaryMode: 'stock' } as Finish3DOp];
    const t0 = Date.now(); const [tp] = generateToolpaths(j);
    expect(tp.warnings.join(' ')).toMatch(/M cells at 0.05 mm .* use a coarser resolution \(about 0\.\d+ mm\)/);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('offset surface', () => {
  it('the flat-endmill fast path is identical to the brute-force drop cutter', () => {
    for (const [w, h, d, stl, extra, seed] of [[37, 29, 3.175, 0, 0.1775, 1], [60, 41, 6.35, 0.3, 0.355, 2], [9, 7, 6.35, 0, 0, 3], [50, 50, 1, 0.2, 0.05, 4]] as const) {
      const hm = randomMap(w, h, seed);
      const fast = offsetSurface(hm, endmill(d), stl, extra).z;
      const ref = bruteForce(hm, endmill(d), stl, extra);
      let worst = 0; for (let k = 0; k < ref.length; k++) worst = Math.max(worst, Math.abs(fast[k] - ref[k]));
      expect(worst, `${w}x${h} D${d}`).toBe(0);
    }
  });
  it('is several times faster for a flat endmill on a big grid', () => {
    const hm = randomMap(400, 400, 9);
    const t0 = performance.now(); offsetSurface(hm, endmill(6.35), 0, 0.18); const fast = performance.now() - t0;
    const t1 = performance.now(); bruteForce(hm, endmill(6.35), 0, 0.18); const slow = performance.now() - t1;
    expect(fast * 3).toBeLessThan(slow);
  });
});
