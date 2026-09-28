import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveToolLibrary, userDataDir, readToolLibrary, writeToolLibrary } from '../src/node-paths.js';

describe('tool library location', () => {
  it('seeds the user library from the bundled defaults once, then leaves the bundled file alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-lib-'));
    const bundled = path.join(dir, 'bundled.json'); fs.writeFileSync(bundled, JSON.stringify([{ id: 'a' }]));
    const env = { COOL_CAM_DATA_DIR: path.join(dir, 'user') } as NodeJS.ProcessEnv;
    const first = resolveToolLibrary({ bundled, env });
    expect(first.source).toBe('user'); expect(first.seeded).toBe(true);
    expect(first.file).toBe(path.join(dir, 'user', 'tools.json'));
    expect(readToolLibrary(first.file)).toEqual([{ id: 'a' }]);
    writeToolLibrary(first.file, [{ id: 'mine' }]);
    const second = resolveToolLibrary({ bundled, env });
    expect(second.seeded).toBe(false);
    expect(readToolLibrary(second.file)).toEqual([{ id: 'mine' }]);
    expect(readToolLibrary(bundled)).toEqual([{ id: 'a' }]);
  });
  it('honours COOL_CAM_LIBRARY and falls back to platform folders', () => {
    const env = { COOL_CAM_LIBRARY: '/tmp/x/tools.json' } as NodeJS.ProcessEnv;
    expect(resolveToolLibrary({ env }).file).toBe('/tmp/x/tools.json');
    expect(resolveToolLibrary({ env }).source).toBe('env');
    expect(userDataDir('Cool CAM', {} as NodeJS.ProcessEnv)).toMatch(/Cool CAM|cool-cam/);
    expect(readToolLibrary('/definitely/missing/tools.json')).toEqual([]);
  });
});
