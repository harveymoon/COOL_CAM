import fs from 'node:fs';
import path from 'node:path';
import type { Job, Toolpath } from '@cool-cam/core';

export class JobState {
  job: Job | null = null;
  toolpaths: Toolpath[] | null = null;
  readonly jobsDir: string;
  constructor(jobsDir: string) {
    this.jobsDir = jobsDir;
    fs.mkdirSync(jobsDir, { recursive: true });
  }
  private lastWrite = 0;
  /** Current job, re-read from current.json if the viewer (or anyone) saved a newer version. */
  require(): Job {
    const cur = path.join(this.jobsDir, 'current.json');
    try {
      const m = fs.statSync(cur).mtimeMs;
      if (m > this.lastWrite + 1) {
        const raw = JSON.parse(fs.readFileSync(cur, 'utf8'));
        delete raw._savedAt; delete raw._rev;
        this.job = raw as Job; this.invalidate(); this.lastWrite = m;
      }
    } catch { /* no current.json yet */ }
    if (!this.job) throw new Error('No job loaded. Call new_job or load_job first.');
    return this.job;
  }
  invalidate() { this.toolpaths = null; }
  /** Replace the in-memory job (new_job / load_job). Unlike require(), never re-reads current.json. */
  set(job: Job): Job { this.job = job; this.invalidate(); return job; }
  slug(name = this.current().name): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'job'; }
  private current(): Job { if (!this.job) throw new Error('No job loaded. Call new_job or load_job first.'); return this.job; }
  /** Persist the in-memory job. Deliberately does not go through require(): a newer current.json (e.g. saved by the viewer) must not replace a job that was just created or loaded. */
  save(): string {
    const job = this.current();
    const file = path.join(this.jobsDir, `${this.slug()}.json`);
    const payload = JSON.stringify({ ...job, _savedAt: new Date().toISOString() }, null, 1);
    fs.writeFileSync(file, payload);
    const cur = path.join(this.jobsDir, 'current.json');
    fs.writeFileSync(cur, payload);
    this.lastWrite = fs.statSync(cur).mtimeMs;
    return file;
  }
  load(nameOrPath: string): Job {
    let file = nameOrPath;
    if (!fs.existsSync(file)) file = path.join(this.jobsDir, nameOrPath.endsWith('.json') ? nameOrPath : `${nameOrPath}.json`);
    if (!fs.existsSync(file)) throw new Error(`Job file not found: ${nameOrPath}`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw._savedAt; delete raw._rev;
    return this.set(raw as Job);
  }
  list(): string[] {
    return fs.readdirSync(this.jobsDir).filter(f => f.endsWith('.json') && f !== 'current.json').map(f => f.replace(/\.json$/, ''));
  }
}
