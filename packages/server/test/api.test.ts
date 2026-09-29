import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, defaultFontDirs } from '../src/index.js';

describe('local API server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-api-'));
  const jobsDir = path.join(dir, 'jobs'); const dataDir = path.join(dir, 'data'); const staticDir = path.join(dir, 'www');
  fs.mkdirSync(staticDir); fs.writeFileSync(path.join(staticDir, 'index.html'), '<title>x</title>');
  const bundled = path.join(dir, 'bundled.json'); fs.writeFileSync(bundled, JSON.stringify([{ id: 'a', number: 1, name: 'a', type: 'endmill', diameter: 6, flutes: 2 }]));
  process.env.COOL_CAM_DATA_DIR = dataDir;
  const started = startServer({ jobsDir, bundledLibrary: bundled, staticDir });
  afterAll(async () => { const { server, api } = await started; api.close(); server.close(); });

  it('serves jobs, tools, fonts, info and the viewer', async () => {
    const { url } = await started;
    expect(await (await fetch(url + 'api/jobs')).json()).toEqual([]);
    const put = await fetch(url + 'api/jobs/demo.json', { method: 'PUT', body: JSON.stringify({ name: 'demo', ops: [] }) });
    expect((await put.json()).ok).toBe(true);
    expect(fs.existsSync(path.join(jobsDir, 'current.json'))).toBe(true);
    expect((await (await fetch(url + 'api/jobs')).json()).map((f: { name: string }) => f.name).sort()).toEqual(['current.json', 'demo.json']);
    expect((await (await fetch(url + 'api/jobs/demo.json')).json()).name).toBe('demo');
    expect((await fetch(url + 'api/jobs/../escape.json', { method: 'PUT', body: '{}' })).status).toBeLessThan(500);
    expect(fs.existsSync(path.join(dir, 'escape.json'))).toBe(false);
    // tool library seeded from the bundled defaults into COOL_CAM_DATA_DIR, then editable
    expect((await (await fetch(url + 'api/tools')).json()).map((t: { id: string }) => t.id)).toEqual(['a']);
    await fetch(url + 'api/tools', { method: 'PUT', body: JSON.stringify([]) });
    expect(await (await fetch(url + 'api/tools')).json()).toEqual([]);
    expect((await (await fetch(url + 'api/tools/defaults')).json()).length).toBe(1);
    const info = await (await fetch(url + 'api/info')).json();
    expect(info.library.file).toBe(path.join(dataDir, 'tools.json'));
    expect(Array.isArray(await (await fetch(url + 'api/fonts')).json())).toBe(true);
    expect(await (await fetch(url + 'anything/spa')).text()).toContain('<title>x</title>');
    expect((await fetch(url + 'api/nope')).status).toBe(404);
  });
  it('lists platform font folders', () => {
    expect(defaultFontDirs(['/extra']).at(-1)).toBe('/extra');
    expect(defaultFontDirs().length).toBeGreaterThan(1);
  });
});
