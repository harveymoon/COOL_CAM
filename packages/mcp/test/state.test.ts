import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newJob } from '@cool-cam/core';
import { JobState, projectFileName } from '../src/state.js';

describe('JobState', () => {
  it('a freshly set job survives save() even when current.json is newer than the server has seen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-'));
    // the viewer (or a previous server) left a job behind
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ ...newJob('old job'), _rev: 'abc' }));
    const state = new JobState(dir);
    state.set(newJob('new job', { width: 10, length: 10, thickness: 3 }));
    state.save();
    expect(state.require().name).toBe('new job');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8')).name).toBe('new job');
    expect(fs.existsSync(path.join(dir, 'new-job.json'))).toBe(true);
    // load() then save() likewise keeps the loaded job
    fs.writeFileSync(path.join(dir, 'other.json'), JSON.stringify(newJob('other')));
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(newJob('viewer edit')));
    state.load('other'); state.save();
    expect(state.require().name).toBe('other');
  });
  it('follows the file a job lives in rather than re-slugging its name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-'));
    const state = new JobState(dir);
    fs.writeFileSync(path.join(dir, 'coaster.json'), JSON.stringify({ ...newJob('Coaster'), _rev: 'v1', _file: 'coaster.json' }));
    const j = state.load('coaster'); j.name = 'Coaster v2 (renamed)'; state.save();
    expect(fs.existsSync(path.join(dir, 'coaster-v2-renamed.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'coaster.json'), 'utf8')).name).toBe('Coaster v2 (renamed)');
    // the viewer's save (the server writes the project file and mirrors it to current.json) names the file too
    const viewerSave = JSON.stringify({ ...newJob('Other name'), _rev: 'v9', _file: 'coaster.json' });
    fs.writeFileSync(path.join(dir, 'coaster.json'), viewerSave); fs.writeFileSync(path.join(dir, 'current.json'), viewerSave);
    const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'current.json'), later, later);
    expect(state.require().name).toBe('Other name'); state.save();
    expect(state.file).toBe('coaster.json'); expect(fs.existsSync(path.join(dir, 'other-name.json'))).toBe(false);
    expect(projectFileName('日本語')).toMatch(/^job-[0-9a-z]+\.json$/); expect(projectFileName('My Job!')).toBe('my-job.json');
  });
  it('refuses to save over a file the viewer changed since the job was read, then re-reads it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-'));
    const state = new JobState(dir);
    state.set(newJob('mine')); state.save();
    const j = state.require(); j.name = 'mine, edited by MCP';
    // the viewer saves in between (the server mirrors the same payload to current.json)
    const theirs = JSON.stringify({ ...newJob('edited by viewer'), _rev: 'viewer-1', _file: 'mine.json' });
    fs.writeFileSync(path.join(dir, 'mine.json'), theirs);
    fs.writeFileSync(path.join(dir, 'current.json'), theirs);
    const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'current.json'), later, later);
    expect(() => state.save()).toThrow(/saved by the viewer/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'mine.json'), 'utf8')).name).toBe('edited by viewer');
    expect(state.require().name).toBe('edited by viewer');
    state.require().name = 'second try'; state.save(); // now based on the viewer's revision: accepted
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'mine.json'), 'utf8')).name).toBe('second try');
  });
  it('require() picks up a newer current.json written by someone else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolcam-'));
    const state = new JobState(dir);
    state.set(newJob('mine')); state.save();
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(newJob('viewer')));
    fs.utimesSync(path.join(dir, 'current.json'), later, later);
    expect(state.require().name).toBe('viewer');
  });
});
