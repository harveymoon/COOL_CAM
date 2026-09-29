/**
 * Electron main: start the local API (and, when packaged, the built viewer) on a localhost port, open a window on it.
 * Everything the app knows how to do lives in packages/server and the viewer; this file is the shell.
 */
import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, defaultJobsDir } from '@cool-cam/server';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../../..');

/** Paths the packaged app ships alongside the code (see electron-builder.yml extraResources). */
const bundledLibrary = app.isPackaged ? path.join(resources, 'library', 'tools.json') : path.join(resources, 'library', 'tools.json');
const mcpEntry = app.isPackaged ? path.join(resources, 'mcp', 'index.mjs') : path.join(resources, 'packages', 'mcp', 'dist', 'index.js');

let win: BrowserWindow | null = null;
let baseUrl = '';
let jobsDir = '';

/** Packaged app: mirror the main process console into ~/Library/Logs/Cool CAM/main.log (stdout goes nowhere under Finder). */
let logFile = '';
function setupLogging() {
  if (!app.isPackaged) return;
  try {
    // the package is named @cool-cam/desktop; log under the product name instead (~/Library/Logs/Cool CAM on macOS)
    if (process.platform === 'darwin') app.setAppLogsPath(path.join(app.getPath('home'), 'Library', 'Logs', 'Cool CAM'));
    const dir = app.getPath('logs'); fs.mkdirSync(dir, { recursive: true }); logFile = path.join(dir, 'main.log');
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    const wrap = (orig: (...a: unknown[]) => void, level: string) => (...a: unknown[]) => { orig(...a); try { out.write(`${new Date().toISOString()} ${level} ${a.map(x => x instanceof Error ? x.stack ?? x.message : typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}\n`); } catch { /* ignore */ } };
    console.log = wrap(console.log, 'info'); console.error = wrap(console.error, 'error'); console.warn = wrap(console.warn, 'warn');
    console.log(`[cool-cam] ${app.getName()} ${app.getVersion()} · electron ${process.versions.electron} · ${process.platform} ${process.arch} · exe ${process.execPath}`);
  } catch { /* logging is best-effort */ }
}

async function boot() {
  jobsDir = process.env.COOL_CAM_JOBS_DIR ?? (app.isPackaged ? defaultJobsDir(app.getPath('documents')) : path.join(resources, 'jobs'));
  // first launch of a packaged app: an empty jobs folder gets the bundled example jobs so there is something to look at
  if (app.isPackaged) {
    try {
      fs.mkdirSync(jobsDir, { recursive: true });
      if (!fs.readdirSync(jobsDir).some(f => f.endsWith('.json'))) {
        const ex = path.join(resources, 'examples');
        const names = (fs.existsSync(ex) ? fs.readdirSync(ex) : []).filter(f => /^example-.*\.json$/.test(f));
        for (const f of names) fs.copyFileSync(path.join(ex, f), path.join(jobsDir, f));
        // and open one of them, so the first window is not empty
        const first = names.find(f => /star-coaster/.test(f)) ?? names[0];
        if (first) fs.copyFileSync(path.join(ex, first), path.join(jobsDir, 'current.json'));
      }
    } catch (e) { console.error('[cool-cam] could not seed example jobs', e); }
  }
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
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => { if (isMainFrame) console.error(`[cool-cam] window failed to load ${url}: ${desc} (${code})`); });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error(`[cool-cam] renderer: ${message}`); });
  try { await win.loadURL(baseUrl); }
  catch (e) { throw new Error(`The window could not load the local viewer at ${baseUrl}: ${(e as Error).message}\n\nThe local server itself was running. Log: ${logFile || '(console)'}`); }
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

/** Menu definitions mirrored from the renderer (see viewer/src/nativeMenu.ts). */
interface MenuItemSpec { id?: string; label?: string; sep?: boolean; disabled?: boolean; checked?: boolean; shortcut?: string; submenu?: MenuItemSpec[] }
interface MenuSpec { label: string; items: MenuItemSpec[] }

const shellItems = (isMac: boolean): Electron.MenuItemConstructorOptions[] => [
  { label: 'Open jobs folder', click: () => shell.openPath(jobsDir) },
  { label: 'Copy MCP config for Claude Code', click: () => { clipboard.writeText(JSON.stringify(mcpConfig(), null, 2)); dialog.showMessageBox({ message: 'MCP config copied', detail: `Paste it into a .mcp.json (or Claude Code's MCP settings). It points Claude at this app's MCP server and jobs folder:\n${jobsDir}` }); } },
  { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' },
];

/**
 * Build the OS menu: the renderer's menus (File, Edit, Paths, View, Window) with the app's own items merged in: the shell
 * entries under File, the text-editing roles under Edit (copy/paste in inputs need them), reload/devtools/zoom under
 * View, and the standard window roles under Window. Item clicks are sent back to the renderer by id.
 */
function buildMenu(spec: MenuSpec[] = [], sender?: Electron.WebContents) {
  const isMac = process.platform === 'darwin';
  const convert = (items: MenuItemSpec[]): Electron.MenuItemConstructorOptions[] => items.map(it => it.sep ? { type: 'separator' as const } : {
    label: it.label ?? '', enabled: !it.disabled, type: it.checked !== undefined ? 'checkbox' as const : 'normal' as const, checked: !!it.checked,
    submenu: it.submenu ? convert(it.submenu) : undefined,
    click: it.submenu ? undefined : () => { if (it.id) sender?.send('menu:click', it.id); },
  });
  const byLabel = (label: string) => spec.find(m => m.label === label);
  const own = (label: string): Electron.MenuItemConstructorOptions[] => convert(byLabel(label)?.items ?? []);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [...own('File'), ...(own('File').length ? [{ type: 'separator' as const }] : []), ...shellItems(isMac)] },
    { label: 'Edit', submenu: [...own('Edit'), { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    ...spec.filter(m => !['File', 'Edit', 'View', 'Window'].includes(m.label)).map(m => ({ label: m.label, submenu: convert(m.items) })),
    { label: 'View', submenu: [...own('View'), { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', role: 'window', submenu: [...own('Window'), { type: 'separator' }, { role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])] },
    { role: 'help', submenu: [{ label: 'Cool CAM on GitHub', click: () => shell.openExternal('https://github.com/harveymoon/COOL_CAM') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
ipcMain.on('menu:set', (e, spec: MenuSpec[]) => { buildMenu(spec, e.sender); console.log(`[cool-cam] native menu: ${spec.map(m => `${m.label}(${m.items.length})`).join(' ')}`); });

app.whenReady().then(async () => {
  setupLogging();
  buildMenu();
  await boot();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
}).catch(e => { console.error('[cool-cam] failed to start', e); dialog.showErrorBox('Cool CAM failed to start', String(e?.stack ?? e)); app.quit(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// keep the jobs folder discoverable for support
app.on('before-quit', () => { try { fs.mkdirSync(jobsDir, { recursive: true }); } catch { /* ignore */ } });
