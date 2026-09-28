import { useState } from 'react';
import type { Tool } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num, Sel, Text } from '../Fields';
import { useUi } from '../ui';

const blank = (): Tool => ({ id: '', number: 0, name: '', type: 'endmill', diameter: 6.35, flutes: 2, fluteLength: 19, rpm: 18000, feed: 1500, plunge: 500 });

export function ToolLibraryModal() {
  const ui = useUi();
  const { library, saveLibrary, job, setJob } = ui;
  const [sel, setSel] = useState<string | null>(library[0]?.id ?? null);
  const [draft, setDraft] = useState<Tool>(library[0] ? { ...library[0] } : blank());
  const [tab, setTab] = useState<'library' | 'job'>('library');
  const pick = (t: Tool) => { setSel(t.id); setDraft({ ...t }); };
  const inJob = (id: string) => !!job?.tools.some(t => t.id === id);
  const valid = draft.id.trim() && draft.name.trim() && draft.diameter > 0 && draft.flutes > 0;
  const d = (p: Partial<Tool>) => setDraft(x => ({ ...x, ...p }));
  const saveToLibrary = () => { if (!valid) return; const rest = library.filter(t => t.id !== draft.id); saveLibrary([...rest, { ...draft }].sort((a, b) => a.number - b.number)); setSel(draft.id); };
  const deleteFromLibrary = () => { if (!sel) return; saveLibrary(library.filter(t => t.id !== sel)); setSel(null); setDraft(blank()); };
  const addToJob = () => { if (!valid || !job) return; setJob(j => ({ ...j, tools: [...j.tools.filter(t => t.id !== draft.id), { ...draft }].sort((a, b) => a.number - b.number) })); };
  const removeFromJob = () => { if (!job || !sel) return; if (job.ops.some(o => o.toolId === sel)) { alert('This tool is used by an operation.'); return; } setJob(j => ({ ...j, tools: j.tools.filter(t => t.id !== sel) })); };
  const list = tab === 'library' ? library : (job?.tools ?? []);
  return (
    <Modal title="Tool library" onClose={ui.closeModal} width={760} footer={<><span className="muted">Library is saved to library/tools.json and shared with the MCP server.</span><span className="spacer" /><button className="primary" onClick={ui.closeModal}>Done</button></>}>
      <div className="tool-lib">
        <div className="tool-list">
          <div className="tabs small"><button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>Library ({library.length})</button><button className={tab === 'job' ? 'on' : ''} onClick={() => setTab('job')} disabled={!job}>In job ({job?.tools.length ?? 0})</button></div>
          <div className="list tall">
            {list.map(t => <div key={t.id} className={`item${sel === t.id ? ' sel' : ''}`} onClick={() => pick(t)}><span className="mono">T{t.number}</span><span>{t.name}</span><span className="muted">{t.diameter}mm {t.flutes}fl{tab === 'library' && inJob(t.id) ? ' · in job' : ''}</span></div>)}
            {list.length === 0 && <div className="empty">Empty.</div>}
          </div>
          <div className="btns"><button onClick={() => { setSel(null); setDraft(blank()); }}>New tool</button></div>
        </div>
        <div className="form tool-form">
          <div className="grid3">
            <Text label="id" value={draft.id} onChange={v => d({ id: v.replace(/\s+/g, '_') })} hint="unique key, e.g. t201" />
            <Num label="T number" value={draft.number} step={1} onChange={v => d({ number: v ?? 0 })} />
            <Sel label="type" value={draft.type} options={[{ value: 'endmill', label: 'endmill' }, { value: 'ballnose', label: 'ballnose' }, { value: 'vbit', label: 'V-bit' }, { value: 'drill', label: 'drill' }, { value: 'keyhole', label: 'keyhole' }] as { value: Tool['type']; label: string }[]} onChange={v => d({ type: v })} />
          </div>
          <Text label="name" value={draft.name} onChange={v => d({ name: v })} />
          <div className="grid4">
            <Num label="diameter" value={draft.diameter} step={0.01} onChange={v => d({ diameter: v ?? 0 })} />
            <Num label="flutes" value={draft.flutes} step={1} onChange={v => d({ flutes: v ?? 1 })} />
            <Num label="flute len" value={draft.fluteLength} step={0.5} onChange={v => d({ fluteLength: v })} />
            <Num label="tip angle" value={draft.tipAngle} step={1} hint="V-bits and drills" onChange={v => d({ tipAngle: v })} />
          </div>
          {draft.type === 'keyhole' && <Num label="shank Ø" value={draft.shankDiameter} step={0.1} hint="neck diameter above the keyhole head" onChange={v => d({ shankDiameter: v })} />}
          <div className="grid3">
            <Num label="rpm" value={draft.rpm} step={500} onChange={v => d({ rpm: v })} />
            <Num label="feed" value={draft.feed} step={50} onChange={v => d({ feed: v })} />
            <Num label="plunge" value={draft.plunge} step={50} onChange={v => d({ plunge: v })} />
          </div>
          <Text label="notes" value={draft.notes} onChange={v => d({ notes: v || undefined })} />
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="primary" onClick={saveToLibrary} disabled={!valid}>Save to library</button>
            <button onClick={addToJob} disabled={!valid || !job}>{inJob(draft.id) ? 'Update in job' : 'Add to job'}</button>
            <button onClick={removeFromJob} disabled={!job || !sel || !inJob(sel)}>Remove from job</button>
            <button className="danger" onClick={deleteFromLibrary} disabled={!sel || !library.some(t => t.id === sel)}>Delete from library</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
