import { useState } from 'react';
import { bbox, stockBounds, polylineFromParams, signedArea, perimeter } from '@cool-cam/core';
import type { Shape, ShapeParams as SP } from '@cool-cam/core';
import { useUi } from './ui';
import { Num, Sel, Text } from './Fields';
import { transformShapes, applyShapeParams, deleteShapes, duplicateShapes, booleanShapes, offsetShapes } from './actions';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Geometry editor for the selected shapes: absolute position, size, primitive parameters, relative transforms. */
export function ShapeParams() {
  const ui = useUi();
  const job = ui.job!;
  const sel = job.shapes.filter(s => ui.selectedShapes.includes(s.id));
  const [off, setOff] = useState<number | undefined>(1);
  /** Width/height linked (keep aspect) or independent. */
  const [linked, setLinked] = useState<boolean>(() => { try { return localStorage.getItem('coolcam.shape.linkWH') !== '0'; } catch { return true; } });
  const toggleLinked = () => setLinked(v => { try { localStorage.setItem('coolcam.shape.linkWH', v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  if (!sel.length) return null;
  const bb = bbox(sel.map(s => s.polyline)); const sb = stockBounds(job.stock);
  const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY; const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const single = sel.length === 1 ? sel[0] : null;
  const rename = (id: string, name: string) => ui.setJob(j => ({ ...j, shapes: j.shapes.map(s => (s.id === id ? { ...s, name: name || undefined } : s)) }));
  return (
    <div className="form">
      <div className="op-head"><span className="type-badge">{single ? (single.params?.kind ?? (single.polyline.closed ? 'shape' : 'path')) : `${sel.length} shapes`}</span>
        {single ? <input type="text" className="name-input" value={single.name ?? ''} placeholder={single.id} onChange={e => rename(single.id, e.target.value)} /> : <span className="muted">{sel.map(s => s.id).join(', ')}</span>}
      </div>

      <div className="op-section">
        <div className="op-section-title">Position</div>
        <div className="grid2">
          <Num label="center X" value={r2(cx)} step={1} onChange={v => v !== undefined && transformShapes(ui, { dx: v - cx })} />
          <Num label="center Y" value={r2(cy)} step={1} onChange={v => v !== undefined && transformShapes(ui, { dy: v - cy })} />
        </div>
        <div className="btns">
          <button onClick={() => transformShapes(ui, { dx: (sb.x0 + sb.x1) / 2 - cx, dy: (sb.y0 + sb.y1) / 2 - cy })}>Center on stock</button>
          <button onClick={() => transformShapes(ui, { mirrorX: true })}>Mirror X</button>
          <button onClick={() => transformShapes(ui, { mirrorY: true })}>Mirror Y</button>
        </div>
      </div>

      <div className="op-section">
        <div className="op-section-title">Scale</div>
        <div className="grid4 wh-row">
          <Num label="width" value={r2(w)} step={1} hint={linked ? 'scales about the center, keeping the aspect ratio' : 'scales X only, about the center'} onChange={v => v !== undefined && v > 0 && w > 0 && transformShapes(ui, linked ? { scale: v / w } : { scaleX: v / w })} />
          <button className={`link-toggle${linked ? ' on' : ''}`} onClick={toggleLinked} title={linked ? 'Width and height are linked (aspect ratio kept). Click to size them independently.' : 'Width and height are independent. Click to link them.'}>{linked ? '⚭' : '⚬'}</button>
          <Num label="height" value={r2(h)} step={1} hint={linked ? 'scales about the center, keeping the aspect ratio' : 'scales Y only, about the center'} onChange={v => v !== undefined && v > 0 && h > 0 && transformShapes(ui, linked ? { scale: v / h } : { scaleY: v / h })} />
          <div className="row"><span className="lbl">area · length</span><span className="mono">{single?.polyline.closed ? Math.round(Math.abs(signedArea(single.polyline))) : '—'} · {single ? Math.round(perimeter(single.polyline)) : '—'}</span></div>
        </div>
      </div>

      {single?.params && <PrimitiveParams shape={single} />}

      <div className="op-section">
        <div className="op-section-title">Modify</div>
        <div className="grid2">
          <Num label="offset mm" value={off} step={0.5} hint="positive grows, negative shrinks; creates new shapes" onChange={setOff} />
          <div className="row"><span className="lbl">&nbsp;</span><button onClick={() => offsetShapes(ui, off ?? 1)}>Offset</button></div>
        </div>
        <div className="btns">
          <button onClick={() => booleanShapes(ui, 'union')} disabled={sel.length < 2}>Union</button>
          <button onClick={() => booleanShapes(ui, 'subtract')} disabled={sel.length < 2} title="first selected minus the others">Subtract</button>
          <button onClick={() => booleanShapes(ui, 'intersect')} disabled={sel.length < 2}>Intersect</button>
          <button onClick={() => duplicateShapes(ui)}>Duplicate</button>
          <button className="danger" onClick={() => deleteShapes(ui)}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function PrimitiveParams({ shape }: { shape: Shape }) {
  const ui = useUi(); const p = shape.params!;
  const set = (patch: Partial<SP>) => applyShapeParams(ui, shape.id, { ...p, ...patch } as SP);
  const title = { rect: 'Rectangle', circle: 'Circle', regular_polygon: 'Regular polygon', slot: 'Slot', text: 'Text' }[p.kind];
  return (
    <div className="op-section">
      <div className="op-section-title">{title} parameters</div>
      {p.kind === 'rect' && <div className="grid3"><Num label="x (left)" value={p.x} step={1} onChange={v => set({ x: v ?? 0 })} /><Num label="y (bottom)" value={p.y} step={1} onChange={v => set({ y: v ?? 0 })} /><Num label="corner r" value={p.r} step={0.5} onChange={v => set({ r: v ?? 0 })} /></div>}
      {p.kind === 'circle' && <div className="grid3"><Num label="cx" value={p.cx} step={1} onChange={v => set({ cx: v ?? 0 })} /><Num label="cy" value={p.cy} step={1} onChange={v => set({ cy: v ?? 0 })} /><Num label="diameter" value={p.d} step={0.5} onChange={v => set({ d: v ?? 1 })} /></div>}
      {p.kind === 'regular_polygon' && <><div className="grid2"><Num label="cx" value={p.cx} step={1} onChange={v => set({ cx: v ?? 0 })} /><Num label="cy" value={p.cy} step={1} onChange={v => set({ cy: v ?? 0 })} /></div><div className="grid3"><Num label="sides" value={p.sides} step={1} onChange={v => set({ sides: Math.max(3, Math.round(v ?? 3)) })} /><Num label="diameter" value={p.d} step={0.5} onChange={v => set({ d: v ?? 1 })} /><Num label="rot °" value={p.rot} step={1} onChange={v => set({ rot: v ?? 0 })} /></div></>}
      {p.kind === 'slot' && <><div className="grid2"><Num label="x1" value={p.x1} step={1} onChange={v => set({ x1: v ?? 0 })} /><Num label="y1" value={p.y1} step={1} onChange={v => set({ y1: v ?? 0 })} /></div><div className="grid3"><Num label="x2" value={p.x2} step={1} onChange={v => set({ x2: v ?? 0 })} /><Num label="y2" value={p.y2} step={1} onChange={v => set({ y2: v ?? 0 })} /><Num label="width" value={p.w} step={0.5} onChange={v => set({ w: v ?? 1 })} /></div></>}
      {p.kind === 'text' && <TextParams p={p} set={set} />}
    </div>
  );
}

function TextParams({ p, set }: { p: Extract<SP, { kind: 'text' }>; set: (patch: Partial<SP>) => void }) {
  const ui = useUi();
  return (
    <>
      <Text label="text" value={p.text} onChange={v => set({ text: v })} />
      <Sel label="font" value={p.font} options={ui.fonts.map(f => ({ value: f, label: f }))} onChange={v => set({ font: v })} />
      <div className="grid4">
        <Num label="size mm" value={p.size} step={1} onChange={v => set({ size: v ?? 10 })} />
        <Num label="x" value={p.x} step={1} onChange={v => set({ x: v ?? 0 })} />
        <Num label="y" value={p.y} step={1} onChange={v => set({ y: v ?? 0 })} />
        <Sel label="align" value={p.align} options={[{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }] as { value: 'left' | 'center' | 'right'; label: string }[]} onChange={v => set({ align: v })} />
      </div>
      <Num label="spacing" value={p.spacing} step={0.1} placeholder="0" hint="extra letter spacing, mm" onChange={v => set({ spacing: v })} />
    </>
  );
}
void polylineFromParams;
