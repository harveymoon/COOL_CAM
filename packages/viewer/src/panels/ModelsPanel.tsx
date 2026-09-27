import { meshBBox, placedMesh, placementFor, stockBounds } from '@cool-cam/core';
import type { Model } from '@cool-cam/core';
import { useUi } from '../ui';
import { Num } from '../Fields';
import { importModelFile, removeModel, proposeForModel } from '../actions';
import { useState } from 'react';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function ModelsPanel() {
  const ui = useUi();
  const { job, setJob, selectedModel, setSelectedModel } = ui;
  const [notes, setNotes] = useState<string[]>([]);
  if (!job) return <div className="empty">No job.</div>;
  const models = job.models ?? [];
  const m = models.find(x => x.id === selectedModel) ?? models[0];
  const b = stockBounds(job.stock);
  const setPlacement = (id: string, fn: (mm: Model) => Model['placement']) => setJob(j => ({ ...j, models: (j.models ?? []).map(k => (k.id === id ? { ...k, placement: fn(k) } : k)) }));
  const bb = m ? meshBBox(placedMesh(m)) : null;
  const warn: string[] = [];
  if (bb) {
    if (bb.max[2] - bb.min[2] > job.stock.thickness + 1e-6) warn.push(`Model is ${r1(bb.max[2] - bb.min[2])} mm tall, stock is ${job.stock.thickness} mm.`);
    if (bb.min[0] < b.x0 - 1e-6 || bb.max[0] > b.x1 + 1e-6 || bb.min[1] < b.y0 - 1e-6 || bb.max[1] > b.y1 + 1e-6) warn.push('Model extends outside the stock.');
    if (bb.max[2] > b.top + 1e-6) warn.push('Model top is above the stock top.');
    if (bb.min[2] < b.bottom - 1e-6) warn.push('Model bottom is below the stock bottom.');
  }
  return (
    <div className="panel-body">
      <div className="btns" style={{ marginBottom: 6 }}>
        <label className="file-btn"><input type="file" accept=".stl,.obj" onChange={e => { const f = e.target.files?.[0]; if (f) importModelFile(ui, f); e.target.value = ''; }} />Import STL / OBJ…</label>
        {m && <button className="danger" onClick={() => removeModel(ui, m.id)}>Delete</button>}
      </div>
      <div className="list" style={{ maxHeight: 120 }}>
        {models.length === 0 && <div className="empty">No models. Import an STL, then add a 3D Rough and a 3D Finish operation.</div>}
        {models.map(k => { const kb = meshBBox(placedMesh(k)); return <div key={k.id} className={`item${m?.id === k.id ? ' sel' : ''}`} onClick={() => setSelectedModel(k.id)}><span className="mono">{k.id}</span><span className="muted">{k.name ?? ''} · {r1(kb.max[0] - kb.min[0])}×{r1(kb.max[1] - kb.min[1])}×{r1(kb.max[2] - kb.min[2])} · {k.positions.length / 9} tris</span></div>; })}
      </div>
      {m && bb && (
        <div className="form">
          <div className="sub">Placement</div>
          <div className="grid3">
            <Num label="x" value={m.placement.x} step={1} onChange={v => setPlacement(m.id, k => ({ ...k.placement, x: v ?? 0 }))} />
            <Num label="y" value={m.placement.y} step={1} onChange={v => setPlacement(m.id, k => ({ ...k.placement, y: v ?? 0 }))} />
            <Num label="z" value={m.placement.z} step={0.5} onChange={v => setPlacement(m.id, k => ({ ...k.placement, z: v ?? 0 }))} />
          </div>
          <div className="grid4">
            <Num label="rot X°" value={m.placement.rotX} step={90} onChange={v => setPlacement(m.id, k => ({ ...k.placement, rotX: v ?? 0 }))} />
            <Num label="rot Y°" value={m.placement.rotY} step={90} onChange={v => setPlacement(m.id, k => ({ ...k.placement, rotY: v ?? 0 }))} />
            <Num label="rot Z°" value={m.placement.rotZ} step={15} onChange={v => setPlacement(m.id, k => ({ ...k.placement, rotZ: v ?? 0 }))} />
            <Num label="scale" value={m.placement.scale} step={0.1} onChange={v => setPlacement(m.id, k => ({ ...k.placement, scale: v ?? 1 }))} />
          </div>
          <div className="btns">
            <button onClick={() => setPlacement(m.id, k => placementFor(k, { centerX: (b.x0 + b.x1) / 2, centerY: (b.y0 + b.y1) / 2 }))}>Center XY</button>
            <button onClick={() => setPlacement(m.id, k => placementFor(k, { minX: b.x0 + 5, minY: b.y0 + 5 }))}>Corner +5</button>
            <button onClick={() => setPlacement(m.id, k => placementFor(k, { top: b.top }))}>Top at Z0</button>
            <button onClick={() => setPlacement(m.id, k => placementFor(k, { bottom: b.bottom }))}>Bottom on bed</button>
            <button onClick={() => setPlacement(m.id, k => ({ ...k.placement, scale: k.placement.scale * 25.4 }))} title="model authored in inches">× 25.4</button>
            <button onClick={() => setJob(j => ({ ...j, stock: { ...j.stock, width: Math.ceil(bb.max[0] - bb.min[0] + 20), length: Math.ceil(bb.max[1] - bb.min[1] + 20) } }))}>Fit stock (+10 mm)</button>
          </div>
          <div className="kv" style={{ marginTop: 6 }}>
            <div>placed bbox</div><div>{r1(bb.min[0])},{r1(bb.min[1])},{r1(bb.min[2])} → {r1(bb.max[0])},{r1(bb.max[1])},{r1(bb.max[2])}</div>
            <div>size</div><div>{r1(bb.max[0] - bb.min[0])} × {r1(bb.max[1] - bb.min[1])} × {r1(bb.max[2] - bb.min[2])} mm</div>
          </div>
          {warn.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
          <div className="sub" style={{ marginTop: 8 }}>Operations from features</div>
          <div className="btns">
            <button className="primary" onClick={() => setNotes(proposeForModel(ui, m.id))}>Propose operations</button>
            <span className="muted">flat floors → pockets, holes → drills, curves → 3D, cutout</span>
          </div>
          {notes.length > 0 && <div className="events" style={{ marginTop: 4 }}>{notes.map((n, i) => <div key={i} className={n.startsWith('Proposal failed') ? 'err' : ''}>• {n}</div>)}</div>}
        </div>
      )}
    </div>
  );
}
