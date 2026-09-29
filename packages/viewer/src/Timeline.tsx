import { useMemo, useRef, useState } from 'react';
import { formatDuration } from '@cool-cam/core';
import { useUi } from './ui';
import { timeToIdx } from './timelineMath';

const TOOL_COLORS = ['#5ec8ff', '#ffb454', '#c7a4ff', '#58d68d', '#ff8fab', '#ffd966', '#7fdbff', '#f39c6b'];

/** Timeline: one segment per operation (coloured by tool), tool-change ticks, hover details, click to jump, playhead + scrubber. */
export function Timeline() {
  const ui = useUi();
  const { total, progress, setProgress, playing, setPlaying, speed, setSpeed, seconds, totalSeconds, sim, derived, job } = ui;
  const [hover, setHover] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /** Convert a track fraction to a move index: through simulated time when we have it, else linearly. */
  const fracToProgress = (f: number) => {
    f = Math.max(0, Math.min(1, f));
    if (!sim) return f * total;
    const tl = sim.timeline; return Math.min(total, timeToIdx(tl, f * (tl[tl.length - 1] || 0)));
  };
  const scrubTo = (clientX: number) => { const r = trackRef.current?.getBoundingClientRect(); if (!r) return; setPlaying(false); setProgress(fracToProgress((clientX - r.left) / r.width)); };
  const onDown = (e: React.PointerEvent) => { if (e.button !== 0) return; e.preventDefault(); scrubTo(e.clientX); const move = (ev: PointerEvent) => scrubTo(ev.clientX); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); };
  const segs = useMemo(() => {
    if (!derived || !job) return [];
    const tl = sim?.timeline; const toolIdx = new Map<string, number>(); job.tools.forEach((t, i) => toolIdx.set(t.id, i));
    const out: { opId: string; name: string; toolId: string; toolName: string; start: number; end: number; t0: number; t1: number; change: boolean; color: string }[] = [];
    let acc = 0; let prevTool: string | null = null;
    derived.toolpaths.forEach(tp => {
      const start = acc, end = acc + tp.moves.length; acc = end;
      const t0 = tl ? (start > 0 ? tl[start - 1] : 0) : 0, t1 = tl ? (end > 0 ? tl[end - 1] : 0) : 0;
      const tool = job.tools.find(t => t.id === tp.toolId);
      out.push({ opId: tp.opId, name: tp.opName, toolId: tp.toolId, toolName: tool ? `T${tool.number} ${tool.name}` : tp.toolId, start, end, t0, t1, change: prevTool !== tp.toolId, color: TOOL_COLORS[(toolIdx.get(tp.toolId) ?? 0) % TOOL_COLORS.length] });
      prevTool = tp.toolId;
    });
    return out;
  }, [derived, job, sim]);
  const T = totalSeconds || 1;
  const pos = (s: { t0: number; t1: number; start: number; end: number }) => sim ? [s.t0 / T, s.t1 / T] : [s.start / Math.max(1, total), s.end / Math.max(1, total)];
  const playFrac = sim ? seconds / T : progress / Math.max(1, total);
  const h = hover !== null ? segs[hover] : null;
  return (
    <div className="timeline">
      <button onClick={() => setPlaying(!playing)} disabled={!total}>{playing ? '❚❚' : '▶'}</button>
      <button onClick={() => { setPlaying(false); setProgress(0); }} disabled={!total}>⏮</button>
      <button onClick={() => { setPlaying(false); setProgress(total); }} disabled={!total}>⏭</button>
      <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1, 4, 16, 64, 256].map(s => <option key={s} value={s}>{s}×</option>)}</select>
      <div className="tl-track" ref={trackRef} onMouseLeave={() => setHover(null)} onPointerDown={onDown} title="drag to scrub">
        {segs.map((s, i) => { const [a, b] = pos(s); return (
          <div key={s.opId} className={`tl-seg${ui.activeOp === s.opId ? ' active' : ''}`} style={{ left: `${a * 100}%`, width: `${Math.max(0.3, (b - a) * 100)}%`, background: s.color }}
            onMouseEnter={() => setHover(i)} onDoubleClick={() => { setPlaying(false); setProgress(s.end); ui.setActiveOp(s.opId); }} title={`${s.name} · ${s.toolName} · double-click to select`}>
            {s.change && <span className="tl-change" title={`tool change → ${s.toolName}`} />}
            <span className="tl-label">{s.name}</span>
          </div>
        ); })}
        <div className="tl-head" style={{ left: `${Math.min(100, playFrac * 100)}%` }}><span className="tl-knob" /></div>
        {h && <div className="tl-tip" style={{ left: `${Math.min(85, pos(h)[0] * 100)}%` }}>
          <b>{h.name}</b> · {h.toolName}{h.change ? ' · tool change' : ''}<br />moves {h.start}–{h.end} · {formatDuration(h.t0)} → {formatDuration(h.t1)} ({formatDuration(h.t1 - h.t0)})
        </div>}
      </div>
      <span className="mono">{Math.floor(progress)} / {total}</span>
      <span className="mono">{formatDuration(seconds)} / {formatDuration(totalSeconds)}</span>
    </div>
  );
}
