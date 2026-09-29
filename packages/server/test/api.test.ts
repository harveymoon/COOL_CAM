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
  it('lists project summaries, stores thumbnails and deletes projects', async () => {
    const { url } = await started;
    await fetch(url + 'api/jobs/coaster.json', { method: 'PUT', body: JSON.stringify({ name: 'Coaster', material: 'mdf', stock: { width: 90, length: 90, thickness: 12 }, ops: [{}, {}], shapes: [{}], models: [] }) });
    let list = await (await fetch(url + 'api/jobs')).json();
    const entry = list.find((e: { name: string }) => e.name === 'coaster.json');
    expect(entry.summary).toMatchObject({ name: 'Coaster', material: 'mdf', ops: 2, shapes: 1, models: 0, stock: { width: 90, length: 90, thickness: 12 } });
    expect(entry.thumb).toBeNull();
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    expect((await (await fetch(url + 'api/jobs/coaster.jpg', { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpg })).json()).ok).toBe(true);
    list = await (await fetch(url + 'api/jobs')).json();
    expect(list.find((e: { name: string }) => e.name === 'coaster.json').thumb).toBe('coaster.jpg');
    const got = await fetch(url + 'api/jobs/coaster.jpg'); expect(got.headers.get('content-type')).toBe('image/jpeg'); expect((await got.arrayBuffer()).byteLength).toBe(4);
    expect((await fetch(url + 'api/jobs/current.json', { method: 'DELETE' })).status).toBe(400);
    expect((await (await fetch(url + 'api/jobs/coaster.json', { method: 'DELETE' })).json()).ok).toBe(true);
    expect(fs.existsSync(path.join(jobsDir, 'coaster.jpg'))).toBe(false);
    list = await (await fetch(url + 'api/jobs')).json();
    expect(list.some((e: { name: string }) => e.name === 'coaster.json')).toBe(false);
  });
  it('stores the user\'s machines next to the tool library', async () => {
    const { url } = await started;
    expect(await (await fetch(url + 'api/machines')).json()).toEqual([]);
    const m = { id: 'my-router', name: 'My router', controller: 'grbl', travel: { x: 300, y: 300, z: 80 }, maxFeed: { xy: 3000, z: 1000 }, rapid: { xy: 3000, z: 1000 }, accel: { xy: 200, z: 100 }, spindle: { minRpm: 8000, maxRpm: 24000, spinUpSeconds: 3 }, toolChange: 'm0-pause', safeZMachine: -5 };
    expect((await (await fetch(url + 'api/machines', { method: 'PUT', body: JSON.stringify([m]) })).json()).ok).toBe(true);
    expect((await (await fetch(url + 'api/machines')).json())[0].id).toBe('my-router');
    expect(fs.existsSync(path.join(dataDir, 'machines.json'))).toBe(true);
    expect((await fetch(url + 'api/machines', { method: 'PUT', body: '{}' })).status).toBe(400);
  });
  it('lists platform font folders', () => {
    expect(defaultFontDirs(['/extra']).at(-1)).toBe('/extra');
    expect(defaultFontDirs().length).toBeGreaterThan(1);
  });
});
