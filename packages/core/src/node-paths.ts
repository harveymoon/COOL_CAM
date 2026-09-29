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

/** Read a tool library file; a missing or broken file is an empty library. */
export function readToolLibrary<T = unknown>(file: string): T[] {
  try { const t = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(t) ? (t as T[]) : []; } catch { return []; }
}

/** Path of another per-user JSON file in the same folder as the tool library (e.g. `machines.json`). */
export function userFile(name: string, opts: { appName?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return path.join(userDataDir(opts.appName, opts.env ?? process.env), name);
}

export function writeToolLibrary(file: string, tools: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tools, null, 1));
}
