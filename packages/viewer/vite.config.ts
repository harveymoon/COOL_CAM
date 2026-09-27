import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const jobsDir = process.env.COOL_CAM_JOBS_DIR ?? path.join(root, 'jobs');
const libraryFile = process.env.COOL_CAM_LIBRARY ?? path.join(root, 'library', 'tools.json');

/** Serves ./jobs over /api/jobs and pushes a websocket event whenever a job file changes (MCP writes → viewer reloads). */
function jobsApi(): Plugin {
  return {
    name: 'cool-cam-jobs',
    configureServer(server) {
      fs.mkdirSync(jobsDir, { recursive: true });
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/api/tools') {
          if (req.method === 'PUT') {
            let body = ''; req.on('data', (c: Buffer) => { body += c; });
            req.on('end', () => { try { const t = JSON.parse(body); fs.mkdirSync(path.dirname(libraryFile), { recursive: true }); fs.writeFileSync(libraryFile, JSON.stringify(t, null, 1)); res.end('{"ok":true}'); } catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); } });
            return;
          }
          res.setHeader('content-type', 'application/json');
          res.end(fs.existsSync(libraryFile) ? fs.readFileSync(libraryFile) : '[]'); return;
        }
        if (url === '/api/jobs' || url === '/api/jobs/') {
          const files = fs.readdirSync(jobsDir).filter(f => f.endsWith('.json')).map(f => ({ name: f, mtime: fs.statSync(path.join(jobsDir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
          res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(files)); return;
        }
        if (url.startsWith('/api/jobs/')) {
          const file = path.join(jobsDir, path.basename(decodeURIComponent(url.slice('/api/jobs/'.length).split('?')[0])));
          if (req.method === 'PUT') {
            let body = '';
            req.on('data', (c: Buffer) => { body += c; });
            req.on('end', () => {
              try {
                const job = JSON.parse(body);
                const payload = JSON.stringify(job, null, 1);
                fs.writeFileSync(file, payload);
                if (path.basename(file) !== 'current.json') fs.writeFileSync(path.join(jobsDir, 'current.json'), payload);
                res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, file: path.basename(file) }));
              } catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); }
            });
            return;
          }
          if (!fs.existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
          res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'text/plain'); res.end(fs.readFileSync(file)); return;
        }
        next();
      });
      let timer: NodeJS.Timeout | null = null;
      fs.watch(jobsDir, { persistent: false }, (_ev, file) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => server.ws.send({ type: 'custom', event: 'cool-cam:jobs-changed', data: { file } }), 150);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), jobsApi()],
  resolve: {
    alias: {
      '@cool-cam/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@cool-cam/post': path.resolve(__dirname, '../post/src/index.ts'),
      '@cool-cam/sim': path.resolve(__dirname, '../sim/src/index.ts'),
    },
  },
  optimizeDeps: { include: ['clipper-lib'] },
  worker: { format: 'es' },
  server: { port: 5173, fs: { allow: [root] } },
});
