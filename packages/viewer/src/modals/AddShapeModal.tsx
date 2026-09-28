import { useState } from 'react';
import { polylineFromParams, polygon, uid } from '@cool-cam/core';
import type { Polyline, Shape, ShapeParams } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num, Sel, Text } from '../Fields';
import { useUi } from '../ui';
import { openShapeParams } from '../actions';

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
    let pl: Polyline | null; let params: ShapeParams | undefined;
    switch (kind) {
      case 'rect': params = { kind: 'rect', x: n('x'), y: n('y'), w: n('width', 10), h: n('height', 10), r: n('cornerRadius') }; break;
      case 'circle': params = { kind: 'circle', cx: n('x'), cy: n('y'), d: n('diameter', 10) }; break;
      case 'slot': params = { kind: 'slot', x1: n('x'), y1: n('y'), x2: n('x2'), y2: n('y2'), w: n('slotWidth', 6) }; break;
      case 'regular_polygon': params = { kind: 'regular_polygon', cx: n('x'), cy: n('y'), sides: Math.max(3, Math.round(n('sides', 6))), d: n('diameter', 20), rot: n('rotation') }; break;
    }
    if (params) pl = polylineFromParams(params);
    else { const pts = poly.split(/\s+/).map(t => t.split(',').map(Number)).filter(a => a.length === 2 && a.every(Number.isFinite)).map(([x, y]) => ({ x, y })); if (pts.length < 2) return; pl = polygon(pts, true); }
    if (!pl) return;
    const s: Shape = { id: id.trim() || uid(kind), name: kind, polyline: pl, params };
    if (ui.job?.shapes.some(x => x.id === s.id)) { alert(`Shape id ${s.id} already exists`); return; }
    ui.setJob(j => ({ ...j, shapes: [...j.shapes, s] })); ui.closeModal(); openShapeParams(ui, [s.id]);
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
        <div className="muted">Primitives stay editable in the Parameters panel after you add them.</div>
      </div>
    </Modal>
  );
}
