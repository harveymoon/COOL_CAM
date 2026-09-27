import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateToolpaths, estimate, MACHINES, SHAPEOKO_HDM, newJob } from '@cool-cam/core';
import type { Job, Toolpath, ToolpathStats } from '@cool-cam/core';
import { postGrbl } from '@cool-cam/post';

export interface Derived {
  toolpaths: Toolpath[];
  stats: ToolpathStats[];
  gcode: string;
  totalSeconds: number;
  /** Cheap signature of the toolpaths, used to decide when the simulation must rerun. */
  signature: string;
}

export type JobUpdater = (job: Job) => Job;

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'job';

export function useJobStore() {
  const [files, setFiles] = useState<{ name: string; mtime: number }[]>([]);
  const [file, setFile] = useState<string>('current.json');
  const [job, setJobState] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rev = useRef<string>('');
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const refreshList = useCallback(async () => {
    try { const r = await fetch('/api/jobs'); setFiles(await r.json()); } catch { /* dev server only */ }
  }, []);

  const load = useCallback(async (f: string) => {
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(f)}?t=${Date.now()}`);
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      const raw = await r.json();
      if (raw._rev && raw._rev === rev.current) return; // our own save echoing back
      delete raw._rev; delete raw._savedAt;
      setJobState(raw as Job); setError(null); dirty.current = false;
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { refreshList(); load(file); }, [file, refreshList, load]);

  useEffect(() => {
    if (!import.meta.hot) return;
    import.meta.hot.on('cool-cam:jobs-changed', () => { refreshList(); if (!dirty.current) load(file); });
  }, [file, load, refreshList]);

  const persist = useCallback((j: Job, target: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const r = Math.random().toString(36).slice(2);
      rev.current = r; setSaving(true);
      try {
        const name = target === 'current.json' ? `${slug(j.name)}.json` : target;
        await fetch(`/api/jobs/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...j, _rev: r, _savedAt: new Date().toISOString() }) });
        dirty.current = false; refreshList();
      } catch (e) { setError(`save failed: ${(e as Error).message}`); }
      finally { setSaving(false); }
    }, 300);
  }, [refreshList]);

  const setJob = useCallback((up: JobUpdater | Job) => {
    setJobState(prev => {
      const next = typeof up === 'function' ? up(prev ?? newJob('Untitled')) : up;
      dirty.current = true; persist(next, file);
      return next;
    });
  }, [file, persist]);

  const createJob = useCallback((j: Job) => { setFile('current.json'); setJob(j); }, [setJob]);
  /** Save the current job under a new name (new file in jobs/). */
  const saveAs = useCallback((name: string) => {
    setJobState(prev => { if (!prev) return prev; const next = { ...prev, name }; const f = `${slug(name)}.json`; setFile(f); persist(next, f); return next; });
  }, [persist]);

  const derived: Derived | null = useMemo(() => {
    if (!job) return null;
    const machine = MACHINES[job.machineId] ?? SHAPEOKO_HDM;
    const toolpaths = generateToolpaths(job);
    const stats = toolpaths.map(tp => estimate(tp, machine));
    const post = postGrbl(job, toolpaths);
    let sig = `${job.stock.width}x${job.stock.length}x${job.stock.thickness}:${job.stock.origin}:${job.stock.zOrigin}`;
    for (const tp of toolpaths) { const last = tp.moves[tp.moves.length - 1]; sig += `|${tp.opId}:${tp.toolId}:${tp.moves.length}:${last ? `${last.x.toFixed(2)},${last.y.toFixed(2)},${last.z.toFixed(2)}` : ''}`; }
    return { toolpaths, stats, gcode: post.gcode, totalSeconds: post.seconds, signature: sig };
  }, [job]);

  return { files, file, setFile, job, setJob, createJob, saveAs, derived, error, saving, reload: () => { dirty.current = false; load(file); } };
}
