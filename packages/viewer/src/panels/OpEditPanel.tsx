import { useUi } from '../ui';
import { OpEditorForm } from '../OpEditorForm';
import { removeOperation, duplicateOperation } from '../actions';
import { ShapeParams } from '../ShapeParams';

/** Parameters panel: the active operation, or the selected shapes' geometry. */
export function OpEditPanel() {
  const ui = useUi();
  const { job, activeOp, paramsMode, setParamsMode } = ui;
  if (!job) return <div className="empty">No job.</div>;
  const op = job.ops.find(o => o.id === activeOp);
  const hasShapes = ui.selectedShapes.length > 0;
  return (
    <div className="panel-body">
      <div className="tabs small" style={{ marginBottom: 8 }}>
        <button className={paramsMode === 'op' ? 'on' : ''} onClick={() => setParamsMode('op')}>Operation{op ? '' : ' (none)'}</button>
        <button className={paramsMode === 'shape' ? 'on' : ''} onClick={() => setParamsMode('shape')}>Shape{hasShapes ? ` (${ui.selectedShapes.length})` : ''}</button>
      </div>
      {paramsMode === 'shape' ? (
        hasShapes ? <ShapeParams /> : <div className="empty">Select a shape in the Shapes list or by clicking it in the viewport.</div>
      ) : (
        <>
          {!op && <div className="empty">Select an operation in the Operations list. Changes apply live to the toolpaths and simulation.</div>}
          {op && <OpEditorForm id={op.id} />}
          {op && (
            <div className="btns op-actions">
              <button onClick={() => duplicateOperation(ui, op.id)}>Duplicate</button>
              <button className="danger" onClick={() => removeOperation(ui, op.id)}>Delete</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
