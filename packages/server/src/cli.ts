#!/usr/bin/env node
/**
 * `cool-cam [--port N] [--jobs DIR] [--no-open]`: serve the built viewer and the API on localhost and open the browser.
 * The no-Electron way to run Cool CAM (Linux boxes, headless machines, or just a browser tab).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer, defaultJobsDir } from './index.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const port = Number(flag('--port') ?? process.env.PORT ?? 5174);
const jobsDir = flag('--jobs') ?? (fs.existsSync(path.join(root, 'jobs')) ? path.join(root, 'jobs') : defaultJobsDir());
const staticDir = [path.join(root, 'packages/viewer/dist'), path.join(here, '../viewer')].find(d => fs.existsSync(path.join(d, 'index.html')));
if (!staticDir) { console.error('No built viewer found. Run `npm run build:viewer` first.'); process.exit(1); }

startServer({ jobsDir, bundledLibrary: path.join(root, 'library', 'tools.json'), staticDir, port }).then(({ url, api }) => {
  console.log(`Cool CAM at ${url}\n  jobs:    ${api.jobsDir}\n  library: ${api.library.file}`);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try { spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref(); } catch { /* user opens it by hand */ }
  }
}).catch(e => { console.error(e.message); process.exit(1); });
