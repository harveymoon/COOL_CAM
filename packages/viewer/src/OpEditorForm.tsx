import { feedsAndSpeeds, formatDuration, profileTabCenters } from '@cool-cam/core';
import type { Op, ProfileOp, PocketOp, DrillOp, Rough3DOp, Finish3DOp, VCarveOp, KeyholeOp, MaterialId, Tabs, BoundaryMode, Containment, TraceOp, Job } from '@cool-cam/core';
import type { ReactNode } from 'react';
import { Num, Sel, Check } from './Fields';
import { opDefaultName } from './actions';
import { useUi } from './ui';

/** The operation editor body: header (name + enabled), then Shapes, Feeds & speeds, Parameters, Tabs, Info. */
export function OpEditorForm({ id }: { id: string }) {
  const ui = useUi();
  const job = ui.job; const op = job?.ops.find(o => o.id === id);
  if (!job || !op) return <div className="empty">Operation not found.</div>;
  const tool = job.tools.find(t => t.id === op.toolId);
  const u = (p: Record<string, unknown>) => ui.setJob(j => ({ ...j, ops: j.ops.map(o => (o.id === id ? ({ ...o, ...p } as Op) : o)) }));
  const toggleShape = (sid: string) => u({ shapeIds: op.shapeIds.includes(sid) ? op.shapeIds.filter(x => x !== sid) : [...op.shapeIds, sid] });
  const applyFeeds = () => {
    if (!tool || !job.material) return;
    const f = feedsAndSpeeds(tool, job.material as MaterialId);
    const patch: Record<string, unknown> = { rpm: f.rpm, feed: f.feed, plunge: f.plunge, depthPerPass: Math.min(f.depthPerPass, op.depth) };
    if (op.type === 'pocket') patch.stepover = f.stepover;
    u(patch);
  };
  const tpIdx = ui.derived?.toolpaths.findIndex(t => t.opId === id) ?? -1; const tp = tpIdx >= 0 ? ui.derived!.toolpaths[tpIdx] : null; const st = tpIdx >= 0 ? ui.derived!.stats[tpIdx] : null;
  return (
    <div className="form op-form">
      <div className="op-head">
        <span className="type-badge">{op.type}</span>
        <input type="text" className="name-input" placeholder={opDefaultName(op)} value={op.name ?? ''} onChange={e => u({ name: e.target.value || undefined })} />
        <label className="inline-check" title="enabled"><input type="checkbox" checked={op.enabled !== false} onChange={e => u({ enabled: e.target.checked })} /> enabled</label>
      </div>

      {'modelId' in op ? (
        <Section title="Model">
          <Sel label="model" value={op.modelId} options={(job.models ?? []).map(m => ({ value: m.id, label: `${m.id}${m.name ? ` · ${m.name}` : ''}` }))} onChange={v => u({ modelId: v })} />
        </Section>
      ) : (
        <Section title="Shapes" extra={ui.selectedShapes.length > 0 && <button className="mini" onClick={() => u({ shapeIds: ui.selectedShapes })}>use selection ({ui.selectedShapes.length})</button>}>
          <div className="chips">{job.shapes.map(s => <button key={s.id} className={`chip${op.shapeIds.includes(s.id) ? ' on' : ''}`} onClick={() => toggleShape(s.id)}>{s.id}</button>)}</div>
        </Section>
      )}

      <Section title="Feeds and speeds">
        <Sel label="tool" value={op.toolId} options={[...job.tools.map(t => ({ value: t.id, label: `T${t.number} ${t.name}` })), ...ui.library.filter(l => !job.tools.some(t => t.id === l.id)).map(t => ({ value: t.id, label: `＋ T${t.number} ${t.name} (from library)` }))]} hint="tools in this job, then the rest of your library (picking one adds it to the job)" onChange={v => { const lib = ui.library.find(t => t.id === v); ui.setJob(j => ({ ...j, tools: lib && !j.tools.some(t => t.id === v) ? [...j.tools, { ...lib }].sort((a, b) => a.number - b.number) : j.tools, ops: j.ops.map(o => (o.id === id ? ({ ...o, toolId: v } as Op) : o)) })); }} />
        <div className="grid3">
          <Num label="rpm" value={op.rpm} step={500} placeholder={String(tool?.rpm ?? '')} onChange={v => u({ rpm: v })} />
          <Num label="feed mm/min" value={op.feed} step={50} placeholder={String(tool?.feed ?? '')} onChange={v => u({ feed: v })} />
          <Num label="plunge mm/min" value={op.plunge} step={50} placeholder={String(tool?.plunge ?? '')} onChange={v => u({ plunge: v })} />
        </div>
        <div className="btns">
          <button onClick={applyFeeds} disabled={!job.material || !tool} title={job.material ? `Fill rpm, feed, plunge, depth per pass${op.type === 'pocket' ? ' and stepover' : ''} from the feeds & speeds table for ${job.material} with this tool` : 'Set a material in Job & Stock to get suggested feeds'}>Suggest feeds{job.material ? ` (${job.material})` : ''}</button>
          <span className="muted">blank fields fall back to the tool defaults</span>
        </div>
      </Section>

      <Section title="Parameters">
        <div className="grid3">
          <Num label={op.type === 'rough3d' || op.type === 'finish3d' ? 'max depth' : op.type === 'vcarve' ? 'depth cap (0=none)' : 'depth'} value={op.depth} step={0.5} hint="depth limit below stock top" onChange={v => u({ depth: v ?? (op.type === 'vcarve' ? 0 : 1) })} />
          {op.type !== 'finish3d' && op.type !== 'vcarve' && op.type !== 'keyhole' && op.type !== 'trace' && <Num label={op.type === 'rough3d' ? 'stepdown' : 'per pass'} value={op.depthPerPass} step={0.5} placeholder={tool ? String(tool.diameter) : ''} onChange={v => u({ depthPerPass: v })} />}
          {(op.type === 'profile' || op.type === 'pocket' || op.type === 'drill') && <Num label="start depth" value={op.startDepth} step={0.5} onChange={v => u({ startDepth: v })} />}
        </div>
        {op.type === 'profile' && <ProfileParams op={op} u={u} />}
        {op.type === 'pocket' && <PocketFields op={op} u={u} dia={tool?.diameter} />}
        {op.type === 'drill' && <DrillFields op={op} u={u} />}
        {op.type === 'vcarve' && <VCarveFields op={op} u={u} />}
        {op.type === 'keyhole' && <KeyholeFields op={op} u={u} />}
        {op.type === 'rough3d' && <Rough3DFields op={op} u={u} dia={tool?.diameter} />}
        {op.type === 'finish3d' && <Finish3DFields op={op} u={u} dia={tool?.diameter} />}
        {op.type === 'trace' && <TraceFields op={op} u={u} job={job} dia={tool?.diameter} />}
      </Section>

      {op.type === 'profile' && <Section title="Tabs"><TabFields op={op} u={u} /></Section>}
      {(op.type === 'rough3d' || op.type === 'finish3d') && <Section title="Machining boundary"><BoundaryFields op={op} u={u} /></Section>}

      <Section title="Info">
        {st ? <div className="kv">
          <div>moves</div><div>{st.moves}</div>
          <div>cut / rapid</div><div>{st.cutLength.toFixed(0)} / {st.rapidLength.toFixed(0)} mm</div>
          <div>min Z</div><div>{st.minZ.toFixed(2)}</div>
          <div>estimate</div><div>{formatDuration(st.seconds)}</div>
        </div> : <div className="muted">No toolpath yet.</div>}
        {tp?.warnings.map((w, k) => <div className="warn" key={k}>⚠ {w}</div>)}
      </Section>
    </div>
  );
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="op-section">
      <div className="op-section-title">{title}{extra}</div>
      {children}
    </div>
  );
}

function ProfileParams({ op, u }: { op: ProfileOp; u: (p: Record<string, unknown>) => void }) {
  return (
    <>
    <div className="grid3">
      <Sel label="side" value={op.side} options={[{ value: 'outside', label: 'outside' }, { value: 'inside', label: 'inside' }, { value: 'on', label: 'on line' }] as { value: ProfileOp['side']; label: string }[]} onChange={v => u({ side: v })} />
      <Sel label="direction" value={op.direction ?? 'climb'} options={[{ value: 'climb', label: 'climb' }, { value: 'conventional', label: 'conventional' }] as { value: 'climb' | 'conventional'; label: string }[]} onChange={v => u({ direction: v })} />
      <Num label="stock to leave" value={op.stockToLeave} step={0.1} onChange={v => u({ stockToLeave: v })} />
    </div>
    <div className="grid2">
      <Sel label="entry" value={op.entry ?? 'plunge'} options={[{ value: 'plunge', label: 'plunge' }, { value: 'ramp', label: 'ramp along contour' }] as { value: 'plunge' | 'ramp'; label: string }[]} onChange={v => u({ entry: v })} />
      <Num label="ramp angle °" value={op.rampAngle} step={1} placeholder="5" onChange={v => u({ rampAngle: v })} />
    </div>
    </>
  );
}

function TabFields({ op, u }: { op: ProfileOp; u: (p: Record<string, unknown>) => void }) {
  const ui = useUi();
  const tabs: Tabs = op.tabs ?? { mode: 'auto', count: 0, width: 6, height: 2 };
  const mode = tabs.mode ?? 'auto';
  const setTabs = (p: Partial<Tabs>) => u({ tabs: { ...tabs, ...p } });
  const switchMode = (m: 'auto' | 'manual') => {
    if (m === mode) return;
    if (m === 'manual' && !(tabs.points?.length)) {
      // seed manual points from the current auto layout so nothing disappears
      const seeds = ui.job ? profileTabCenters(ui.job, { ...op, tabs: { ...tabs, mode: 'auto' } }).map(c => ({ x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 })) : [];
      setTabs({ mode: 'manual', points: seeds });
    } else setTabs({ mode: m });
    if (m === 'auto') ui.setTabEdit(false);
  };
  const removePoint = (i: number) => setTabs({ points: (tabs.points ?? []).filter((_, k) => k !== i) });
  return (
    <>
      <div className="sub" style={{ marginTop: 0 }}>Mode
        <span className="switch">
          <button className={mode === 'auto' ? 'on' : ''} onClick={() => switchMode('auto')}>Auto</button>
          <button className={mode === 'manual' ? 'on' : ''} onClick={() => switchMode('manual')}>Manual</button>
        </span>
      </div>
      <div className="grid3">
        {mode === 'auto' ? <Num label="count" value={tabs.count} step={1} min={0} onChange={v => setTabs({ count: v ?? 0 })} /> : <div className="row"><span className="lbl">points</span><span className="mono">{tabs.points?.length ?? 0}</span></div>}
        <Num label="width" value={tabs.width} step={0.5} onChange={v => setTabs({ width: v ?? 6 })} />
        <Num label="height" value={tabs.height} step={0.5} onChange={v => setTabs({ height: v ?? 2 })} />
      </div>
      {mode === 'manual' && (
        <div className="tab-edit">
          <div className="btns">
            <button className={ui.tabEdit ? 'primary' : ''} onClick={() => ui.setTabEdit(!ui.tabEdit)}>{ui.tabEdit ? '● Placing tabs — click the path in 3D' : 'Place tabs in 3D'}</button>
            <button onClick={() => setTabs({ points: [] })} disabled={!tabs.points?.length}>Clear</button>
          </div>
          <div className="muted" style={{ margin: '4px 0' }}>Click on or near the contour to add a tab; click a tab marker to remove it. Esc stops placing.</div>
          <div className="list" style={{ maxHeight: 140 }}>
            {(tabs.points ?? []).map((p, i) => <div key={i} className="item"><span className="mono">tab {i + 1}</span><span className="muted">{p.x.toFixed(1)}, {p.y.toFixed(1)} <button className="mini" onClick={() => removePoint(i)}>✕</button></span></div>)}
            {!(tabs.points?.length) && <div className="empty">No tabs yet.</div>}
          </div>
        </div>
      )}
    </>
  );
}
function PocketFields({ op, u, dia }: { op: PocketOp; u: (p: Record<string, unknown>) => void; dia?: number }) {
  return (
    <>
      <div className="grid3">
        <Num label="stepover mm" value={op.stepover} step={0.1} placeholder={dia ? (dia * 0.4).toFixed(2) : ''} onChange={v => u({ stepover: v })} />
        <Sel label="entry" value={op.entry ?? 'helix'} options={[{ value: 'helix', label: 'helix' }, { value: 'ramp', label: 'ramp' }, { value: 'plunge', label: 'plunge' }] as { value: 'helix' | 'ramp' | 'plunge'; label: string }[]} onChange={v => u({ entry: v })} />
        <Sel label="direction" value={op.direction ?? 'climb'} options={[{ value: 'climb', label: 'climb' }, { value: 'conventional', label: 'conventional' }] as { value: 'climb' | 'conventional'; label: string }[]} onChange={v => u({ direction: v })} />
      </div>
      <div className="grid3">
        <Num label="stock to leave" value={op.stockToLeave} step={0.1} onChange={v => u({ stockToLeave: v })} />
        <Check label="finish pass" value={op.finishPass} hint="wall pass at zero stock-to-leave" onChange={v => u({ finishPass: v })} />
        <RestTool op={op} u={u} />
      </div>
    </>
  );
}
function RestTool({ op, u }: { op: PocketOp; u: (p: Record<string, unknown>) => void }) {
  const ui = useUi(); const tools = ui.job?.tools ?? [];
  return <Sel label="rest of" value={op.restToolId ?? ''} options={[{ value: '', label: '— (full pocket)' }, ...tools.filter(t => t.id !== op.toolId).map(t => ({ value: t.id, label: `T${t.number} ${t.name}` }))]} hint="rest machining: only cut what this larger tool left behind" onChange={v => u({ restToolId: v || undefined })} />;
}
function VCarveFields({ op, u }: { op: VCarveOp; u: (p: Record<string, unknown>) => void }) {
  const ui = useUi(); const tools = ui.job?.tools ?? [];
  return (
    <div className="grid3">
      <Num label="pass spacing" value={op.stepover} step={0.1} placeholder="0.4" hint="distance between offset passes, mm" onChange={v => u({ stepover: v })} />
      <Sel label="flat clearing" value={op.flatToolId ?? ''} options={[{ value: '', label: '— none' }, ...tools.filter(t => t.type === 'endmill').map(t => ({ value: t.id, label: `T${t.number} ${t.name}` }))]} hint="advanced V-carve: endmill clears wide areas flat at the depth cap" onChange={v => u({ flatToolId: v || undefined })} />
      <Num label="flat stepover" value={op.flatStepover} step={0.1} placeholder="40%" onChange={v => u({ flatStepover: v })} />
    </div>
  );
}
function KeyholeFields({ op, u }: { op: KeyholeOp; u: (p: Record<string, unknown>) => void }) {
  return (
    <div className="grid2">
      <Num label="slot length" value={op.length} step={1} placeholder="20" onChange={v => u({ length: v })} />
      <Num label="angle °" value={op.angle} step={15} placeholder="90" hint="0 = +X, 90 = +Y; 2-point line shapes set their own direction" onChange={v => u({ angle: v })} />
    </div>
  );
}
function DrillFields({ op, u }: { op: DrillOp; u: (p: Record<string, unknown>) => void }) {
  // `dwell` exists on DrillOp but is not emitted by the generator/post yet, so it is not offered here
  return <div className="grid2"><Num label="peck" value={op.peck} step={0.5} hint="0 = single plunge" onChange={v => u({ peck: v })} /></div>;
}

function Rough3DFields({ op, u, dia }: { op: Rough3DOp; u: (p: Record<string, unknown>) => void; dia?: number }) {
  return (
    <>
      <div className="grid3">
        <Num label="stepover mm" value={op.stepover} step={0.1} placeholder={dia ? (dia * 0.4).toFixed(2) : ''} onChange={v => u({ stepover: v })} />
        <Num label="stock to leave" value={op.stockToLeave} step={0.1} placeholder="0.3" onChange={v => u({ stockToLeave: v })} />
        <Num label="resolution" value={op.resolution} step={0.05} placeholder="auto" hint="heightmap cell size, mm" onChange={v => u({ resolution: v })} />
      </div>
      <div className="grid3">
        <Sel label="entry" value={op.entry ?? 'helix'} options={[{ value: 'helix', label: 'helix' }, { value: 'ramp', label: 'ramp' }, { value: 'plunge', label: 'plunge' }] as { value: 'helix' | 'ramp' | 'plunge'; label: string }[]} onChange={v => u({ entry: v })} />
        <Sel label="direction" value={op.direction ?? 'climb'} options={[{ value: 'climb', label: 'climb' }, { value: 'conventional', label: 'conventional' }] as { value: 'climb' | 'conventional'; label: string }[]} onChange={v => u({ direction: v })} />
      </div>
    </>
  );
}
function TraceFields({ op, u, job, dia }: { op: TraceOp; u: (p: Record<string, unknown>) => void; job: Job; dia?: number }) {
  const paths = job.paths ?? [];
  const groups = [...new Set(paths.map(p => p.tool ?? p.layer ?? 'paths'))];
  const sel = new Set(op.pathIds ?? []);
  const setIds = (ids: string[]) => u({ pathIds: ids });
  return (
    <>
      <div className="grid3">
        <Sel label="mode" value={op.mode} options={[{ value: 'tip', label: 'tip as given, verified against the model' }, { value: 'project', label: 'project Z onto the model (shallow surfaces)' }] as { value: 'project' | 'tip'; label: string }[]} onChange={v => u({ mode: v })} />
        <Sel label={op.mode === 'project' ? 'model' : 'verify against'} value={op.modelId ?? ''} options={[...(op.mode === 'tip' ? [{ value: '', label: '— (no check)' }] : []), ...(job.models ?? []).map(m => ({ value: m.id, label: m.id }))]} onChange={v => u({ modelId: v || undefined })} />
        {op.mode === 'project' ? <Num label="stock to leave" value={op.stockToLeave} step={0.05} placeholder="0" onChange={v => u({ stockToLeave: v })} /> : <Num label="depth offset" value={op.depthOffset} step={0.05} placeholder="0" hint="added to every Z (negative = deeper)" onChange={v => u({ depthOffset: v })} />}
      </div>
      <div className="grid2">
        <Num label="planned engagement" value={op.stepdown} step={0.1} placeholder={dia ? dia.toFixed(2) : ''} hint="mm of material a pass may meet; the simulator flags deeper cuts" onChange={v => u({ stepdown: v })} />
        {op.mode === 'project' && <Num label="resolution" value={op.resolution} step={0.05} placeholder="auto" hint="heightmap cell size, mm" onChange={v => u({ resolution: v })} />}
      </div>
      <div className="op-section-title">Paths ({sel.size} of {paths.length})</div>
      <div className="btns">
        <button onClick={() => setIds(paths.map(p => p.id))}>All</button><button onClick={() => setIds([])}>None</button>
        {groups.map(g => <button key={g} onClick={() => setIds(paths.filter(p => (p.tool ?? p.layer ?? 'paths') === g).map(p => p.id))}>{g}</button>)}
      </div>
      <div className="list" style={{ maxHeight: 180 }}>
        {paths.map(p => <label key={p.id} className="item" style={{ cursor: 'pointer' }}><input type="checkbox" checked={sel.has(p.id)} onChange={e => setIds(e.target.checked ? [...sel, p.id] : [...sel].filter(x => x !== p.id))} /> <span className="mono">{p.id}</span><span className="muted">{p.tool ?? p.layer ?? ''} · {p.points.length} pts</span></label>)}
      </div>
    </>
  );
}

function Finish3DFields({ op, u, dia }: { op: Finish3DOp; u: (p: Record<string, unknown>) => void; dia?: number }) {
  return (
    <>
      <div className="grid3">
        <Num label="stepover mm" value={op.stepover} step={0.05} placeholder={dia ? (dia * 0.1).toFixed(2) : ''} onChange={v => u({ stepover: v })} />
        <Sel label="along" value={op.axis ?? 'x'} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] as { value: 'x' | 'y'; label: string }[]} onChange={v => u({ axis: v })} />
        <Num label="stock to leave" value={op.stockToLeave} step={0.05} placeholder="0" onChange={v => u({ stockToLeave: v })} />
      </div>
      <div className="grid2">
        <Num label="resolution" value={op.resolution} step={0.05} placeholder="auto" hint="heightmap cell size, mm (smaller = smoother, slower)" onChange={v => u({ resolution: v })} />
        <Check label="finish base floor" value={op.finishFloor} hint="also raster the flat floor at the model base outside the footprint (roughing already flattens it)" onChange={v => u({ finishFloor: v })} />
      </div>
    </>
  );
}

function BoundaryFields({ op, u }: { op: Rough3DOp | Finish3DOp; u: (p: Record<string, unknown>) => void }) {
  const ui = useUi(); const job = ui.job!;
  const mode = op.boundaryMode ?? 'silhouette';
  const toggle = (key: 'shapeIds' | 'avoidShapeIds', id: string) => { const cur = (op[key] ?? []) as string[]; u({ [key]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }); };
  return (
    <>
      <div className="grid3">
        <Sel label="boundary" value={mode} options={[{ value: 'silhouette', label: 'model silhouette' }, { value: 'bbox', label: 'model bounding box' }, { value: 'stock', label: 'whole stock' }, { value: 'shapes', label: 'selected shapes' }] as { value: BoundaryMode; label: string }[]} onChange={v => u({ boundaryMode: v })} />
        <Num label="offset mm" value={op.boundary} step={0.5} placeholder="0" hint="grow (+) or shrink (−) the boundary" onChange={v => u({ boundary: v })} />
        <Sel label="containment" value={op.containment ?? 'inside'} options={[{ value: 'inside', label: 'tool inside' }, { value: 'center', label: 'centre on boundary' }, { value: 'outside', label: 'tool outside' }] as { value: Containment; label: string }[]} onChange={v => u({ containment: v })} />
      </div>
      {mode === 'shapes' && (<>
        <div className="sub">Boundary shapes {ui.selectedShapes.length > 0 && <button className="mini" onClick={() => u({ shapeIds: ui.selectedShapes })}>use selection ({ui.selectedShapes.length})</button>}</div>
        <div className="chips">{job.shapes.filter(s => s.polyline.closed).map(s => <button key={s.id} className={`chip${(op.shapeIds ?? []).includes(s.id) ? ' on' : ''}`} onClick={() => toggle('shapeIds', s.id)}>{s.id}</button>)}</div>
      </>)}
      <div className="sub">Avoid shapes <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>(excluded from machining)</span></div>
      <div className="chips">{job.shapes.filter(s => s.polyline.closed).map(s => <button key={s.id} className={`chip${(op.avoidShapeIds ?? []).includes(s.id) ? ' on' : ''}`} onClick={() => toggle('avoidShapeIds', s.id)}>{s.id}</button>)}{job.shapes.filter(s => s.polyline.closed).length === 0 && <span className="muted">no closed shapes in the job</span>}</div>
      <div className="grid2">
        <Num label="skip above depth" value={op.startDepth} step={0.5} placeholder="0" hint="Z window: surface shallower than this depth is left alone (e.g. the flat top of an engraving model)" onChange={v => u({ startDepth: v })} />
        <div className="row"><span className="lbl">&nbsp;</span><span className="muted">max depth is set in Parameters</span></div>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>The boundary outline is drawn in the viewport in violet while this operation is selected.</div>
    </>
  );
}
