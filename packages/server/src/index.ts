/**
 * The local API the viewer talks to: jobs, tool library, fonts, and a change feed. Plain Node, no framework, so the same
 * code is mounted as Vite middleware in development, hosted by the Electron main process in the packaged app, and run by
 * the `cool-cam` CLI for a browser without Electron. The viewer only ever calls `fetch('/api/...')` and listens to
 * `/api/events` (server-sent events), so it never learns which host it is running under.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { resolveToolLibrary, readToolLibrary, writeToolLibrary, writeFileAtomic, defaultFontDirs, type LibraryLocation } from '@cool-cam/core/node';

export interface ApiOptions {
  /** Folder holding <slug>.json jobs and current.json. Created if missing. */
  jobsDir: string;
  /**
   * Host names (without port) accepted in the Host header besides loopback (localhost, *.localhost, 127.0.0.1, ::1).
   * Needed only when the API is deliberately served on a LAN address.
   */
  allowedHosts?: string[];
  /** The read-only bundled tool defaults (repo `library/tools.json`); seeds the user library on first use. */
  bundledLibrary?: string;
  /** Extra font directories on top of the platform defaults. */
  fontDirs?: string[];
}

export interface Api {
  jobsDir: string;
  library: LibraryLocation;
  fontDirs: string[];
  /** Handle one request. Returns false (and touches nothing) when the URL is not an /api route. */
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
  /** Subscribe to job-folder changes (debounced). */
  onJobsChanged(cb: (file: string | null) => void): () => void;
  close(): void;
  /** Record where this API is reachable (`<userDir>/api.json`) so the MCP server can find the viewer, e.g. for screenshots. */
  announce(url: string): void;
}

/** Platform font folders the text tool can read TTF/OTF files from (lives in core/node; re-exported for existing callers). */
export { defaultFontDirs };

/** Default jobs folder outside the repo: ~/Documents/Cool CAM/jobs (COOL_CAM_JOBS_DIR overrides). */
export function defaultJobsDir(documentsDir = path.join(os.homedir(), 'Documents')): string {
  return process.env.COOL_CAM_JOBS_DIR ?? path.join(documentsDir, 'Cool CAM', 'jobs');
}

function listFonts(dirs: string[]): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(f, depth + 1); }
      else if (/\.(ttf|otf)$/i.test(e.name)) out.push({ name: e.name.replace(/\.(ttf|otf)$/i, ''), file: f });
    }
  };
  for (const d of dirs) walk(d, 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const json = (res: http.ServerResponse, v: unknown, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
/** Jobs can embed meshes, so the JSON limit is generous; it only has to stop a runaway client from exhausting memory. */
const MAX_JSON_BODY = 256 * 1024 * 1024;
const MAX_IMAGE_BODY = 2_000_000;
class BodyTooLarge extends Error { status = 413; }
/** Collect the body as bytes (never as concatenated strings: a multi-byte character split across chunks would be mangled). */
const readBytes = (req: http.IncomingMessage, limit: number) => new Promise<Buffer>((resolve, reject) => {
  const parts: Buffer[] = []; let n = 0;
  req.on('data', (c: Buffer) => { n += c.length; if (n > limit) { reject(new BodyTooLarge(`request body exceeds ${Math.round(limit / 1e6)} MB`)); req.destroy(); return; } parts.push(c); });
  req.on('end', () => resolve(Buffer.concat(parts))); req.on('error', reject);
});
const readBody = (req: http.IncomingMessage, limit = MAX_JSON_BODY) => readBytes(req, limit).then(b => b.toString('utf8'));
/** Error reply for the async handlers: an aborted or oversized request must never become an unhandled rejection in the host process. */
const fail = (res: http.ServerResponse, e: unknown) => { if (res.headersSent) return; res.statusCode = e instanceof BodyTooLarge ? e.status : 500; res.end(String((e as Error).message ?? e)); };

/** What the landing page shows per project without loading the whole (possibly multi-MB) job. */
export interface JobListEntry { name: string; mtime: number; thumb: string | null; summary: { name: string; material?: string; stock?: { width: number; length: number; thickness: number }; ops: number; shapes: number; models: number; savedAt?: string } | null }
const summaryCache = new Map<string, { mtime: number; summary: JobListEntry['summary'] }>();
function summarize(file: string, mtime: number): JobListEntry['summary'] {
  const hit = summaryCache.get(file); if (hit && hit.mtime === mtime) return hit.summary;
  let summary: JobListEntry['summary'] = null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    summary = { name: j.name ?? path.basename(file, '.json'), material: j.material, stock: j.stock ? { width: j.stock.width, length: j.stock.length, thickness: j.stock.thickness } : undefined, ops: (j.ops ?? []).length, shapes: (j.shapes ?? []).length, models: (j.models ?? []).length, savedAt: j._savedAt };
  } catch { /* unreadable: listed without a summary */ }
  summaryCache.set(file, { mtime, summary }); return summary;
}

/** Is this Host header a loopback name (or one the host app allows)? A missing header (HTTP/1.0 tools) is allowed. */
export function hostAllowed(host: string | undefined, extra: string[] = []): boolean {
  if (!host) return true;
  const name = (host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '')).toLowerCase();
  return name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1' || name === '::1' || extra.map(h => h.toLowerCase()).includes(name);
}

/** `_rev` of a job file on disk, cached by mtime (jobs can be multi-MB; a save should not parse the old one every time). */
const revCache = new Map<string, { mtime: number; rev: string | null }>();
function revOf(file: string): string | null {
  let st: fs.Stats; try { st = fs.statSync(file); } catch { return null; }
  const hit = revCache.get(file); if (hit && hit.mtime === st.mtimeMs) return hit.rev;
  let rev: string | null = null;
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); rev = typeof j._rev === 'string' ? j._rev : null; } catch { /* unreadable: no revision to defend */ }
  revCache.set(file, { mtime: st.mtimeMs, rev }); return rev;
}

export function createApi(opts: ApiOptions): Api {
  const jobsDir = opts.jobsDir;
  fs.mkdirSync(jobsDir, { recursive: true });
  const library = resolveToolLibrary({ bundled: opts.bundledLibrary });
  const fontDirs = defaultFontDirs(opts.fontDirs);
  const listeners = new Set<(file: string | null) => void>();
  const clients = new Set<http.ServerResponse>();
  // viewport screenshots: a GET parks here until a connected viewer renders and POSTs the JPEG back (or it times out)
  const pendingShots = new Map<string, { resolve: (buf: Buffer) => void; reject: (e: Error) => void }>();
  const announceFile = path.join(library.userDir, 'api.json');
  let announced = false;
  let timer: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(jobsDir, { persistent: false }, (_ev, file) => {
      if (file && String(file).endsWith('.tmp')) return; // atomic writes land as <file>.<pid>.<rand>.tmp then a rename
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { const f = file ? String(file) : null; for (const cb of listeners) cb(f); for (const c of clients) c.write(`event: jobs-changed\ndata: ${JSON.stringify({ file: f })}\n\n`); }, 150);
    });
  } catch { /* watching unsupported: the viewer still works, it just does not auto-reload */ }

  const handle = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/')) return false;
    // DNS rebinding: a web page on evil.example can point its own name at 127.0.0.1 and then talk to this server as a
    // same-origin page, reading /api/info or rewriting machines.json (safe Z) and tools.json (diameters). Its requests
    // still carry its own name in the Host header, so only loopback names (and any the host app lists) are served.
    if (!hostAllowed(req.headers.host, opts.allowedHosts)) { res.statusCode = 403; res.end('forbidden host'); return true; }
    const route = url.split('?')[0];
    try {
      if (route === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n'); clients.add(res);
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
        req.on('close', () => { clients.delete(res); clearInterval(ping); });
        return true;
      }
      if (route === '/api/info') { json(res, { jobsDir, library: { file: library.file, source: library.source, userDir: library.userDir, bundled: library.bundled }, fontDirs, platform: process.platform }); return true; }
      if (route === '/api/fonts') { json(res, listFonts(fontDirs).map(f => f.name)); return true; }
      if (route.startsWith('/api/fonts/')) {
        const name = decodeURIComponent(route.slice('/api/fonts/'.length));
        const hit = listFonts(fontDirs).find(f => f.name === name); if (!hit) { res.statusCode = 404; res.end('font not found'); return true; }
        res.setHeader('content-type', 'font/ttf'); res.end(fs.readFileSync(hit.file)); return true;
      }
      if (route === '/api/snapshot') {
        if (!clients.size) { json(res, { error: 'No viewer is connected. Open Cool CAM (the app, or npm run dev) and try again.' }, 503); return true; }
        const q = new URL(url, 'http://x').searchParams;
        const id = Math.random().toString(36).slice(2);
        const spec = { id, view: q.get('view') ?? 'current', fit: q.get('fit') === '1' || q.get('fit') === 'true', maxWidth: Math.min(2560, Math.max(320, Number(q.get('maxWidth')) || 1280)), quality: Math.min(1, Math.max(0.3, Number(q.get('quality')) || 0.85)) };
        const timeout = setTimeout(() => { pendingShots.delete(id); json(res, { error: 'The viewer did not answer within 10 s.' }, 504); }, 10000);
        pendingShots.set(id, { resolve: buf => { clearTimeout(timeout); pendingShots.delete(id); res.statusCode = 200; res.setHeader('content-type', 'image/jpeg'); res.setHeader('cache-control', 'no-cache'); res.end(buf); }, reject: e => { clearTimeout(timeout); pendingShots.delete(id); json(res, { error: e.message }, 500); } });
        for (const c of clients) c.write(`event: snapshot\ndata: ${JSON.stringify(spec)}\n\n`);
        return true;
      }
      if (route.startsWith('/api/snapshot/')) {
        const id = route.slice('/api/snapshot/'.length); const p = pendingShots.get(id);
        if (!p) { json(res, { error: 'unknown or expired snapshot request' }, 404); return true; }
        if (req.method === 'POST' || req.method === 'PUT') { readBytes(req, 8 * MAX_IMAGE_BODY).then(buf => { if (buf.length < 100) p.reject(new Error('The viewer sent an empty image (is a project open?).')); else p.resolve(buf); json(res, { ok: true }); }).catch(e => { p.reject(e as Error); fail(res, e); }); return true; }
        json(res, { error: 'POST the JPEG' }, 405); return true;
      }
      if (route === '/api/machines') {
        // the user's own machine profiles, next to the tool library; presets ship in core
        const file = path.join(library.userDir, 'machines.json');
        if (req.method === 'PUT') { readBody(req, 16_000_000).then(body => { try { const m = JSON.parse(body); if (!Array.isArray(m)) throw new Error('machines must be an array'); writeToolLibrary(file, m); json(res, { ok: true }); } catch (e) { json(res, { error: (e as Error).message }, 400); } }).catch(e => fail(res, e)); return true; }
        json(res, readToolLibrary(file)); return true;
      }
      if (route === '/api/tools/info') { json(res, { file: library.file, source: library.source, userDir: library.userDir, bundled: library.bundled }); return true; }
      if (route === '/api/tools/defaults') { json(res, library.bundled ? readToolLibrary(library.bundled) : []); return true; }
      if (route === '/api/tools') {
        if (req.method === 'PUT') { readBody(req, 16_000_000).then(body => { try { const t = JSON.parse(body); if (!Array.isArray(t)) throw new Error('library must be an array'); writeToolLibrary(library.file, t); json(res, { ok: true }); } catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); } }).catch(e => fail(res, e)); return true; }
        // a corrupt library file is reported (500 with the reason), never served as an empty library the viewer would then save back
        json(res, readToolLibrary(library.file)); return true;
      }
      if (route === '/api/jobs' || route === '/api/jobs/') {
        const all = fs.readdirSync(jobsDir);
        const files: JobListEntry[] = all.filter(f => f.endsWith('.json')).map(f => {
          const mtime = fs.statSync(path.join(jobsDir, f)).mtimeMs; const thumb = f.replace(/\.json$/, '.jpg');
          return { name: f, mtime, thumb: all.includes(thumb) ? thumb : null, summary: summarize(path.join(jobsDir, f), mtime) };
        }).sort((a, b) => b.mtime - a.mtime);
        json(res, files); return true;
      }
      if (route.startsWith('/api/jobs/')) {
        const base = path.basename(decodeURIComponent(route.slice('/api/jobs/'.length)));
        const file = path.join(jobsDir, base);
        if (req.method === 'DELETE') {
          if (!base.endsWith('.json') || base === 'current.json') { res.statusCode = 400; res.end('only project .json files can be deleted'); return true; }
          for (const ext of ['.json', '.jpg', '.nc']) { const f = path.join(jobsDir, base.replace(/\.json$/, ext)); if (fs.existsSync(f)) fs.unlinkSync(f); }
          json(res, { ok: true }); return true;
        }
        if (req.method === 'PUT' && base.endsWith('.jpg')) {
          // project thumbnail, raw JPEG bytes from the viewer's canvas
          readBytes(req, MAX_IMAGE_BODY).then(buf => { writeFileAtomic(file, buf); json(res, { ok: true, file: base }); }).catch(e => fail(res, e));
          return true;
        }
        if (req.method === 'PUT') {
          if (!base.endsWith('.json')) { res.statusCode = 400; res.end('job files end in .json'); return true; }
          readBody(req).then(body => {
            try {
              const job = JSON.parse(body);
              if (base !== 'current.json') {
                // Optimistic concurrency: the viewer and the MCP server both write project files. A client that names the
                // revision it edited (`_baseRev`) is refused when the file has moved on, and gets the newer job back to
                // reload or merge; a client that names none (older files, scripts) overwrites as before.
                const baseRev = job._baseRev; delete job._baseRev;
                const onDisk = revOf(file);
                if (typeof baseRev === 'string' && onDisk && onDisk !== baseRev) {
                  let current: unknown = null; try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* reported without it */ }
                  json(res, { error: 'conflict', message: `${base} was changed by another writer since it was loaded (revision ${onDisk}, edited ${baseRev})`, rev: onDisk, job: current }, 409);
                  return;
                }
                job._file = base; // the file is the project's identity, whatever the name inside says
              }
              const payload = JSON.stringify(job, null, 1);
              writeFileAtomic(file, payload);
              revCache.set(file, { mtime: fs.statSync(file).mtimeMs, rev: typeof job._rev === 'string' ? job._rev : null });
              if (base !== 'current.json') writeFileAtomic(path.join(jobsDir, 'current.json'), payload);
              json(res, { ok: true, file: base });
            } catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); }
          }).catch(e => fail(res, e));
          return true;
        }
        if (!fs.existsSync(file)) { res.statusCode = 404; res.end('not found'); return true; }
        res.setHeader('content-type', base.endsWith('.json') ? 'application/json' : base.endsWith('.jpg') ? 'image/jpeg' : 'text/plain'); res.setHeader('cache-control', 'no-cache'); res.end(fs.readFileSync(file)); return true;
      }
      res.statusCode = 404; res.end('unknown api route'); return true;
    } catch (e) { res.statusCode = 500; res.end(String((e as Error).message)); return true; }
  };

  return {
    jobsDir, library, fontDirs, handle,
    onJobsChanged: cb => { listeners.add(cb); return () => listeners.delete(cb); },
    close: () => { watcher?.close(); for (const c of clients) c.end(); clients.clear(); for (const p of pendingShots.values()) p.reject(new Error('server closed')); pendingShots.clear(); if (announced) { try { const cur = JSON.parse(fs.readFileSync(announceFile, 'utf8')); if (cur.pid === process.pid) fs.unlinkSync(announceFile); } catch { /* ignore */ } } },
    announce: (url: string) => { try { fs.mkdirSync(library.userDir, { recursive: true }); fs.writeFileSync(announceFile, JSON.stringify({ url, jobsDir, pid: process.pid, startedAt: new Date().toISOString() }, null, 1)); announced = true; } catch { /* best effort */ } },
  };
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };

export interface ServerOptions extends ApiOptions {
  /** Built viewer (vite build output) to serve at /. Without it only /api is served. */
  staticDir?: string;
  port?: number;
  host?: string;
}

/** Stand-alone HTTP server: the API plus the built viewer. Used by the packaged app and the CLI. */
export function startServer(opts: ServerOptions): Promise<{ server: http.Server; port: number; api: Api; url: string }> {
  const api = createApi(opts);
  const host = opts.host ?? '127.0.0.1';
  const server = http.createServer((req, res) => {
    if (api.handle(req, res)) return;
    if (!opts.staticDir) { res.statusCode = 404; res.end('no viewer bundled'); return; }
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (p.includes('..')) { res.statusCode = 400; res.end(); return; }
    let file = path.join(opts.staticDir, p);
    try {
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(opts.staticDir, 'index.html'); // SPA fallback
      // read synchronously so a permission problem (e.g. macOS refusing access to a folder) becomes a readable 500, not a dropped connection
      const body = fs.readFileSync(file);
      res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
      res.end(body);
    } catch (e) {
      const msg = `Cool CAM cannot read its viewer files: ${(e as Error).message}`;
      console.error(`[cool-cam] ${msg}`);
      res.statusCode = 500; res.setHeader('content-type', 'text/plain'); res.end(msg);
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port ?? 0, host, () => { const a = server.address() as { port: number }; const url = `http://${host}:${a.port}/`; api.announce(url); resolve({ server, port: a.port, api, url }); });
  });
}
