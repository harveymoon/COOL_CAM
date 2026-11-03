/**
 * Node-only helpers for per-user data locations (the viewer never imports this file; it is published as `@cool-cam/core/node`).
 *
 * The tool library lives in the user's application-data folder so it survives reinstalls and is shared by the viewer, the MCP
 * server and a future packaged app:
 *   macOS   ~/Library/Application Support/Cool CAM/tools.json
 *   Windows %APPDATA%\Cool CAM\tools.json
 *   Linux   $XDG_CONFIG_HOME/cool-cam/tools.json  (default ~/.config/cool-cam)
 * `COOL_CAM_DATA_DIR` overrides the folder, `COOL_CAM_LIBRARY` overrides the library file itself. The repository's
 * `library/tools.json` is the *bundled default*: it seeds the user library the first time and is never written to.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'Cool CAM';

export function userDataDir(appName = APP_NAME, env: NodeJS.ProcessEnv = process.env): string {
  if (env.COOL_CAM_DATA_DIR) return env.COOL_CAM_DATA_DIR;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', appName);
  if (process.platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), appName);
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), appName.toLowerCase().replace(/\s+/g, '-'));
}

export interface LibraryLocation {
  /** The file reads and writes go to. */
  file: string;
  /** How it was chosen. */
  source: 'env' | 'user';
  userDir: string;
  /** The bundled defaults (read-only), when known. */
  bundled?: string;
  /** True when this call created the user library from the bundled defaults. */
  seeded: boolean;
}

/** Resolve the tool library file, creating the user copy from the bundled defaults on first use. */
export function resolveToolLibrary(opts: { bundled?: string; appName?: string; env?: NodeJS.ProcessEnv } = {}): LibraryLocation {
  const env = opts.env ?? process.env;
  const userDir = userDataDir(opts.appName, env);
  if (env.COOL_CAM_LIBRARY) return { file: env.COOL_CAM_LIBRARY, source: 'env', userDir, bundled: opts.bundled, seeded: false };
  const file = path.join(userDir, 'tools.json');
  let seeded = false;
  if (!fs.existsSync(file)) {
    fs.mkdirSync(userDir, { recursive: true });
    if (opts.bundled && fs.existsSync(opts.bundled)) { fs.copyFileSync(opts.bundled, file); seeded = true; }
  }
  return { file, source: 'user', userDir, bundled: opts.bundled, seeded };
}

/**
 * Read a tool library (or machines) file. A missing file is an empty library. A file that exists but cannot be parsed
 * throws: it used to read as empty, and the next read-modify-write (add a tool) then saved a one-tool library over the
 * user's whole collection.
 */
export function readToolLibrary<T = unknown>(file: string): T[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  let t: unknown;
  try { t = JSON.parse(text); } catch (e) { throw new Error(`${file} is not valid JSON (${(e as Error).message}). Fix or move the file; it has not been overwritten.`); }
  if (!Array.isArray(t)) throw new Error(`${file} should contain a JSON array.`);
  return t as T[];
}

/** Platform font folders the text tool can read TTF/OTF files from (shared by the local API and the MCP server). */
export function defaultFontDirs(extra: string[] = [], env: NodeJS.ProcessEnv = process.env): string[] {
  const home = os.homedir();
  const dirs = process.platform === 'darwin'
    ? ['/System/Library/Fonts/Supplemental', '/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')]
    : process.platform === 'win32'
      ? [path.join(env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Microsoft', 'Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local/share/fonts')];
  return [...dirs, ...extra];
}

/**
 * The bundled `library/` folder (default tools.json, extra fonts) for a program at `moduleDir`: `COOL_CAM_BUNDLED_DIR`
 * if set, else the first candidate that exists. Callers pass candidates for their layouts (repo: packages/x/dist → repo
 * root; packaged app: resources/mcp → resources). Returns the first candidate when none exists, so paths stay printable.
 */
export function findBundledDir(candidates: string[], env: NodeJS.ProcessEnv = process.env): string {
  if (env.COOL_CAM_BUNDLED_DIR) return env.COOL_CAM_BUNDLED_DIR;
  return candidates.find(d => fs.existsSync(path.join(d, 'tools.json'))) ?? candidates[0];
}

/** Path of another per-user JSON file in the same folder as the tool library (e.g. `machines.json`). */
export function userFile(name: string, opts: { appName?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return path.join(userDataDir(opts.appName, opts.env ?? process.env), name);
}

/**
 * Write a file atomically: the data goes to a temp file in the same folder, which is then renamed over the target, so a
 * crash mid-write or a reader racing the writer never sees a truncated file. Readers (the viewer's watcher, the MCP
 * server) should ignore `*.tmp` names.
 */
export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* never written */ } throw e; }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, JSON.stringify(value, null, 1));
}

export function writeToolLibrary(file: string, tools: unknown[]): void {
  writeJsonAtomic(file, tools);
}
