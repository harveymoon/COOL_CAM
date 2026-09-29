import { useState } from 'react';
import { formatDuration } from '@cool-cam/core';
import { useUi } from '../ui';
import { downloadGcode } from '../actions';

export function OutputPanel() {
  const ui = useUi();
  const { job, derived, sim, simBusy, jumpTo } = ui;
  const [showGcode, setShowGcode] = useState(false);
  if (!job) return <div className="empty">No job.</div>;
  const gcode = derived?.gcode ?? '';
  const warnings = [...(derived?.toolpaths.flatMap(tp => tp.warnings.map(w => ({ op: tp.opName, w }))) ?? []), ...(derived?.postWarnings ?? []).map(w => ({ op: 'post', w }))];
  const events = sim?.summary.events ?? [];
  const errors = events.filter(e => e.severity === 'error').length;
  return (
    <div className="panel-body">
      <div className="sub">Simulation {simBusy ? <span>running…</span> : sim ? <span className={errors ? 'err' : 'ok'}>{errors ? `${errors} problem(s)` : 'clean'}</span> : null}</div>
      {sim && (
        <div className="kv" style={{ margin: '6px 0' }}>
          <div>removed</div><div>{(sim.summary.removedVolume / 1000).toFixed(2)} cm³</div>
          <div>grid</div><div>{sim.w} × {sim.h} @ {sim.res.toFixed(2)} mm</div>
          <div>min Z</div><div>{sim.summary.minHeight.toFixed(2)}</div>
          <div>estimate</div><div>{formatDuration(derived?.totalSeconds ?? 0)}</div>
        </div>
      )}
      <div className="events">
        {warnings.map((w, i) => <div className="warn" key={`w${i}`}>⚠ {w.op}: {w.w}</div>)}
        {events.map((e, i) => (
          <div key={i} className={e.severity === 'error' ? 'err' : e.severity === 'warning' ? 'warn' : ''} onClick={() => jumpTo(e.moveIndex + 1)} title="jump to move">
            {e.severity === 'error' ? '✖' : e.severity === 'warning' ? '⚠' : 'ℹ'} {e.message} <span style={{ opacity: 0.6 }}>@ {e.x.toFixed(1)},{e.y.toFixed(1)},{e.z.toFixed(1)}</span>
          </div>
        ))}
        {sim && events.length === 0 && warnings.length === 0 && <div className="ok">No collisions or over-depth cuts.</div>}
      </div>
      <div className="sub" style={{ marginTop: 10 }}>G-code · {gcode ? gcode.split('\n').length : 0} lines</div>
      <div className="btns">
        <button className="primary" onClick={() => downloadGcode(ui)} disabled={!derived?.toolpaths.some(t => t.moves.length)}>Download .nc</button>
        <button onClick={() => setShowGcode(s => !s)}>{showGcode ? 'Hide' : 'Show'}</button>
      </div>
      {showGcode && <div className="gcode" style={{ marginTop: 8 }}>{gcode}</div>}
    </div>
  );
}
