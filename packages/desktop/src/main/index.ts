/**
 * Electron main: start the local API (and, when packaged, the built viewer) on a localhost port, open a window on it.
 * Everything the app knows how to do lives in packages/server and the viewer; this file is the shell.
 */
import { app, BrowserWindow, Menu, clipboard, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, defaultJobsDir } from '@cool-cam/server';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../../..');

/** Paths the packaged app ships alongside the code (see electron-builder.yml extraResources). */
const bundledLibrary = app.isPackaged ? path.join(resources, 'library', 'tools.json') : path.join(resources, 'library', 'tools.json');
const mcpEntry = app.isPackaged ? path.join(resources, 'mcp', 'index.js') : path.join(resources, 'packages', 'mcp', 'dist', 'index.js');

let win: BrowserWindow | null = null;
let baseUrl = '';
let jobsDir = '';

async function boot() {
  jobsDir = process.env.COOL_CAM_JOBS_DIR ?? (app.isPackaged ? defaultJobsDir(app.getPath('documents')) : path.join(resources, 'jobs'));
  if (isDev) {
    // the Vite dev server (electron-vite) already mounts the API middleware: same loop as the browser
    baseUrl = process.env.ELECTRON_RENDERER_URL!;
  } else {
    const staticDir = path.join(__dirname, '../renderer');
    const { url, api } = await startServer({ jobsDir, bundledLibrary, staticDir, fontDirs: [path.join(resources, 'library', 'fonts')] });
    baseUrl = url;
    console.log(`[cool-cam] serving ${url} · jobs ${api.jobsDir} · library ${api.library.file}`);
  }
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600, title: 'Cool CAM', backgroundColor: '#0d0f13',
    webPreferences: { preload: path.join(__dirname, '../preload/index.mjs'), contextIsolation: true, sandbox: false },
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  await win.loadURL(baseUrl);
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  // `--screenshot out.png`: capture the rendered window after the job has loaded and quit (smoke tests, headless checks)
  const shotIdx = process.argv.indexOf('--screenshot');
  if (shotIdx >= 0 && process.argv[shotIdx + 1]) {
    const out = process.argv[shotIdx + 1];
    setTimeout(async () => { try { const img = await win!.webContents.capturePage(); fs.writeFileSync(out, img.toPNG()); console.log(`[cool-cam] screenshot ${out}`); } catch (e) { console.error('[cool-cam] screenshot failed', e); } app.quit(); }, Number(process.env.COOL_CAM_SHOT_DELAY ?? 6000));
  }
}

/** The .mcp.json entry that lets Claude Code drive this install: the Electron binary runs the bundled MCP server as Node. */
function mcpConfig() {
  return { mcpServers: { 'cool-cam': { command: process.execPath, args: [mcpEntry], env: { ELECTRON_RUN_AS_NODE: '1', COOL_CAM_JOBS_DIR: jobsDir } } } };
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'Open jobs folder', click: () => shell.openPath(jobsDir) },
      { label: 'Copy MCP config for Claude Code', click: () => { clipboard.writeText(JSON.stringify(mcpConfig(), null, 2)); dialog.showMessageBox({ message: 'MCP config copied', detail: `Paste it into a .mcp.json (or Claude Code's MCP settings). It points Claude at this app's MCP server and jobs folder:\n${jobsDir}` }); } },
      { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Cool CAM on GitHub', click: () => shell.openExternal('https://github.com/harveymoon/COOL_CAM') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  buildMenu();
  await boot();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
}).catch(e => { dialog.showErrorBox('Cool CAM failed to start', String(e?.stack ?? e)); app.quit(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// keep the jobs folder discoverable for support
app.on('before-quit', () => { try { fs.mkdirSync(jobsDir, { recursive: true }); } catch { /* ignore */ } });
