import { useState } from 'react';
import { bbox, stockBounds } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num } from '../Fields';
import { useUi } from '../ui';

export function TransformModal() {
  const ui = useUi();
  const [t, setT] = useState<Record<string, number | undefined>>({ dx: 0, dy: 0, scale: 1, rotate: 0, minX: 5, minY: 5 });
  const job = ui.job; if (!job) return null;
  const targets = ui.selectedShapes.length ? job.shapes.filter(s => ui.selectedShapes.includes(s.id)) : job.shapes;
  const bb = bbox(targets.map(s => s.polyline)); const b = stockBounds(job.stock);
  const apply = (fn: (p: { x: number; y: number }, c: { x: number; y: number }) => { x: number; y: number }) => {
    const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 }; const ids = new Set(targets.map(s => s.id));
    ui.setJob(j => ({ ...j, shapes: j.shapes.map(s => ids.has(s.id) ? { ...s, polyline: { closed: s.polyline.closed, points: s.polyline.points.map(p => fn(p, c)) } } : s) }));
  };
  const doTransform = () => {
    const dx = t.dx ?? 0, dy = t.dy ?? 0, k = t.scale ?? 1, th = ((t.rotate ?? 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
    apply((p, c) => { const x = (p.x - c.x) * k, y = (p.y - c.y) * k; return { x: c.x + x * cs - y * sn + dx, y: c.y + x * sn + y * cs + dy }; }); ui.closeModal();
  };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return (
    <Modal title={`Transform ${ui.selectedShapes.length ? `${ui.selectedShapes.length} selected shape(s)` : 'all shapes'}`} onClose={ui.closeModal} footer={<><button onClick={ui.closeModal}>Close</button><button className="primary" onClick={doTransform}>Apply</button></>}>
      <div className="form">
        <div className="muted" style={{ marginBottom: 6 }}>bbox {r1(bb.minX)},{r1(bb.minY)} → {r1(bb.maxX)},{r1(bb.maxY)} · size {r1(bb.maxX - bb.minX)} × {r1(bb.maxY - bb.minY)} · stock {b.x0}..{b.x1} × {b.y0}..{b.y1}</div>
        <div className="grid4">
          <Num label="dx" value={t.dx} step={1} onChange={v => setT(s => ({ ...s, dx: v }))} />
          <Num label="dy" value={t.dy} step={1} onChange={v => setT(s => ({ ...s, dy: v }))} />
          <Num label="scale" value={t.scale} step={0.01} onChange={v => setT(s => ({ ...s, scale: v }))} />
          <Num label="rotate °" value={t.rotate} step={1} onChange={v => setT(s => ({ ...s, rotate: v }))} />
        </div>
        <div className="sub">Quick actions</div>
        <div className="btns">
          <button onClick={() => { apply(p => ({ x: p.x + (b.x0 + b.x1) / 2 - (bb.minX + bb.maxX) / 2, y: p.y + (b.y0 + b.y1) / 2 - (bb.minY + bb.maxY) / 2 })); ui.closeModal(); }}>Center on stock</button>
          <button onClick={() => { apply(p => ({ x: p.x * 25.4, y: p.y * 25.4 })); ui.closeModal(); }} title="inch → mm">× 25.4</button>
          <button onClick={() => { apply(p => ({ x: p.x / 25.4, y: p.y / 25.4 })); ui.closeModal(); }} title="mm → inch">÷ 25.4</button>
          <button onClick={() => { apply(p => ({ x: -p.x + bb.minX + bb.maxX, y: p.y })); ui.closeModal(); }}>Mirror X</button>
          <button onClick={() => { apply(p => ({ x: p.x, y: -p.y + bb.minY + bb.maxY })); ui.closeModal(); }}>Mirror Y</button>
        </div>
        <div className="grid3" style={{ marginTop: 6 }}>
          <Num label="min X to" value={t.minX} step={1} onChange={v => setT(s => ({ ...s, minX: v }))} />
          <Num label="min Y to" value={t.minY} step={1} onChange={v => setT(s => ({ ...s, minY: v }))} />
          <div className="row"><span className="lbl">&nbsp;</span><button onClick={() => { const dx = (t.minX ?? 0) - bb.minX, dy = (t.minY ?? 0) - bb.minY; apply(p => ({ x: p.x + dx, y: p.y + dy })); ui.closeModal(); }}>Move corner</button></div>
        </div>
      </div>
    </Modal>
  );
}
