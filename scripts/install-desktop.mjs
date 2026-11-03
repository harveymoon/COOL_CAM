#!/usr/bin/env node
// `npm run install:desktop`: install the app built by `npm run build:desktop`, per platform.
// - macOS: copy the bundle to ~/Applications/Cool CAM.app (refused while that copy is running: replacing a running app
//   crashes it). Never run the copy in packages/desktop/dist: rebuilding under a running app crashes it too.
// - Windows: run the NSIS installer electron-builder produced (it handles a running instance itself).
// - Linux: print where the AppImage / .deb are; installing them is the user's call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'packages', 'desktop', 'dist');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const fail = (msg) => { console.error(msg); process.exit(1); };
if (!fs.existsSync(dist)) fail(`No build in ${dist}. Run \`npm run build:desktop\` first.`);

if (process.platform === 'darwin') {
  const src = path.join(dist, 'mac-universal', 'Cool CAM.app');
  const dst = path.join(os.homedir(), 'Applications', 'Cool CAM.app');
  if (!fs.existsSync(src)) fail(`No app bundle at ${src}. Run \`npm run build:desktop\` first.`);
  let running = false;
  try { execFileSync('pgrep', ['-f', 'Applications/Cool CAM.app/Contents/MacOS/Cool CAM$'], { stdio: 'ignore' }); running = true; } catch { /* exit 1: not running */ }
  if (running) fail('Cool CAM is running from ~/Applications: quit it first (replacing a running app crashes it).');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  execFileSync('rsync', ['-a', '--delete', `${src}/`, `${dst}/`], { stdio: 'inherit' });
  console.log(`installed to ${dst}`);
} else if (process.platform === 'win32') {
  const exe = path.join(dist, `Cool CAM-${version}-win.exe`);
  const found = fs.existsSync(exe) ? exe : fs.readdirSync(dist).filter(f => /-win\.exe$/i.test(f)).map(f => path.join(dist, f)).sort().pop();
  if (!found) fail(`No Windows installer (*-win.exe) in ${dist}. Run \`npm run build:desktop\` first.`);
  console.log(`starting the installer ${found}`);
  spawn(found, [], { detached: true, stdio: 'ignore' }).unref();
} else {
  const files = fs.readdirSync(dist).filter(f => /\.(AppImage|deb)$/.test(f));
  if (!files.length) fail(`No AppImage or .deb in ${dist}. Run \`npm run build:desktop\` first.`);
  console.log(`Built packages (install the one you want):\n${files.map(f => '  ' + path.join(dist, f)).join('\n')}`);
}
