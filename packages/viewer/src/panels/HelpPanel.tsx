import { useUi } from '../ui';

/** Context help: explains whatever the mouse is over (fields, buttons, list items, tabs). */
export function HelpPanel() {
  const { hover } = useUi();
  return (
    <div className="panel-body help-panel">
      {hover ? (
        <>
          <div className="help-title"><span className={`help-kind ${hover.kind}`}>{hover.kind}</span>{hover.label}</div>
          {hover.body && <p className="help-body">{hover.body}</p>}
          {hover.hint && <p className="help-hint">{hover.hint}</p>}
          {!hover.body && !hover.hint && <p className="muted">No details for this one yet.</p>}
        </>
      ) : <div className="empty">Hover over any field, button, list entry or panel tab to see what it does. Tooltips still appear on hover; this panel keeps the explanation in view.</div>}
    </div>
  );
}
