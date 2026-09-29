import { useCallback, useEffect, useRef, useState } from 'react';
import { newJob } from '@cool-cam/core';
import type { Job, Toolpath, ToolpathStats } from '@cool-cam/core';
import type { GenResponse } from './gen.worker';

export interface Derived {
  toolpaths: Toolpath[];
  stats: ToolpathStats[];
  gcode: string;
  totalSeconds: number;
  /** Cheap signature of the toolpaths, used to decide when the simulation must rerun. */
  signature: string;
  /** Post-processor warnings (spindle range, feeds above the machine maximum, ...). */
  postWarnings: string[];
  /** Generation time on the worker, ms. */
  ms: number;
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
  const past = useRef<Job[]>([]); const future = useRef<Job[]>([]);
  const [histTick, setHistTick] = useState(0);
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const refreshList = useCallback(async () => {
    try { const r = await fetch('/api/jobs'); setFiles(await r.json()); } catch { /* dev server only */ }
  }, []);

  const load = useCallback(async (f: string) => {
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(f)}?t=${Date.now()}`);
      if (r.status === 404 && f === 'current.json') { setJobState(null); setError(null); return; } // fresh install: no job yet, not an error
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      const raw = await r.json();
      if (raw._rev && raw._rev === rev.current) return; // our own save echoing back
      delete raw._rev; delete raw._savedAt;
      setJobState(raw as Job); setError(null); dirty.current = false; past.current = []; future.current = []; setHistTick(t => t + 1);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { refreshList(); load(file); }, [file, refreshList, load]);

  // live reload when anything (the MCP server, another editor) writes to the jobs folder: server-sent events from the local API,
  // the same channel under Vite, Electron and the CLI
  useEffect(() => {
    let es: EventSource | null = null;
    try { es = new EventSource('/api/events'); } catch { return; }
    es.addEventListener('jobs-changed', () => { refreshList(); if (!dirty.current) load(file); });
    return () => es?.close();
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
      if (next === prev) return prev;
      if (prev) { past.current.push(prev); if (past.current.length > 60) past.current.shift(); future.current = []; }
      dirty.current = true; persist(next, file);
      return next;
    });
    setHistTick(t => t + 1);
  }, [file, persist]);
  const undo = useCallback(() => { setJobState(cur => { const prev = past.current.pop(); if (!prev) return cur; if (cur) future.current.push(cur); dirty.current = true; persist(prev, file); return prev; }); setHistTick(t => t + 1); }, [file, persist]);
  const redo = useCallback(() => { setJobState(cur => { const nxt = future.current.pop(); if (!nxt) return cur; if (cur) past.current.push(cur); dirty.current = true; persist(nxt, file); return nxt; }); setHistTick(t => t + 1); }, [file, persist]);

  const createJob = useCallback((j: Job) => { setFile('current.json'); setJob(j); }, [setJob]);
  /** Save the current job under a new name (new file in jobs/). */
  const saveAs = useCallback((name: string) => {
    setJobState(prev => { if (!prev) return prev; const next = { ...prev, name }; const f = `${slug(name)}.json`; setFile(f); persist(next, f); return next; });
  }, [persist]);

  // Toolpaths are generated on a worker so the UI never freezes on a big job. A new edit while a generation is running
  // terminates that worker (cancellation) and starts a fresh one after a short debounce, so typing in a field costs one
  // generation, not one per keystroke. The previous result stays on screen until the new one arrives.
  const [derived, setDerived] = useState<Derived | null>(null);
  const [generating, setGenerating] = useState(false);
  const genWorker = useRef<Worker | null>(null);
  const genId = useRef(0);
  const genTimer = useRef<number | null>(null);
  useEffect(() => {
    if (genTimer.current) window.clearTimeout(genTimer.current);
    if (!job) { setDerived(null); setGenerating(false); genWorker.current?.terminate(); genWorker.current = null; return; }
    genTimer.current = window.setTimeout(() => {
      genWorker.current?.terminate();
      const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      genWorker.current = w;
      const id = ++genId.current; setGenerating(true);
      w.onmessage = (ev: MessageEvent<GenResponse>) => {
        const msg = ev.data; if (msg.id !== id) return;
        if (msg.type === 'done') { const { type: _t, id: _i, ...rest } = msg; void _t; void _i; setDerived(rest); setError(null); }
        else setError(`generation failed: ${msg.message}`);
        setGenerating(false);
      };
      w.onerror = e => { setError(`generation failed: ${e.message}`); setGenerating(false); };
      w.postMessage({ type: 'generate', id, job });
    }, 120);
    return () => { if (genTimer.current) window.clearTimeout(genTimer.current); };
  }, [job]);
  useEffect(() => () => genWorker.current?.terminate(), []);

  return { files, file, setFile, job, setJob, createJob, saveAs, derived, generating, error, saving, reload: () => { dirty.current = false; load(file); }, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, histTick };
}
