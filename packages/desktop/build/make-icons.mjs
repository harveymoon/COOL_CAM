// Renders the viewer's icon.svg to build/icon.png (1024²) with Electron itself, then (macOS) build/icon.icns via iconutil.
//   npx electron packages/desktop/build/make-icons.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const here = path.dirname(new URL(import.meta.url).pathname);
const svg = fs.readFileSync(path.resolve(here, '../../viewer/public/icon.svg'), 'utf8');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:#0d0f13">${svg.replace('width="64" height="64"', 'width="1024" height="1024"')}</body></html>`));
  await new Promise(r => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(here, 'icon.png'), img.toPNG());
  if (process.platform === 'darwin') {
    const set = path.join(here, 'icon.iconset'); fs.rmSync(set, { recursive: true, force: true }); fs.mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) { execSync(`sips -z ${s} ${s} "${path.join(here, 'icon.png')}" --out "${set}/icon_${s}x${s}.png"`, { stdio: 'ignore' }); execSync(`sips -z ${s * 2} ${s * 2} "${path.join(here, 'icon.png')}" --out "${set}/icon_${s}x${s}@2x.png"`, { stdio: 'ignore' }); }
    execSync(`iconutil -c icns "${set}" -o "${path.join(here, 'icon.icns')}"`); fs.rmSync(set, { recursive: true, force: true });
  }
  console.log('icons written to', here); app.quit();
}).catch(e => { console.error(e); app.exit(1); });
