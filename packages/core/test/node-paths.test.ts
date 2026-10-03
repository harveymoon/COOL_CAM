import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveToolLibrary, userDataDir, readToolLibrary, writeToolLibrary, writeFileAtomic } from '../src/node-paths.js';

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
  it('reports a corrupt library instead of reading it as empty, so a read-modify-write cannot wipe it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-corrupt-'));
    const file = path.join(dir, 'tools.json');
    fs.writeFileSync(file, '[{"id": "mine", "diam'); // torn write
    expect(() => readToolLibrary(file)).toThrow(/not valid JSON/);
    fs.writeFileSync(file, '{"id": "not-an-array"}');
    expect(() => readToolLibrary(file)).toThrow(/array/);
    expect(readToolLibrary(path.join(dir, 'missing.json'))).toEqual([]);
    // the add-a-tool pattern: read, push, write. The read throws, so the write never happens.
    expect(() => { const lib = readToolLibrary<{ id: string }>(file); lib.push({ id: 'new' }); writeToolLibrary(file, lib); }).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{"id": "not-an-array"}');
  });
  it('writes files atomically: the target is replaced in one rename and no temp file is left behind', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-atomic-'));
    const file = path.join(dir, 'nested', 'tools.json');
    writeToolLibrary(file, [{ id: 'a' }]);
    writeToolLibrary(file, [{ id: 'b' }]);
    expect(readToolLibrary(file)).toEqual([{ id: 'b' }]);
    writeFileAtomic(path.join(dir, 'nested', 'thumb.jpg'), Uint8Array.from([1, 2, 3]));
    expect(fs.readdirSync(path.join(dir, 'nested')).sort()).toEqual(['thumb.jpg', 'tools.json']);
  });
  it('honours COOL_CAM_LIBRARY and falls back to platform folders', () => {
    const env = { COOL_CAM_LIBRARY: '/tmp/x/tools.json' } as NodeJS.ProcessEnv;
    expect(resolveToolLibrary({ env }).file).toBe('/tmp/x/tools.json');
    expect(resolveToolLibrary({ env }).source).toBe('env');
    expect(userDataDir('Cool CAM', {} as NodeJS.ProcessEnv)).toMatch(/Cool CAM|cool-cam/);
    expect(readToolLibrary('/definitely/missing/tools.json')).toEqual([]);
  });
});
