import { useEffect, useState } from 'react';
import type { Tool } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num, Sel, Text } from '../Fields';
import { useUi } from '../ui';
import { ToolGlyph } from '../ToolGlyph';
import { ToolPreview3D } from '../ToolPreview3D';
import { toolThumbnail } from '../toolThumbs';

/** Rendered 3D thumbnail of a cutter (falls back to the schematic drawing when WebGL is unavailable). */
function ToolThumb({ tool, size }: { tool: Tool; size: number }) {
  if (tool.image) return <img src={tool.image} alt={tool.name} style={{ width: size, height: size * 1.5, objectFit: 'contain', background: '#0d0f13' }} />;
  const url = toolThumbnail(tool, size * 2, size * 3);
  return url ? <img src={url} alt={tool.name} width={size} height={size * 1.5} style={{ display: 'block', background: '#0d0f13' }} /> : <ToolGlyph tool={tool} size={size} />;
}

const blank = (): Tool => ({ id: '', number: 0, name: '', type: 'endmill', diameter: 6.35, flutes: 2, fluteLength: 19, rpm: 18000, feed: 1500, plunge: 500 });
const VIEW_KEY = 'coolcam.toollib.view';
type View = 'grid' | 'list';
interface LibraryInfo { file: string; source: 'env' | 'user'; userDir: string; bundled: string }

export function ToolLibraryModal() {
  const ui = useUi();
  const { library, saveLibrary, job, setJob } = ui;
  const [sel, setSel] = useState<string | null>(library[0]?.id ?? null);
  const [draft, setDraft] = useState<Tool>(library[0] ? { ...library[0] } : blank());
  const [tab, setTab] = useState<'library' | 'job'>('library');
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || 'grid'; } catch { return 'grid'; } });
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ } }, [view]);
  useEffect(() => { fetch('/api/tools/info').then(r => r.json()).then(setInfo).catch(() => {}); }, []);

  const pick = (t: Tool) => { setSel(t.id); setDraft({ ...t }); setMsg(null); };
  const inJob = (id: string) => !!job?.tools.some(t => t.id === id);
  const valid = draft.id.trim() && draft.name.trim() && draft.diameter > 0 && draft.flutes > 0;
  const d = (p: Partial<Tool>) => setDraft(x => ({ ...x, ...p }));
  const saveToLibrary = () => { if (!valid) return; const rest = library.filter(t => t.id !== draft.id); saveLibrary([...rest, { ...draft }].sort((a, b) => a.number - b.number)); setSel(draft.id); setMsg(`Saved ${draft.id} to the library.`); };
  const deleteFromLibrary = () => { if (!sel) return; saveLibrary(library.filter(t => t.id !== sel)); setSel(null); setDraft(blank()); };
  const addToJob = () => { if (!valid || !job) return; setJob(j => ({ ...j, tools: [...j.tools.filter(t => t.id !== draft.id), { ...draft }].sort((a, b) => a.number - b.number) })); setMsg(`${inJob(draft.id) ? 'Updated' : 'Added'} ${draft.id} in the job.`); };
  const removeFromJob = () => { if (!job || !sel) return; if (job.ops.some(o => o.toolId === sel)) { setMsg('This tool is used by an operation; change the operation first.'); return; } setJob(j => ({ ...j, tools: j.tools.filter(t => t.id !== sel) })); };
  const clearLibrary = () => { saveLibrary([]); setSel(null); setDraft(blank()); setConfirmClear(false); setMsg('Library cleared. Add your own cutters, or bring the bundled defaults back.'); };
  const addDefaults = async () => {
    try {
      const def: Tool[] = await (await fetch('/api/tools/defaults')).json();
      const merged = [...library]; let n = 0; for (const t of def) if (!merged.some(x => x.id === t.id)) { merged.push(t); n++; }
      saveLibrary(merged.sort((a, b) => a.number - b.number)); setMsg(`Added ${n} bundled default tool(s).`);
    } catch (e) { setMsg(`Could not read the bundled defaults: ${(e as Error).message}`); }
  };
  const list = tab === 'library' ? library : (job?.tools ?? []);
  /** How many operations reference each tool id (V-carve flat-clearing tools count too). */
  const usedBy = (id: string) => (job?.ops ?? []).filter(o => o.toolId === id || ('flatToolId' in o && (o as { flatToolId?: string }).flatToolId === id)).length;
  const usedCount = (job?.tools ?? []).filter(t => usedBy(t.id) > 0).length;
  const removeUnused = () => { if (!job) return; setJob(j => ({ ...j, tools: j.tools.filter(t => usedBy(t.id) > 0) })); setMsg('Removed the job tools no operation uses. New operations offer the library tools.'); };
  const meta = (t: Tool) => `${t.diameter} mm · ${t.type === 'vbit' ? `${t.tipAngle ?? 90}°` : `${t.flutes} fl`}${t.fluteLength ? ` · ${t.fluteLength} mm` : ''}`;

  return (
    <Modal title="Tool library" onClose={ui.closeModal} width={view === 'grid' ? 900 : 760} footer={<>
      <span className="lib-path" title={info ? `bundled defaults: ${info.bundled}` : ''}>{info ? `${info.source === 'env' ? 'COOL_CAM_LIBRARY: ' : 'Your library: '}${info.file}` : 'Library is shared with the MCP server.'}</span>
      <span className="spacer" />
      <button className="primary" onClick={ui.closeModal}>Done</button>
    </>}>
      <div className={`tool-lib${view === 'grid' ? ' grid-mode' : ''}`}>
        <div className="tool-list">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <div className="tabs small" style={{ flex: 1 }}><button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>Library ({library.length})</button><button className={tab === 'job' ? 'on' : ''} onClick={() => setTab('job')} disabled={!job} title="the tool table stored inside this job file (copied from the library when the job was made); operations pick from it">Job tools ({job?.tools.length ?? 0} · {usedCount} used)</button></div>
            <span className="switch" style={{ marginLeft: 0 }}><button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title="grid with pictures">▦</button><button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="compact list">☰</button></span>
          </div>
          {view === 'grid' ? (
            <div className="tool-grid">
              {list.map(t => (
                <div key={t.id} className={`tool-card${sel === t.id ? ' sel' : ''}`} onClick={() => pick(t)} title={t.notes ?? t.name}>
                  <ToolThumb tool={t} size={72} />
                  <span className="tnum">T{t.number}</span>
                  <span className="tname">{t.name}</span>
                  <span className="tmeta">{meta(t)}</span>
                  {tab === 'library' && inJob(t.id) && <span className="injob">in job</span>}
                  {tab === 'job' && (usedBy(t.id) > 0 ? <span className="injob">used by {usedBy(t.id)} op{usedBy(t.id) > 1 ? 's' : ''}</span> : <span className="tmeta">unused</span>)}
                </div>
              ))}
              {list.length === 0 && <div className="empty" style={{ gridColumn: '1 / -1' }}>Empty.</div>}
            </div>
          ) : (
            <div className="list tall">
              {list.map(t => <div key={t.id} className={`item${sel === t.id ? ' sel' : ''}`} onClick={() => pick(t)}><span className="mono">T{t.number}</span><span>{t.name}</span><span className="muted">{meta(t)}{tab === 'library' && inJob(t.id) ? ' · in job' : ''}{tab === 'job' ? (usedBy(t.id) ? ` · used by ${usedBy(t.id)}` : ' · unused') : ''}</span></div>)}
              {list.length === 0 && <div className="empty">Empty.</div>}
            </div>
          )}
          {tab === 'job' && <div className="muted" style={{ margin: '6px 0' }}>These are the tools stored in this job file; the operations use {usedCount} of them. Paths → Sync job tools from library replaces them with your library.</div>}
          <div className="btns" style={{ marginTop: 6 }}>
            <button onClick={() => { setSel(null); setDraft(blank()); setMsg(null); }}>New tool</button>
            {tab === 'job' && <button onClick={removeUnused} disabled={!job || usedCount === (job?.tools.length ?? 0)}>Remove unused from job</button>}
            <button onClick={addDefaults} title="add the bundled Carbide 3D set (skips ids you already have)">Add bundled defaults</button>
            {!confirmClear ? <button className="danger" onClick={() => setConfirmClear(true)} disabled={!library.length}>Clear library…</button>
              : <><span className="muted">Remove all {library.length} tools from your library?</span><button className="danger" onClick={clearLibrary}>Yes, clear</button><button onClick={() => setConfirmClear(false)}>Cancel</button></>}
          </div>
        </div>
        <div className="form tool-form">
          <div className="tool-preview">
            <ToolPreview3D tool={draft} width={130} height={190} />
            <div className="kv" style={{ flex: 1 }}>
              <div>id</div><div>{draft.id || '—'}</div>
              <div>type</div><div>{draft.type}</div>
              <div>cuts</div><div>{draft.diameter} mm × {draft.fluteLength ?? '?'} mm</div>
              {draft.sku && <><div>sku</div><div>{draft.sku}</div></>}
            </div>
          </div>
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
          <div className="grid3">
            <Num label="shank Ø" value={draft.shankDiameter} step={0.1} hint="shank / neck diameter (keyhole cutters: the neck above the head)" onChange={v => d({ shankDiameter: v })} />
            <Num label="overall len" value={draft.overallLength} step={1} hint="stick-out below the collet, mm" onChange={v => d({ overallLength: v })} />
            <Text label="sku" value={draft.sku} onChange={v => d({ sku: v || undefined })} hint="vendor part number" />
          </div>
          <div className="grid3">
            <Num label="rpm" value={draft.rpm} step={500} onChange={v => d({ rpm: v })} />
            <Num label="feed" value={draft.feed} step={50} onChange={v => d({ feed: v })} />
            <Num label="plunge" value={draft.plunge} step={50} onChange={v => d({ plunge: v })} />
          </div>
          <div className="grid2">
            <Text label="image URL" value={draft.image} onChange={v => d({ image: v || undefined })} hint="optional photo for the grid (URL or data URI); blank = rendered from the parameters" />
            <Text label="colour" value={draft.color} onChange={v => d({ color: v || undefined })} hint="CSS colour for the rendered body; blank = guessed from the coating (ZrN gold, DLC/Spektra dark)" />
          </div>
          <Text label="notes" value={draft.notes} onChange={v => d({ notes: v || undefined })} />
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="primary" onClick={saveToLibrary} disabled={!valid}>Save to library</button>
            <button onClick={addToJob} disabled={!valid || !job}>{inJob(draft.id) ? 'Update in job' : 'Add to job'}</button>
            <button onClick={removeFromJob} disabled={!job || !sel || !inJob(sel)}>Remove from job</button>
            <button className="danger" onClick={deleteFromLibrary} disabled={!sel || !library.some(t => t.id === sel)}>Delete from library</button>
          </div>
          {msg && <div className={/used by|Could not/.test(msg) ? 'inline-err' : 'muted'} style={{ marginTop: 6 }}>{msg}</div>}
        </div>
      </div>
    </Modal>
  );
}
