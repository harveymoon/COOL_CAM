import { useState } from 'react';
import { Modal } from '../Modal';
import { useUi } from '../ui';

export function PromptModal({ title, label, initial, onSubmit }: { title: string; label: string; initial?: string; onSubmit: (v: string) => void }) {
  const ui = useUi(); const [v, setV] = useState(initial ?? '');
  const go = () => { if (v.trim()) { onSubmit(v.trim()); ui.closeModal(); } };
  return (
    <Modal title={title} onClose={ui.closeModal} width={380} footer={<><button onClick={ui.closeModal}>Cancel</button><button className="primary" onClick={go} disabled={!v.trim()}>OK</button></>}>
      <label className="row"><span className="lbl">{label}</span><input autoFocus type="text" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go(); }} /></label>
    </Modal>
  );
}

export function ConfirmModal({ title, message, onConfirm }: { title: string; message: string; onConfirm: () => void }) {
  const ui = useUi();
  return (
    <Modal title={title} onClose={ui.closeModal} width={380} footer={<><button onClick={ui.closeModal}>Cancel</button><button className="primary" onClick={() => { onConfirm(); ui.closeModal(); }}>OK</button></>}>
      <div>{message}</div>
    </Modal>
  );
}

export function OpenJobModal() {
  const ui = useUi();
  return (
    <Modal title="Open job" onClose={ui.closeModal} width={420} footer={<button onClick={ui.closeModal}>Cancel</button>}>
      <div className="list tall">
        {ui.files.map(f => <div key={f.name} className={`item${ui.file === f.name ? ' sel' : ''}`} onClick={() => { ui.setFile(f.name); ui.closeModal(); }}><span className="mono">{f.name}</span><span className="muted">{new Date(f.mtime).toLocaleString()}</span></div>)}
        {ui.files.length === 0 && <div className="empty">No saved jobs yet.</div>}
      </div>
    </Modal>
  );
}
