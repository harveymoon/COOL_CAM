import fs from 'node:fs';
import path from 'node:path';
import type { Job, Toolpath } from '@cool-cam/core';
import { writeFileAtomic } from '@cool-cam/core/node';

/**
 * File name for a new project: the name slugged, or a short hash of it when nothing slug-able is left (a name in another
 * script). Mirrored by `slugOf` in the viewer's store; both sides must agree so a project created on either has one file.
 */
export function projectFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (slug) return `${slug}.json`;
  let h = 5381; for (const c of name) h = (Math.imul(h, 33) ^ (c.codePointAt(0) ?? 0)) >>> 0;
  return `job-${h.toString(36)}.json`;
}
const newRev = () => Math.random().toString(36).slice(2);

/** `_rev` of a job file on disk, or null when there is none to compare against. */
function revOf(file: string): string | null {
  try { const r = JSON.parse(fs.readFileSync(file, 'utf8'))._rev; return typeof r === 'string' ? r : null; } catch { return null; }
}

export class JobState {
  job: Job | null = null;
  toolpaths: Toolpath[] | null = null;
  /** The project file (basename) the job lives in. It is the project's identity: renaming the job does not move it. */
  file: string | null = null;
  /** Revision of the file version the job was read from; null when the job was just created and is meant to replace the file. */
  private baseRev: string | null = null;
  private lastWrite = 0;
  readonly jobsDir: string;
  constructor(jobsDir: string) {
    this.jobsDir = jobsDir;
    fs.mkdirSync(jobsDir, { recursive: true });
  }
  /** Current job, re-read from current.json if the viewer (or anyone) saved a newer version. */
  require(): Job {
    const cur = path.join(this.jobsDir, 'current.json');
    try {
      const m = fs.statSync(cur).mtimeMs;
      if (m > this.lastWrite + 1) {
        const raw = JSON.parse(fs.readFileSync(cur, 'utf8'));
        this.adopt(raw, typeof raw._file === 'string' ? raw._file : null);
        this.lastWrite = m;
      }
    } catch { /* no current.json yet */ }
    if (!this.job) throw new Error('No job loaded. Call new_job or load_job first.');
    return this.job;
  }
  /** Take a job as read from a file: its revision becomes the base the next save is checked against. */
  private adopt(raw: Record<string, unknown>, file: string | null) {
    this.baseRev = typeof raw._rev === 'string' ? raw._rev : null;
    delete raw._savedAt; delete raw._rev; delete raw._file; delete raw._baseRev;
    this.job = raw as unknown as Job; this.invalidate();
    this.file = file ?? this.file ?? projectFileName(this.job.name);
  }
  invalidate() { this.toolpaths = null; }
  /** Replace the in-memory job with a new one (new_job). Unlike require(), never re-reads current.json; the next save creates or replaces `file`. */
  set(job: Job, file = projectFileName(job.name)): Job { this.job = job; this.file = file; this.baseRev = null; this.invalidate(); return job; }
  exists(file: string): boolean { return fs.existsSync(path.join(this.jobsDir, file)); }
  filePath(): string { return path.join(this.jobsDir, this.file ?? projectFileName(this.current().name)); }
  private current(): Job { if (!this.job) throw new Error('No job loaded. Call new_job or load_job first.'); return this.job; }
  /**
   * Persist the in-memory job to its file and to current.json. Deliberately does not go through require(): a newer
   * current.json (e.g. saved by the viewer) must not replace a job that was just created or loaded. If the file itself
   * changed since this job was read from it, the save is refused and the job is dropped so the next call re-reads it.
   */
  save(): string {
    const job = this.current();
    const file = this.file ?? (this.file = projectFileName(job.name));
    const full = path.join(this.jobsDir, file);
    if (this.baseRev !== null) {
      const onDisk = revOf(full);
      if (onDisk && onDisk !== this.baseRev) {
        this.job = null; this.invalidate(); this.lastWrite = 0;
        throw new Error(`${file} was saved by the viewer while this call ran; nothing was written. The job has been reloaded, repeat the change.`);
      }
    }
    const rev = newRev();
    const payload = JSON.stringify({ ...job, _rev: rev, _file: file, _savedAt: new Date().toISOString() }, null, 1);
    writeFileAtomic(full, payload);
    const cur = path.join(this.jobsDir, 'current.json');
    writeFileAtomic(cur, payload);
    this.baseRev = rev;
    this.lastWrite = fs.statSync(cur).mtimeMs;
    return full;
  }
  load(nameOrPath: string): Job {
    let file = nameOrPath;
    if (!fs.existsSync(file)) file = path.join(this.jobsDir, nameOrPath.endsWith('.json') ? nameOrPath : `${nameOrPath}.json`);
    if (!fs.existsSync(file)) throw new Error(`Job file not found: ${nameOrPath}`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.adopt(raw, path.basename(file));
    return this.job!;
  }
  list(): string[] {
    return fs.readdirSync(this.jobsDir).filter(f => f.endsWith('.json') && f !== 'current.json').map(f => f.replace(/\.json$/, ''));
  }
}
