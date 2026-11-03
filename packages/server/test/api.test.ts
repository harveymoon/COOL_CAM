import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer, defaultFontDirs, hostAllowed } from '../src/index.js';

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
  it('keeps multi-byte text intact across body chunks and refuses oversized bodies', async () => {
    const { url } = await started;
    // well past one socket chunk, so UTF-8 sequences straddle chunk boundaries somewhere
    const name = 'Übung – 日本語 – ñ – 🙂 '.repeat(20000);
    const put = await fetch(url + 'api/jobs/unicode.json', { method: 'PUT', body: JSON.stringify({ name, ops: [] }) });
    expect((await put.json()).ok).toBe(true);
    expect((await (await fetch(url + 'api/jobs/unicode.json')).json()).name).toBe(name);
    expect(fs.readdirSync(jobsDir).filter(f => f.endsWith('.tmp'))).toEqual([]);
    const big = new Uint8Array(3_000_000);
    const r = await fetch(url + 'api/jobs/unicode.jpg', { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: big }).catch(() => null);
    if (r) expect(r.status).toBe(413); // the server may also drop the socket while the client is still sending
    expect(fs.existsSync(path.join(jobsDir, 'unicode.jpg'))).toBe(false);
    await fetch(url + 'api/jobs/unicode.json', { method: 'DELETE' });
  });
  it('refuses a save based on a stale revision and stamps every job with its file', async () => {
    const { url } = await started;
    const put = (body: unknown) => fetch(url + 'api/jobs/rev.json', { method: 'PUT', body: JSON.stringify(body) });
    expect((await put({ name: 'Rev', _rev: 'r1' })).status).toBe(200);
    expect((await (await fetch(url + 'api/jobs/rev.json')).json())._file).toBe('rev.json');
    expect(JSON.parse(fs.readFileSync(path.join(jobsDir, 'current.json'), 'utf8'))._file).toBe('rev.json');
    // the MCP server (or anyone) writes revision r2 directly
    fs.writeFileSync(path.join(jobsDir, 'rev.json'), JSON.stringify({ name: 'Rev by MCP', _rev: 'r2', _file: 'rev.json' }));
    const stale = await put({ name: 'Rev by viewer', _rev: 'r3', _baseRev: 'r1' });
    expect(stale.status).toBe(409);
    const body = await stale.json(); expect(body.rev).toBe('r2'); expect(body.job.name).toBe('Rev by MCP');
    expect(JSON.parse(fs.readFileSync(path.join(jobsDir, 'rev.json'), 'utf8')).name).toBe('Rev by MCP');
    expect((await put({ name: 'Rev by viewer', _rev: 'r3', _baseRev: 'r2' })).status).toBe(200);  // based on the newer one: fine
    expect((await put({ name: 'Script', _rev: 'r4' })).status).toBe(200);                        // no base named: overwrites, as before
    await fetch(url + 'api/jobs/rev.json', { method: 'DELETE' });
  });
  it('reports a corrupt tool library instead of serving it as empty', async () => {
    const { url } = await started;
    const file = path.join(dataDir, 'tools.json'); const good = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, '[{"id": "torn');
    const r = await fetch(url + 'api/tools');
    expect(r.status).toBe(500); expect(await r.text()).toMatch(/not valid JSON/);
    expect(fs.readFileSync(file, 'utf8')).toBe('[{"id": "torn');
    fs.writeFileSync(file, good);
  });
  it('refuses requests whose Host header is not a loopback name (DNS rebinding)', async () => {
    const { port } = await started;
    // fetch() will not let us set Host, so speak HTTP directly
    const get = (host: string, method = 'GET', body = '') => new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: method === 'GET' ? '/api/info' : '/api/machines', method, headers: { host, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject); req.end(body);
    });
    expect(await get(`127.0.0.1:${port}`)).toBe(200);
    expect(await get(`localhost:${port}`)).toBe(200);
    expect(await get(`[::1]:${port}`)).toBe(200);
    expect(await get(`evil.example:${port}`)).toBe(403);
    expect(await get(`localhost.evil.example:${port}`)).toBe(403);
    const before = fs.existsSync(path.join(dataDir, 'machines.json')) ? fs.readFileSync(path.join(dataDir, 'machines.json'), 'utf8') : null;
    expect(await get(`evil.example:${port}`, 'PUT', '[]')).toBe(403);
    expect(fs.existsSync(path.join(dataDir, 'machines.json')) ? fs.readFileSync(path.join(dataDir, 'machines.json'), 'utf8') : null).toBe(before);
    expect(hostAllowed('cnc.local:5174', ['cnc.local'])).toBe(true);
    expect(hostAllowed(undefined)).toBe(true);
  });
  it('lists platform font folders', () => {
    expect(defaultFontDirs(['/extra']).at(-1)).toBe('/extra');
    expect(defaultFontDirs().length).toBeGreaterThan(1);
  });
  it('refuses without a viewer, and relays a viewer-rendered JPEG when one is connected', async () => {
    const { url, api } = await started;
    expect((await fetch(url + 'api/snapshot')).status).toBe(503);
    api.announce(url);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'api.json'), 'utf8')).url).toBe(url);
    // a fake viewer: listen to the event stream, answer the snapshot request with a JPEG
    const ac = new AbortController();
    const es = await fetch(url + 'api/events', { signal: ac.signal });
    const reader = es.body!.getReader(); const dec = new TextDecoder();
    const viewer = (async () => { let buf = ''; for (;;) { const { value, done } = await reader.read(); if (done) return; buf += dec.decode(value); const m = buf.match(/event: snapshot\ndata: (.*)\n/); if (m) { const spec = JSON.parse(m[1]); expect(spec.view).toBe('top'); await fetch(url + 'api/snapshot/' + spec.id, { method: 'POST', body: Buffer.alloc(300, 0xff) }); return; } } })();
    await new Promise(r => setTimeout(r, 50));
    const shot = await fetch(url + 'api/snapshot?view=top&fit=1&maxWidth=800');
    expect(shot.status).toBe(200); expect(shot.headers.get('content-type')).toBe('image/jpeg'); expect((await shot.arrayBuffer()).byteLength).toBe(300);
    await viewer; ac.abort();
  });
});
