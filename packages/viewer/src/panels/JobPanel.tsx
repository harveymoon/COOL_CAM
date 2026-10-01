import { MATERIALS, machineFor } from '@cool-cam/core';
import type { Job, MaterialId } from '@cool-cam/core';
import { useUi } from '../ui';
import { Num, Sel, Text } from '../Fields';

export function JobPanel() {
  const { job, setJob, derived, openModal } = useUi();
  if (!job) return <div className="empty">No job loaded. File → New job, or File → Open.</div>;
  const stock = job.stock;
  const est = derived ? Math.round(derived.totalSeconds) : 0;
  return (
    <div className="panel-body form">
      <Text label="name" value={job.name} onChange={v => setJob(j => ({ ...j, name: v }))} />
      <Sel label="material" value={(job.material ?? '') as MaterialId} options={[{ value: '' as MaterialId, label: '—' }, ...Object.entries(MATERIALS).map(([k, m]) => ({ value: k as MaterialId, label: m.name }))]} onChange={v => setJob(j => ({ ...j, material: v || undefined }))} />
      <div className="row"><span className="lbl">machine</span><span className="machine-row"><span>{machineFor(job).name}</span><button onClick={() => openModal({ kind: 'machines' })}>Change…</button></span></div>
      <div className="sub">Stock</div>
      <div className="grid3">
        <Num label="width X" value={stock.width} step={1} onChange={v => setJob(j => ({ ...j, stock: { ...j.stock, width: v ?? 1 } }))} />
        <Num label="length Y" value={stock.length} step={1} onChange={v => setJob(j => ({ ...j, stock: { ...j.stock, length: v ?? 1 } }))} />
        <Num label="thick Z" value={stock.thickness} step={0.5} onChange={v => setJob(j => ({ ...j, stock: { ...j.stock, thickness: v ?? 1 } }))} />
      </div>
      <div className="grid2">
        <Sel label="XY origin" value={stock.origin} options={['front-left', 'center', 'rear-left', 'front-right', 'rear-right'].map(v => ({ value: v as Job['stock']['origin'], label: v }))} onChange={v => setJob(j => ({ ...j, stock: { ...j.stock, origin: v } }))} />
        <Sel label="Z0 at" value={stock.zOrigin} options={[{ value: 'top' as const, label: 'stock top' }, { value: 'bottom' as const, label: 'stock bottom' }]} onChange={v => setJob(j => ({ ...j, stock: { ...j.stock, zOrigin: v } }))} />
      </div>
      <div className="grid2">
        <Num label="safe Z" value={job.safeZ} step={1} hint="rapid height between operations" onChange={v => setJob(j => ({ ...j, safeZ: v ?? 10 }))} />
        <Num label="clearance Z" value={job.clearanceZ} step={0.5} hint="retract height inside an operation" onChange={v => setJob(j => ({ ...j, clearanceZ: v ?? 3 }))} />
      </div>
      <div className="grid2">
        <Num label="spoilboard allowance" value={stock.spoilboard} step={0.1} placeholder="0" hint="mm below the stock bottom that cuts may reach (through-cuts into a sacrificial board); the simulator treats it as material and only errors beyond it" onChange={v => setJob(j => ({ ...j, stock: { ...j.stock, spoilboard: v && v > 0 ? v : undefined } }))} />
        <div className="row"><span className="lbl">paths</span><span className="mono">{job.paths?.length ?? 0}</span></div>
      </div>
      <div className="kv" style={{ marginTop: 8 }}>
        <div>shapes</div><div>{job.shapes.length}</div>
        <div>operations</div><div>{job.ops.length}</div>
        <div>estimate</div><div>{est >= 3600 ? `${Math.floor(est / 3600)}h ` : ''}{Math.floor((est % 3600) / 60)}m {est % 60}s</div>
      </div>
    </div>
  );
}
