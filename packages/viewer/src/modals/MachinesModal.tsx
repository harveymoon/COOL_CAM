import { useState } from 'react';
import { MACHINE_PRESETS, MACHINES, TOOL_CHANGE_MODES, machineFor, validateMachine } from '@cool-cam/core';
import type { MachineProfile } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num, Sel, Text } from '../Fields';
import { useUi } from '../ui';

const isPreset = (id: string) => !!MACHINES[id];

/**
 * Machines: the built-in presets plus the user's own profiles (stored next to the tool library, `machines.json`).
 * "Use in job" points the job at a preset by id, or embeds a custom profile so the post, simulator and MCP server all see it.
 */
export function MachinesModal() {
  const ui = useUi();
  const { machines, saveMachines, job, setJob } = ui;
  const current = job ? machineFor(job) : null;
  const [sel, setSel] = useState<string | null>(current?.id ?? null);
  const [draft, setDraft] = useState<MachineProfile>(current ? { ...current } : { ...MACHINE_PRESETS[0] });
  const [msg, setMsg] = useState<string | null>(null);
  const pick = (m: MachineProfile) => { setSel(m.id); setDraft(JSON.parse(JSON.stringify(m))); setMsg(null); };
  const d = (p: Partial<MachineProfile>) => setDraft(x => ({ ...x, ...p }));
  const dd = <K extends 'travel' | 'maxFeed' | 'rapid' | 'accel' | 'spindle'>(k: K, p: Partial<MachineProfile[K]>) => setDraft(x => ({ ...x, [k]: { ...x[k], ...p } }));
  const problems = validateMachine(draft);
  const inUse = !!job && current?.id === draft.id;

  const useInJob = () => {
    if (!job || problems.length) return;
    if (isPreset(draft.id) && JSON.stringify(MACHINES[draft.id]) === JSON.stringify(draft)) setJob(j => { const { machine: _m, ...rest } = j; void _m; return { ...rest, machineId: draft.id }; });
    else setJob(j => ({ ...j, machineId: draft.id, machine: { ...draft } }));
    setMsg(`The job now runs on ${draft.name}.`);
  };
  const saveMine = () => {
    if (problems.length) return;
    let m = { ...draft };
    if (isPreset(m.id) && JSON.stringify(MACHINES[m.id]) !== JSON.stringify(m)) { m = { ...m, id: `${m.id}-custom`, name: m.name.endsWith('(custom)') ? m.name : `${m.name} (custom)` }; setDraft(m); }
    else if (isPreset(m.id)) { setMsg('That is a built-in preset; change something (or the id) to save your own copy.'); return; }
    saveMachines([...machines.filter(x => x.id !== m.id), m].sort((a, b) => a.name.localeCompare(b.name)));
    setSel(m.id); setMsg(`Saved ${m.name} to your machines.`);
  };
  const deleteMine = () => { if (!sel || isPreset(sel)) return; saveMachines(machines.filter(x => x.id !== sel)); setSel(null); setMsg('Deleted.'); };
  const newBlank = () => { const base = MACHINES['generic-grbl']; pick({ ...base, id: 'my-machine', name: 'My machine', notes: '' }); };

  const row = (m: MachineProfile) => (
    <div key={m.id} className={`item${sel === m.id ? ' sel' : ''}`} onClick={() => pick(m)}>
      <span>{m.name}{current?.id === m.id ? <span className="muted"> · in job</span> : null}</span>
      <span className="muted mono">{m.travel.x}×{m.travel.y}×{m.travel.z}</span>
    </div>
  );

  return (
    <Modal title="Machines" className="machines-modal" onClose={ui.closeModal} width="min(1100px, 94vw)" footer={<>
      <span className="muted">{job ? <>Job uses <b>{current?.name}</b>{job.machine ? ' (custom profile embedded in the job)' : ''}</> : 'Open a project to assign a machine to it.'}</span>
      <span className="spacer" />
      <button className="primary" onClick={ui.closeModal}>Done</button>
    </>}>
      <div className="tool-lib">
        <div className="tool-list">
          <div className="op-section-title">Your machines ({machines.length})</div>
          <div className="list" style={{ maxHeight: 200, minHeight: 60 }}>
            {machines.length === 0 && <div className="empty">None yet. Pick a preset, edit it and press "Save to my machines".</div>}
            {machines.map(row)}
          </div>
          <div className="btns" style={{ marginBottom: 8 }}><button onClick={newBlank}>New machine</button><button className="danger" disabled={!sel || isPreset(sel)} onClick={deleteMine}>Delete</button></div>
          <div className="op-section-title">Presets</div>
          <div className="list tall">{MACHINE_PRESETS.map(row)}</div>
        </div>
        <div className="tool-form">
          <div className="grid3">
            <Text label="id" value={draft.id} onChange={v => d({ id: v.trim() })} hint="letters, digits, - and _" />
            <Text label="name" value={draft.name} onChange={v => d({ name: v })} />
            <Sel label="controller" value={draft.controller} options={[{ value: 'grbl' as const, label: 'GRBL' }, { value: 'grblhal' as const, label: 'grblHAL' }, { value: 'fluidnc' as const, label: 'FluidNC' }, { value: 'other' as const, label: 'other (GRBL-style G-code)' }]} onChange={v => d({ controller: v })} />
          </div>
          <div className="op-section-title">Travel (mm)</div>
          <div className="grid3">
            <Num label="X" value={draft.travel.x} step={1} onChange={v => dd('travel', { x: v ?? 0 })} />
            <Num label="Y" value={draft.travel.y} step={1} onChange={v => dd('travel', { y: v ?? 0 })} />
            <Num label="Z" value={draft.travel.z} step={1} onChange={v => dd('travel', { z: v ?? 0 })} />
          </div>
          <div className="op-section-title">Rates (mm/min) and acceleration (mm/s²)</div>
          <div className="grid3">
            <Num label="max feed XY" value={draft.maxFeed.xy} step={100} hint="feeds above this are flagged; GRBL clamps them ($110/$111)" onChange={v => dd('maxFeed', { xy: v ?? 0 })} />
            <Num label="max feed Z" value={draft.maxFeed.z} step={100} onChange={v => dd('maxFeed', { z: v ?? 0 })} />
            <span />
            <Num label="rapid XY" value={draft.rapid.xy} step={100} hint="time estimates only" onChange={v => dd('rapid', { xy: v ?? 0 })} />
            <Num label="rapid Z" value={draft.rapid.z} step={100} onChange={v => dd('rapid', { z: v ?? 0 })} />
            <span />
            <Num label="accel XY" value={draft.accel.xy} step={10} hint="time estimates only ($120/$121)" onChange={v => dd('accel', { xy: v ?? 0 })} />
            <Num label="accel Z" value={draft.accel.z} step={10} onChange={v => dd('accel', { z: v ?? 0 })} />
          </div>
          <div className="op-section-title">Spindle</div>
          <div className="grid3">
            <Num label="min rpm" value={draft.spindle.minRpm} step={500} onChange={v => dd('spindle', { minRpm: v ?? 0 })} />
            <Num label="max rpm" value={draft.spindle.maxRpm} step={500} onChange={v => dd('spindle', { maxRpm: v ?? 0 })} />
            <Num label="spin-up s" value={draft.spindle.spinUpSeconds} step={1} onChange={v => dd('spindle', { spinUpSeconds: v ?? 0 })} />
          </div>
          <div className="op-section-title">Tool changes and parking</div>
          <div className="grid2">
            <Sel label="tool change" value={draft.toolChange} options={TOOL_CHANGE_MODES} onChange={v => d({ toolChange: v })} />
            <Num label="safe Z (machine coords)" value={draft.safeZMachine} step={1} hint="G53 Z used before tool changes and at the end; -5 on machines that home Z at the top" onChange={v => d({ safeZMachine: v ?? 0 })} />
          </div>
          <Text label="notes" value={draft.notes ?? ''} onChange={v => d({ notes: v })} />
          {problems.length > 0 && <div className="warn" style={{ marginTop: 6 }}>{problems.join(' · ')}</div>}
          {msg && <div className="muted" style={{ marginTop: 6 }}>{msg}</div>}
          <div className="btns" style={{ marginTop: 10 }}>
            <button className="primary" disabled={!job || problems.length > 0 || inUse && !job?.machine && isPreset(draft.id)} onClick={useInJob}>{inUse ? 'Update job' : 'Use in job'}</button>
            <button disabled={problems.length > 0} onClick={saveMine}>Save to my machines</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
