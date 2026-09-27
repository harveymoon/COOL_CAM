import { useState } from 'react';
import { rect, circleShape, slot, regularPolygon, polygon, uid } from '@cool-cam/core';
import type { Polyline, Shape } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num, Sel, Text } from '../Fields';
import { useUi } from '../ui';

type Kind = 'rect' | 'circle' | 'slot' | 'regular_polygon' | 'polygon';

export function AddShapeModal() {
  const ui = useUi();
  const [kind, setKind] = useState<Kind>('rect');
  const [id, setId] = useState('');
  const [f, setF] = useState<Record<string, number | undefined>>({ x: 10, y: 10, width: 50, height: 30, cornerRadius: 0, diameter: 20, sides: 6, x2: 60, y2: 10, slotWidth: 8, rotation: 0 });
  const [poly, setPoly] = useState('0,0 40,0 20,30');
  const set = (k: string) => (v: number | undefined) => setF(s => ({ ...s, [k]: v }));
  const n = (k: string, d = 0) => f[k] ?? d;
  const add = () => {
    let pl: Polyline;
    switch (kind) {
      case 'rect': pl = rect(n('x'), n('y'), n('width', 10), n('height', 10), n('cornerRadius')); break;
      case 'circle': pl = circleShape(n('x'), n('y'), n('diameter', 10)); break;
      case 'slot': pl = slot(n('x'), n('y'), n('x2'), n('y2'), n('slotWidth', 6)); break;
      case 'regular_polygon': pl = regularPolygon(n('x'), n('y'), Math.max(3, Math.round(n('sides', 6))), n('diameter', 20), n('rotation')); break;
      case 'polygon': { const pts = poly.split(/\s+/).map(t => t.split(',').map(Number)).filter(a => a.length === 2 && a.every(Number.isFinite)).map(([x, y]) => ({ x, y })); if (pts.length < 2) return; pl = polygon(pts, true); break; }
    }
    const s: Shape = { id: id.trim() || uid(kind), name: kind, polyline: pl };
    if (ui.job?.shapes.some(x => x.id === s.id)) { alert(`Shape id ${s.id} already exists`); return; }
    ui.setJob(j => ({ ...j, shapes: [...j.shapes, s] })); ui.setSelectedShapes([s.id]); ui.closeModal();
  };
  return (
    <Modal title="Add shape" onClose={ui.closeModal} footer={<><button onClick={ui.closeModal}>Cancel</button><button className="primary" onClick={add}>Add</button></>}>
      <div className="form">
        <Sel label="kind" value={kind} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'circle', label: 'Circle' }, { value: 'slot', label: 'Slot' }, { value: 'regular_polygon', label: 'Regular polygon' }, { value: 'polygon', label: 'Polygon (points)' }] as { value: Kind; label: string }[]} onChange={setKind} />
        <Text label="id" value={id} onChange={setId} hint="optional; auto-generated when blank" />
        {kind === 'rect' && <><div className="grid2"><Num label="x (left)" value={f.x} onChange={set('x')} /><Num label="y (bottom)" value={f.y} onChange={set('y')} /></div><div className="grid3"><Num label="width" value={f.width} onChange={set('width')} /><Num label="height" value={f.height} onChange={set('height')} /><Num label="corner r" value={f.cornerRadius} onChange={set('cornerRadius')} /></div></>}
        {kind === 'circle' && <div className="grid3"><Num label="cx" value={f.x} onChange={set('x')} /><Num label="cy" value={f.y} onChange={set('y')} /><Num label="diameter" value={f.diameter} onChange={set('diameter')} /></div>}
        {kind === 'slot' && <><div className="grid2"><Num label="x1" value={f.x} onChange={set('x')} /><Num label="y1" value={f.y} onChange={set('y')} /></div><div className="grid3"><Num label="x2" value={f.x2} onChange={set('x2')} /><Num label="y2" value={f.y2} onChange={set('y2')} /><Num label="width" value={f.slotWidth} onChange={set('slotWidth')} /></div></>}
        {kind === 'regular_polygon' && <><div className="grid2"><Num label="cx" value={f.x} onChange={set('x')} /><Num label="cy" value={f.y} onChange={set('y')} /></div><div className="grid3"><Num label="sides" value={f.sides} step={1} onChange={set('sides')} /><Num label="diameter" value={f.diameter} onChange={set('diameter')} /><Num label="rot °" value={f.rotation} onChange={set('rotation')} /></div></>}
        {kind === 'polygon' && <Text label="points" value={poly} onChange={setPoly} hint="x,y pairs separated by spaces" />}
      </div>
    </Modal>
  );
}
