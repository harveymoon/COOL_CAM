import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newJob } from '@cool-cam/core';
import { JobState } from '../src/state.js';

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
