import { formatDuration } from '@cool-cam/core';
import type { Op } from '@cool-cam/core';
import { useUi } from '../ui';
import { addOperation, moveOperation, removeOperation, duplicateOperation, opDefaultName, openOpEditor } from '../actions';

export function OpsPanel() {
  const ui = useUi();
  const { job, derived, activeOp, setActiveOp, jumpTo, opOffsets, setJob } = ui;
  if (!job) return <div className="empty">No job.</div>;
  const update = (id: string, patch: Partial<Op>) => setJob(j => ({ ...j, ops: j.ops.map(o => (o.id === id ? ({ ...o, ...patch } as Op) : o)) }));
  return (
    <div className="panel-body">
      <div className="btns" style={{ marginBottom: 6 }}>
        <button onClick={() => addOperation(ui, 'pocket')}>+ Pocket</button>
        <button onClick={() => addOperation(ui, 'profile')}>+ Profile</button>
        <button onClick={() => addOperation(ui, 'drill')}>+ Drill</button>
        <button onClick={() => addOperation(ui, 'rough3d')} disabled={!job.models?.length} title={job.models?.length ? '' : 'import a 3D model first'}>+ 3D Rough</button>
        <button onClick={() => addOperation(ui, 'finish3d')} disabled={!job.models?.length} title={job.models?.length ? '' : 'import a 3D model first'}>+ 3D Finish</button>
        {ui.selectedShapes.length > 0 && <span className="muted">uses {ui.selectedShapes.length} selected shape(s)</span>}
      </div>
      {job.ops.length === 0 && <div className="empty">No operations. Select shapes, then add a pocket, profile or drill.</div>}
      {job.ops.map((op, i) => {
        const tpIdx = derived?.toolpaths.findIndex(t => t.opId === op.id) ?? -1;
        const tp = tpIdx >= 0 ? derived!.toolpaths[tpIdx] : null; const st = tpIdx >= 0 ? derived!.stats[tpIdx] : null;
        const tool = job.tools.find(t => t.id === op.toolId); const open = activeOp === op.id;
        const extra = op.type === 'profile' ? `${op.side}${op.tabs ? (op.tabs.mode === 'manual' ? ` · ${op.tabs.points?.length ?? 0} manual tabs` : op.tabs.count ? ` · ${op.tabs.count} tabs` : '') : ''}` : op.type === 'pocket' ? `${op.entry ?? 'helix'} entry · step ${op.stepover ?? (tool ? +(tool.diameter * 0.4).toFixed(2) : '?')}` : op.type === 'drill' ? `peck ${op.peck ?? 0}` : op.type === 'rough3d' ? `model ${op.modelId} · step ${op.stepover ?? '?'} · leave ${op.stockToLeave ?? 0.3}` : `model ${op.modelId} · step ${op.stepover ?? '?'} · along ${op.axis ?? 'x'}`;
        return (
          <div className={`op acc${open ? ' active' : ''}${op.enabled === false ? ' off' : ''}`} key={op.id}>
            <header onClick={() => { setActiveOp(open ? null : op.id); if (!open && tpIdx >= 0) jumpTo(opOffsets[tpIdx] + (tp?.moves.length ?? 0)); }}>
              <span className="chev">{open ? '▾' : '▸'}</span>
              <input type="checkbox" checked={op.enabled !== false} onClick={e => e.stopPropagation()} onChange={e => update(op.id, { enabled: e.target.checked })} title="enabled" />
              <span className="name">{i + 1}. {op.name ?? opDefaultName(op)}</span>
              <span className="type">{op.type} · T{tool?.number ?? '?'}{st ? ` · ${formatDuration(st.seconds)}` : ''}</span>
              {tp && tp.warnings.length > 0 && <span className="warn" title={tp.warnings.join('\n')}>⚠</span>}
            </header>
            {open && (
              <div className="op-info">
                <div><span className="muted">tool</span> {tool?.name ?? op.toolId}</div>
                {'modelId' in op ? <div><span className="muted">model</span> {op.modelId}</div> : <div><span className="muted">shapes</span> {op.shapeIds.join(', ') || '—'}</div>}
                <div><span className="muted">cut</span> {op.depth} mm in {op.depthPerPass ?? tool?.diameter ?? '?'} mm passes · {extra}</div>
                <div><span className="muted">feeds</span> {op.rpm ?? tool?.rpm ?? '?'} rpm · {op.feed ?? tool?.feed ?? '?'} / {op.plunge ?? tool?.plunge ?? '?'} mm/min{st ? ` · ${st.moves} moves · ${st.cutLength.toFixed(0)} mm` : ''}</div>
                {tp?.warnings.map((w, k) => <div className="warn" key={k}>⚠ {w}</div>)}
                <div className="btns">
                  <button className="primary" onClick={() => openOpEditor(ui, op.id)}>Edit</button>
                  <button onClick={() => moveOperation(ui, op.id, -1)} title="move up">▲</button>
                  <button onClick={() => moveOperation(ui, op.id, 1)} title="move down">▼</button>
                  <button onClick={() => duplicateOperation(ui, op.id)}>Duplicate</button>
                  <button className="danger" onClick={() => removeOperation(ui, op.id)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
