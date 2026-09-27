import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Job } from '@cool-cam/core';
import type { Derived } from './store';
import type { SimResponse } from './sim.worker';
import type { SimGridInfo } from './scene';

export interface SimGrid extends SimGridInfo { summary: Extract<SimResponse, { type: 'ready' }>['summary']; timeline: Float64Array }

export function useSimulation(job: Job | null, derived: Derived | null) {
  const [sim, setSim] = useState<SimGrid | null>(null);
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(16);
  const worker = useRef<Worker | null>(null);
  const seekInFlight = useRef(false);
  const pendingSeek = useRef<number | null>(null);

  const total = useMemo(() => derived ? derived.toolpaths.reduce((s, tp) => s + tp.moves.length, 0) : 0, [derived]);
  const opOffsets = useMemo(() => { const out: number[] = []; let acc = 0; for (const tp of derived?.toolpaths ?? []) { out.push(acc); acc += tp.moves.length; } return out; }, [derived]);
  const signature = derived?.signature ?? '';

  const requestSeek = useCallback((index: number) => {
    const w = worker.current; if (!w) return;
    if (seekInFlight.current) { pendingSeek.current = index; return; }
    seekInFlight.current = true; w.postMessage({ type: 'seek', index });
  }, []);

  useEffect(() => {
    worker.current?.terminate(); worker.current = null; setSim(null); setHeights(null); setProgress(total); setPlaying(false);
    if (!job || !derived || total === 0) return;
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w; setSimBusy(true); seekInFlight.current = false; pendingSeek.current = null;
    w.onmessage = (ev: MessageEvent<SimResponse>) => {
      const msg = ev.data;
      if (msg.type === 'ready') { setSim({ w: msg.w, h: msg.h, res: msg.res, x0: msg.x0, y0: msg.y0, top: msg.top, bottom: msg.bottom, summary: msg.summary, timeline: msg.timeline }); setHeights(msg.heights); setSimBusy(false); }
      else if (msg.type === 'heights') { setHeights(msg.heights); seekInFlight.current = false; if (pendingSeek.current !== null) { const n = pendingSeek.current; pendingSeek.current = null; requestSeek(n); } }
      else if (msg.type === 'error') { console.error('[sim]', msg.message); setSimBusy(false); }
    };
    w.postMessage({ type: 'init', job, toolpaths: derived.toolpaths });
    return () => { w.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const lastSeek = useRef(-1);
  useEffect(() => { if (!sim) return; const idx = Math.floor(progress); if (idx === lastSeek.current) return; lastSeek.current = idx; requestSeek(idx); }, [progress, sim, requestSeek]);

  useEffect(() => {
    if (!playing || !sim) return;
    let raf = 0; let last = performance.now(); const tl = sim.timeline;
    const idxToTime = (i: number) => { const w = Math.floor(i); if (w <= 0) return 0; if (w >= tl.length) return tl[tl.length - 1]; const t0 = tl[w - 1], t1 = tl[w]; return t0 + (t1 - t0) * (i - w); };
    const timeToIdx = (t: number) => { let lo = 0, hi = tl.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (tl[mid] < t) lo = mid + 1; else hi = mid; } const t0 = lo > 0 ? tl[lo - 1] : 0; const t1 = tl[lo]; return lo + (t1 > t0 ? (t - t0) / (t1 - t0) : 0); };
    const tick = (now: number) => { const dt = ((now - last) / 1000) * speed; last = now; setProgress(p => { const t = idxToTime(p) + dt; if (t >= tl[tl.length - 1]) { setPlaying(false); return total; } return Math.min(total, timeToIdx(t)); }); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, sim, total]);

  const seconds = useMemo(() => { if (!sim || total === 0) return 0; const tl = sim.timeline; const w = Math.floor(progress); if (w <= 0) return 0; if (w >= tl.length) return tl[tl.length - 1]; return tl[w - 1] + (tl[w] - tl[w - 1]) * (progress - w); }, [progress, sim, total]);
  const totalSeconds = sim ? sim.timeline[sim.timeline.length - 1] ?? 0 : derived?.totalSeconds ?? 0;
  const jumpTo = useCallback((i: number) => { setPlaying(false); setProgress(i); }, []);

  return { sim, heights, simBusy, progress, setProgress, playing, setPlaying, speed, setSpeed, total, opOffsets, seconds, totalSeconds, jumpTo };
}
