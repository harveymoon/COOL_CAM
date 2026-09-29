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
import { resolveToolLibrary, readToolLibrary, writeToolLibrary, type LibraryLocation } from '@cool-cam/core/node';

export interface ApiOptions {
  /** Folder holding <slug>.json jobs and current.json. Created if missing. */
  jobsDir: string;
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
}

/** Platform font folders the text tool can read TTF/OTF files from. */
export function defaultFontDirs(extra: string[] = []): string[] {
  const home = os.homedir();
  const dirs = process.platform === 'darwin'
    ? ['/System/Library/Fonts/Supplemental', '/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')]
    : process.platform === 'win32'
      ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Microsoft', 'Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local/share/fonts')];
  return [...dirs, ...extra];
}

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
const readBody = (req: http.IncomingMessage) => new Promise<string>((resolve, reject) => { let b = ''; req.on('data', (c: Buffer) => { b += c; }); req.on('end', () => resolve(b)); req.on('error', reject); });
const readBytes = (req: http.IncomingMessage) => new Promise<Buffer>((resolve, reject) => { const parts: Buffer[] = []; req.on('data', (c: Buffer) => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts))); req.on('error', reject); });

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

export function createApi(opts: ApiOptions): Api {
  const jobsDir = opts.jobsDir;
  fs.mkdirSync(jobsDir, { recursive: true });
  const library = resolveToolLibrary({ bundled: opts.bundledLibrary });
  const fontDirs = defaultFontDirs(opts.fontDirs);
  const listeners = new Set<(file: string | null) => void>();
  const clients = new Set<http.ServerResponse>();
  let timer: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(jobsDir, { persistent: false }, (_ev, file) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { const f = file ? String(file) : null; for (const cb of listeners) cb(f); for (const c of clients) c.write(`event: jobs-changed\ndata: ${JSON.stringify({ file: f })}\n\n`); }, 150);
    });
  } catch { /* watching unsupported: the viewer still works, it just does not auto-reload */ }

  const handle = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/')) return false;
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
      if (route === '/api/tools/info') { json(res, { file: library.file, source: library.source, userDir: library.userDir, bundled: library.bundled }); return true; }
      if (route === '/api/tools/defaults') { json(res, library.bundled ? readToolLibrary(library.bundled) : []); return true; }
      if (route === '/api/tools') {
        if (req.method === 'PUT') { readBody(req).then(body => { try { const t = JSON.parse(body); if (!Array.isArray(t)) throw new Error('library must be an array'); writeToolLibrary(library.file, t); json(res, { ok: true }); } catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); } }); return true; }
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
          readBytes(req).then(buf => { if (buf.length > 2_000_000) { res.statusCode = 413; res.end('thumbnail too large'); return; } fs.writeFileSync(file, buf); json(res, { ok: true, file: base }); }).catch(e => { res.statusCode = 500; res.end(String(e)); });
          return true;
        }
        if (req.method === 'PUT') {
          if (!base.endsWith('.json')) { res.statusCode = 400; res.end('job files end in .json'); return true; }
          readBody(req).then(body => {
            try {
              const job = JSON.parse(body); const payload = JSON.stringify(job, null, 1);
              fs.writeFileSync(file, payload);
              if (base !== 'current.json') fs.writeFileSync(path.join(jobsDir, 'current.json'), payload);
              json(res, { ok: true, file: base });
            } catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); }
          });
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
    close: () => { watcher?.close(); for (const c of clients) c.end(); clients.clear(); },
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
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(opts.staticDir, 'index.html'); // SPA fallback
    res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port ?? 0, host, () => { const a = server.address() as { port: number }; resolve({ server, port: a.port, api, url: `http://${host}:${a.port}/` }); });
  });
}
