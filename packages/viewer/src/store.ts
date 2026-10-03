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

/** One project as the landing page lists it (see packages/server JobListEntry). */
export interface ProjectEntry { name: string; mtime: number; thumb: string | null; summary: { name: string; material?: string; stock?: { width: number; length: number; thickness: number }; ops: number; shapes: number; models: number; savedAt?: string } | null }

export type JobUpdater = (job: Job) => Job;

/** Project file stem for a name; mirrors `projectFileName` in the MCP server (both must agree). A name with nothing slug-able in it (another script) gets a short hash rather than colliding on "job". */
export const slugOf = (name: string) => {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (s) return s;
  let h = 5381; for (const c of name) h = (Math.imul(h, 33) ^ (c.codePointAt(0) ?? 0)) >>> 0;
  return `job-${h.toString(36)}`;
};

/**
 * Project store. Nothing is loaded on boot: the landing page lists the projects in the jobs folder and the user opens one
 * (or creates a named one). The open project autosaves to `<slug>.json`; the server mirrors every save to `current.json`,
 * which is the "job being worked on" handle the MCP server follows, so Claude sees the project you opened. When the MCP
 * server switches to another job, the viewer does not follow silently: it raises `mcpSwitched` for the UI to offer it.
 */
export function useJobStore() {
  const [files, setFiles] = useState<ProjectEntry[]>([]);
  /** Project file open in the editor, e.g. "star-coaster.json"; null on the landing page. */
  const [file, setFileState] = useState<string | null>(null);
  const [job, setJobState] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mcpSwitched, setMcpSwitched] = useState<{ file: string; name: string } | null>(null);
  const rev = useRef<string>('');
  const past = useRef<Job[]>([]); const future = useRef<Job[]>([]);
  const [histTick, setHistTick] = useState(0);
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const fileRef = useRef<string | null>(null); fileRef.current = file;

  const refreshList = useCallback(async () => {
    try { const r = await fetch('/api/jobs'); setFiles(await r.json()); } catch { /* dev server only */ }
  }, []);
  useEffect(() => { refreshList(); }, [refreshList]);

  const load = useCallback(async (f: string): Promise<boolean> => {
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(f)}?t=${Date.now()}`);
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      const raw = await r.json();
      if (raw._rev && raw._rev === rev.current) return true; // our own save echoing back
      rev.current = typeof raw._rev === 'string' ? raw._rev : ''; // the revision our next save is based on
      delete raw._rev; delete raw._savedAt; delete raw._file; delete raw._baseRev;
      setJobState(raw as Job); setError(null); dirty.current = false; past.current = []; future.current = []; setHistTick(t => t + 1);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }, []);

  /** Open a project file from the landing page (explicit user action). Also makes it the MCP server's current job. */
  const openProject = useCallback(async (f: string) => {
    if (await load(f)) {
      setFileState(f); setMcpSwitched(null);
      // point current.json at it so the MCP server works on the same project; re-PUT the file (the server mirrors it)
      try { const r = await fetch(`/api/jobs/${encodeURIComponent(f)}?t=${Date.now()}`); const raw = await r.json(); delete raw._rev; delete raw._savedAt; await fetch(`/api/jobs/${encodeURIComponent(f)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...raw, _rev: (rev.current = Math.random().toString(36).slice(2)), _savedAt: new Date().toISOString() }) }); } catch { /* ignore */ }
    }
  }, [load]);

  const closeProject = useCallback(() => { setFileState(null); setJobState(null); setError(null); past.current = []; future.current = []; dirty.current = false; setHistTick(t => t + 1); refreshList(); }, [refreshList]);

  const deleteProject = useCallback(async (f: string) => {
    await fetch(`/api/jobs/${encodeURIComponent(f)}`, { method: 'DELETE' });
    if (fileRef.current === f) closeProject(); else refreshList();
  }, [closeProject, refreshList]);

  // live reload when anything (the MCP server, another editor) writes to the jobs folder: server-sent events from the local API
  useEffect(() => {
    let es: EventSource | null = null;
    try { es = new EventSource('/api/events'); } catch { return; }
    es.addEventListener('jobs-changed', async (ev) => {
      refreshList();
      const changed = (() => { try { return JSON.parse((ev as MessageEvent).data).file as string | null; } catch { return null; } })();
      const open = fileRef.current;
      if (open && changed === open && !dirty.current) { load(open); return; }
      if (changed === 'current.json' && !dirty.current) {
        // did the MCP server move to another project? compare names; offer it rather than switching under the user
        try {
          const r = await fetch(`/api/jobs/current.json?t=${Date.now()}`); if (!r.ok) return; const cur = await r.json();
          if (cur._rev && cur._rev === rev.current) return;
          const curFile = typeof cur._file === 'string' ? cur._file : `${slugOf(cur.name ?? '')}.json`;
          if (open && curFile === open) { load(open); return; }
          if (!open || curFile !== open) setMcpSwitched({ file: curFile, name: cur.name ?? curFile });
        } catch { /* ignore */ }
      }
    });
    return () => es?.close();
  }, [load, refreshList]);

  /** The save waiting for the debounce (one at a time; a different target flushes the previous one first). */
  const pending = useRef<{ job: Job; target: string; timer: number } | null>(null);
  /** Saves run one after another: each PUT names the revision it is based on, so two in flight would refuse each other. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const doSave = useCallback(async (j: Job, target: string) => {
    const base = rev.current; const r = Math.random().toString(36).slice(2);
    rev.current = r; busy.current = true; setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(target)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...j, _rev: r, _baseRev: base || undefined, _savedAt: new Date().toISOString() }) });
      if (res.status === 409) {
        // the MCP server saved this file while we were editing: take its version rather than overwrite it, keep ours in Undo
        const body = await res.json().catch(() => null); const theirs = body?.job;
        if (theirs && typeof theirs === 'object' && fileRef.current === target) {
          rev.current = typeof theirs._rev === 'string' ? theirs._rev : '';
          delete theirs._rev; delete theirs._savedAt; delete theirs._file; delete theirs._baseRev;
          past.current.push(j); if (past.current.length > 60) past.current.shift(); future.current = [];
          setJobState(theirs as Job); setHistTick(t => t + 1);
          setError(`${target} was changed by the MCP server while you were editing: its version is shown. Undo brings yours back (saving that again replaces theirs).`);
        } else setError(`save refused: ${body?.message ?? 'the project was changed elsewhere'}`);
        dirty.current = false; return;
      }
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      dirty.current = false; refreshList();
    } catch (e) { setError(`save failed: ${(e as Error).message}`); }
    finally { busy.current = false; setSaving(false); }
  }, [refreshList]);
  const enqueue = useCallback((j: Job, target: string) => { const p = chain.current.then(() => doSave(j, target)); chain.current = p.catch(() => {}); return p; }, [doSave]);
  /** Send any pending save now and wait for every save in flight (window close, Save As). */
  const flush = useCallback(async () => {
    const p = pending.current;
    if (p) { window.clearTimeout(p.timer); pending.current = null; enqueue(p.job, p.target); }
    await chain.current;
  }, [enqueue]);
  const persist = useCallback((j: Job, target: string) => {
    const p = pending.current;
    if (p) { window.clearTimeout(p.timer); pending.current = null; if (p.target !== target) enqueue(p.job, p.target); } // another file's pending save is sent, not dropped
    pending.current = { job: j, target, timer: window.setTimeout(() => { pending.current = null; enqueue(j, target); }, 300) };
  }, [enqueue]);
  // a pending save must not die with the window: browsers get the leave-page prompt while the save is sent; Electron asks
  // the renderer to flush before the window closes (desktop main handles `close`)
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (!pending.current && !busy.current) return; flush(); if (!window.coolcam) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    const off = window.coolcam?.onFlush?.(async () => { await flush(); window.coolcam?.flushed?.(); });
    return () => { window.removeEventListener('beforeunload', onUnload); off?.(); };
  }, [flush]);
  /** Does a project file exist (by the server's current listing)? */
  const exists = useCallback(async (f: string) => { try { const list: ProjectEntry[] = await (await fetch('/api/jobs')).json(); setFiles(list); return list.some(e => e.name === f); } catch { return false; } }, []);

  const setJob = useCallback((up: JobUpdater | Job) => {
    const target = fileRef.current; if (!target) return; // nothing open: edits are ignored (the landing page is showing)
    setJobState(prev => {
      const next = typeof up === 'function' ? up(prev ?? newJob('Untitled')) : up;
      if (next === prev) return prev;
      if (prev) { past.current.push(prev); if (past.current.length > 60) past.current.shift(); future.current = []; }
      dirty.current = true; persist(next, target);
      return next;
    });
    setHistTick(t => t + 1);
  }, [persist]);
  const undo = useCallback(() => { const target = fileRef.current; if (!target) return; setJobState(cur => { const prev = past.current.pop(); if (!prev) return cur; if (cur) future.current.push(cur); dirty.current = true; persist(prev, target); return prev; }); setHistTick(t => t + 1); }, [persist]);
  const redo = useCallback(() => { const target = fileRef.current; if (!target) return; setJobState(cur => { const nxt = future.current.pop(); if (!nxt) return cur; if (cur) past.current.push(cur); dirty.current = true; persist(nxt, target); return nxt; }); setHistTick(t => t + 1); }, [persist]);

  /** Create a named project: becomes the open file and is saved immediately. Refuses to replace an existing project file. */
  const createJob = useCallback(async (j: Job): Promise<boolean> => {
    const f = `${slugOf(j.name)}.json`;
    if (await exists(f)) { setError(`A project file ${f} already exists. Open it from the project list, or choose another name.`); return false; }
    await flush();
    setFileState(f); fileRef.current = f; setMcpSwitched(null); rev.current = '';
    setJobState(j); past.current = []; future.current = []; dirty.current = true; persist(j, f); setHistTick(t => t + 1);
    return true;
  }, [persist, flush, exists]);
  /** Save the current project under a new name (new file in jobs/); the old file keeps its pending edits and is otherwise left as it was. */
  const saveAs = useCallback(async (name: string): Promise<boolean> => {
    const f = `${slugOf(name)}.json`;
    if (f !== fileRef.current && await exists(f)) { setError(`A project file ${f} already exists; choose another name.`); return false; }
    await flush();
    if (f !== fileRef.current) rev.current = ''; // a new file: the save is not based on any revision of it
    setJobState(prev => { if (!prev) return prev; const next = { ...prev, name }; setFileState(f); fileRef.current = f; persist(next, f); return next; });
    return true;
  }, [persist, flush, exists]);

  /** Store a thumbnail (JPEG data URL from the viewport) next to the open project file. */
  const saveThumbnail = useCallback(async (dataUrl: string) => {
    const target = fileRef.current; if (!target) return;
    try { const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0)); await fetch(`/api/jobs/${encodeURIComponent(target.replace(/\.json$/, '.jpg'))}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes }); refreshList(); } catch { /* thumbnails are best-effort */ }
  }, [refreshList]);

  // Toolpaths are generated on a worker so the UI never freezes on a big job. A new edit while a generation is running
  // terminates that worker (cancellation) and starts a fresh one after a short debounce, so typing in a field costs one
  // generation, not one per keystroke. The previous result stays on screen until the new one arrives.
  const [derived, setDerived] = useState<Derived | null>(null);
  // the job the shown toolpaths were generated from: while an edit is debounced, generating, or failed to generate, the
  // toolpaths (and their G-code and simulation) describe an older job and must not be exported as if they were current
  const [derivedJob, setDerivedJob] = useState<Job | null>(null);
  const [generating, setGenerating] = useState(false);
  const genWorker = useRef<Worker | null>(null);
  const genId = useRef(0);
  const genTimer = useRef<number | null>(null);
  useEffect(() => {
    if (genTimer.current) window.clearTimeout(genTimer.current);
    if (!job) { setDerived(null); setDerivedJob(null); setGenerating(false); genWorker.current?.terminate(); genWorker.current = null; return; }
    genTimer.current = window.setTimeout(() => {
      genWorker.current?.terminate();
      const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      genWorker.current = w;
      const id = ++genId.current; setGenerating(true);
      w.onmessage = (ev: MessageEvent<GenResponse>) => {
        const msg = ev.data; if (msg.id !== id) return;
        if (msg.type === 'done') { const { type: _t, id: _i, ...rest } = msg; void _t; void _i; setDerived(rest); setDerivedJob(job); setError(null); }
        else setError(`generation failed: ${msg.message}`);
        setGenerating(false);
      };
      w.onerror = e => { setError(`generation failed: ${e.message}`); setGenerating(false); };
      w.postMessage({ type: 'generate', id, job });
    }, 120);
    return () => { if (genTimer.current) window.clearTimeout(genTimer.current); };
  }, [job]);
  useEffect(() => () => genWorker.current?.terminate(), []);

  return {
    files, file, job, setJob, createJob, saveAs, flush, openProject, closeProject, deleteProject, saveThumbnail, refreshList, mcpSwitched, dismissMcpSwitched: () => setMcpSwitched(null),
    derived, generating, stale: job !== null && derivedJob !== job, error, saving, reload: () => { if (file) { dirty.current = false; load(file); } },
    undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, histTick,
  };
}
