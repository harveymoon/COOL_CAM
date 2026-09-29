import { useEffect, useMemo, useState } from 'react';
import { MATERIALS, newJob } from '@cool-cam/core';
import type { MaterialId } from '@cool-cam/core';
import { useUi } from './ui';
import { Num, Sel, Text } from './Fields';
import type { ProjectEntry } from './store';

const fmtWhen = (ms: number) => { const d = new Date(ms); const days = (Date.now() - ms) / 86400000; return days < 1 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : days < 7 ? d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(); };

/**
 * Landing page / Open dialog: a grid of the projects in the jobs folder with their captured thumbnails. Selecting a card
 * shows a larger preview and the project's details; nothing switches until Open is pressed. Also creates named projects.
 * Shown full-window when no project is open (`asPage`), and as a dismissable modal from File → Open… otherwise.
 */
export function Landing({ asPage }: { asPage: boolean }) {
  const ui = useUi();
  const projects = useMemo(() => ui.files.filter(f => f.name !== 'current.json'), [ui.files]);
  const current = useMemo(() => ui.files.find(f => f.name === 'current.json') ?? null, [ui.files]);
  const [sel, setSel] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newMaterial, setNewMaterial] = useState<MaterialId | ''>('hardwood');
  const [stock, setStock] = useState<{ w?: number; l?: number; t?: number }>({ w: 200, l: 200, t: 18 });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useEffect(() => { ui.refreshList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel && !projects.some(p => p.name === sel)) setSel(null); }, [projects, sel]);
  const selected = projects.find(p => p.name === sel) ?? null;
  const thumbUrl = (p: ProjectEntry) => p.thumb ? `/api/jobs/${encodeURIComponent(p.thumb)}?t=${Math.round(p.mtime)}` : null;

  const open = async (f: string) => { await ui.openProject(f); if (!asPage) ui.closeModal(); };
  const create = () => {
    const name = newName.trim(); if (!name) return;
    const j = newJob(name, { width: stock.w ?? 200, length: stock.l ?? 200, thickness: stock.t ?? 18 });
    j.tools = ui.library.map(t => ({ ...t })); if (newMaterial) j.material = newMaterial;
    ui.createJob(j); if (!asPage) ui.closeModal();
  };
  const nameTaken = projects.some(p => p.summary?.name === newName.trim());

  return (
    <div className={`landing${asPage ? ' page' : ''}`}>
      <div className="landing-main">
        <div className="landing-head">
          <span className="brand"><img src="/icon.svg" alt="" className="brand-icon" />COOL CAM</span>
          <span className="muted">{projects.length} project{projects.length === 1 ? '' : 's'} in your jobs folder</span>
          <span className="spacer" />
          {!asPage && <button onClick={ui.closeModal}>Cancel</button>}
        </div>
        <div className="landing-new">
          <div className="op-section-title">New project</div>
          <div className="grid4">
            <Text label="name" value={newName} onChange={setNewName} hint="becomes the file name" />
            <Sel label="material" value={newMaterial} options={[{ value: '' as MaterialId | '', label: '—' }, ...Object.entries(MATERIALS).map(([k, m]) => ({ value: k as MaterialId, label: m.name }))]} onChange={setNewMaterial} />
            <div className="grid3" style={{ gridColumn: 'span 2' }}>
              <Num label="stock X" value={stock.w} step={1} onChange={v => setStock(s => ({ ...s, w: v }))} />
              <Num label="stock Y" value={stock.l} step={1} onChange={v => setStock(s => ({ ...s, l: v }))} />
              <Num label="thick" value={stock.t} step={0.5} onChange={v => setStock(s => ({ ...s, t: v }))} />
            </div>
          </div>
          <div className="btns"><button className="primary" onClick={create} disabled={!newName.trim()}>Create and open</button>{nameTaken && <span className="warn">A project with this name exists; creating will overwrite it.</span>}</div>
        </div>
        {current && current.summary && !projects.some(p => p.summary?.name === current.summary?.name) && (
          <div className="muted" style={{ margin: '8px 0' }}>The MCP server's current job "{current.summary.name}" has no project file of its own yet; opening it here will create one.</div>
        )}
        <div className="op-section-title" style={{ marginTop: 10 }}>Projects</div>
        <div className="project-grid">
          {projects.map(p => (
            <div key={p.name} className={`project-card${sel === p.name ? ' sel' : ''}`} onClick={() => setSel(p.name)} onDoubleClick={() => open(p.name)} title={p.summary?.name ?? p.name}>
              <div className="project-thumb">{thumbUrl(p) ? <img src={thumbUrl(p)!} alt="" /> : <div className="project-nothumb">no preview yet</div>}</div>
              <div className="project-name">{p.summary?.name ?? p.name}</div>
              <div className="project-meta">{p.summary ? `${p.summary.ops} op${p.summary.ops === 1 ? '' : 's'} · ${p.summary.stock ? `${p.summary.stock.width}×${p.summary.stock.length}×${p.summary.stock.thickness}` : ''}` : 'unreadable'} · {fmtWhen(p.mtime)}</div>
            </div>
          ))}
          {projects.length === 0 && <div className="empty">No projects yet. Create one above, or drop a job .json / STL / DXF onto the window.</div>}
        </div>
      </div>
      <div className="landing-side">
        {selected ? (
          <>
            <div className="project-preview">{thumbUrl(selected) ? <img src={thumbUrl(selected)!} alt="" /> : <div className="project-nothumb">A preview is captured after the project has been opened and simulated once.</div>}</div>
            <div className="project-title">{selected.summary?.name ?? selected.name}</div>
            <div className="kv" style={{ marginTop: 6 }}>
              <div>file</div><div className="mono">{selected.name}</div>
              <div>modified</div><div>{new Date(selected.mtime).toLocaleString()}</div>
              {selected.summary && <>
                <div>material</div><div>{selected.summary.material ? (MATERIALS[selected.summary.material as MaterialId]?.name ?? selected.summary.material) : '—'}</div>
                <div>stock</div><div>{selected.summary.stock ? `${selected.summary.stock.width} × ${selected.summary.stock.length} × ${selected.summary.stock.thickness} mm` : '—'}</div>
                <div>operations</div><div>{selected.summary.ops}</div>
                <div>shapes</div><div>{selected.summary.shapes}</div>
                <div>models</div><div>{selected.summary.models}</div>
              </>}
            </div>
            <div className="btns" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => open(selected.name)}>Open</button>
              {confirmDelete === selected.name
                ? <><span className="muted">Delete this project and its G-code?</span><button className="danger" onClick={() => { ui.deleteProject(selected.name); setConfirmDelete(null); }}>Yes, delete</button><button onClick={() => setConfirmDelete(null)}>No</button></>
                : <button className="danger" onClick={() => setConfirmDelete(selected.name)}>Delete…</button>}
            </div>
          </>
        ) : <div className="empty">Select a project to see its preview and details. Double-click opens it.</div>}
      </div>
    </div>
  );
}
