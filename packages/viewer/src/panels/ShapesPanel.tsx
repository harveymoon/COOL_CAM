import { bbox, perimeter, signedArea } from '@cool-cam/core';
import { useUi } from '../ui';
import { duplicateShapes, deleteShapes, openShapeParams } from '../actions';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function ShapesPanel() {
  const ui = useUi();
  const { job, selectedShapes, setSelectedShapes } = ui;
  if (!job) return <div className="empty">No job.</div>;
  const toggle = (id: string, multi: boolean) => { setSelectedShapes(multi ? (selectedShapes.includes(id) ? selectedShapes.filter(x => x !== id) : [...selectedShapes, id]) : [id]); ui.setParamsMode('shape'); };
  return (
    <div className="panel-body fill">
      <div className="btns" style={{ marginBottom: 6 }}>
        <button onClick={() => ui.openModal({ kind: 'addShape' })}>+ Shape</button>
        <button className="primary" onClick={() => openShapeParams(ui, selectedShapes.length ? selectedShapes : job.shapes.map(s => s.id))} disabled={!job.shapes.length}>Edit</button>
        <button onClick={() => duplicateShapes(ui)} disabled={!selectedShapes.length}>Duplicate</button>
        <button className="danger" onClick={() => deleteShapes(ui)} disabled={!selectedShapes.length}>Delete</button>
      </div>
      <div className="list fill">
        {job.shapes.length === 0 && <div className="empty">No shapes. File → Import, or Edit → Add shape.</div>}
        {job.shapes.map(s => {
          const bb = bbox(s.polyline); const sel = selectedShapes.includes(s.id);
          return (
            <div key={s.id} className={`item${sel ? ' sel' : ''}`} onClick={e => toggle(s.id, e.shiftKey || e.metaKey)}>
              <span className="mono">{s.id}</span>
              <span className="muted">{s.polyline.closed ? '◯' : '⌒'} {r1(bb.maxX - bb.minX)}×{r1(bb.maxY - bb.minY)} @ {r1(bb.minX)},{r1(bb.minY)} {s.polyline.closed ? `A${Math.round(Math.abs(signedArea(s.polyline)))}` : `L${Math.round(perimeter(s.polyline))}`}</span>
            </div>
          );
        })}
      </div>
      <div className="btns"><button onClick={() => setSelectedShapes(job.shapes.map(s => s.id))}>All</button><button onClick={() => setSelectedShapes([])}>None</button><span className="muted">{selectedShapes.length ? `${selectedShapes.length} selected` : 'click to select · shift adds'}</span></div>
    </div>
  );
}
