import { useUi } from '../ui';
import { OpEditorForm } from '../OpEditorForm';
import { removeOperation, duplicateOperation } from '../actions';

/** Dockable operation editor: shows the active operation; pick another from the dropdown. */
export function OpEditPanel() {
  const ui = useUi();
  const { job, activeOp } = ui;
  if (!job) return <div className="empty">No job.</div>;
  const op = job.ops.find(o => o.id === activeOp);
  return (
    <div className="panel-body">
      {!op && <div className="empty">Select an operation in the Operations list to edit it here. Changes apply live to the toolpaths and simulation.</div>}
      {op && <OpEditorForm id={op.id} />}
      {op && (
        <div className="btns op-actions">
          <button onClick={() => duplicateOperation(ui, op.id)}>Duplicate</button>
          <button className="danger" onClick={() => removeOperation(ui, op.id)}>Delete</button>
        </div>
      )}
    </div>
  );
}
