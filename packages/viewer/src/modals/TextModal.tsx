import { useState } from 'react';
import { stockBounds } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num, Sel, Text } from '../Fields';
import { useUi } from '../ui';
import { addText } from '../text';

export function TextModal() {
  const ui = useUi(); const b = ui.job ? stockBounds(ui.job.stock) : { x0: 0, x1: 100, y0: 0, y1: 100 };
  const preferred = ui.fonts.find(f => /^Arial Bold$/i.test(f)) ?? ui.fonts.find(f => /arial|helvetica|verdana/i.test(f)) ?? ui.fonts[0] ?? '';
  const [text, setText] = useState('COOL CAM'); const [font, setFont] = useState(preferred); const [size, setSize] = useState<number | undefined>(20);
  const [x, setX] = useState<number | undefined>((b.x0 + b.x1) / 2); const [y, setY] = useState<number | undefined>((b.y0 + b.y1) / 2); const [align, setAlign] = useState<'left' | 'center' | 'right'>('center'); const [spacing, setSpacing] = useState<number | undefined>(0);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const go = async () => { if (!font || !text) return; setBusy(true); setErr(null); try { await addText(ui, { kind: 'text', text, font, size: size ?? 20, x: x ?? 0, y: y ?? 0, align, spacing }); ui.closeModal(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <Modal title="Add text" onClose={ui.closeModal} width={520} footer={<><span className="muted">{ui.fonts.length} fonts from this Mac</span><span className="spacer" /><button onClick={ui.closeModal}>Cancel</button><button className="primary" onClick={go} disabled={busy || !font}>{busy ? 'Outlining…' : 'Add'}</button></>}>
      <div className="form">
        <Text label="text" value={text} onChange={setText} />
        <Sel label="font" value={font} options={ui.fonts.map(f => ({ value: f, label: f }))} onChange={setFont} />
        <div className="grid4">
          <Num label="size mm" value={size} step={1} hint="em size; capital letters are ~70% of it" onChange={setSize} />
          <Num label="x" value={x} step={1} onChange={setX} />
          <Num label="y (baseline)" value={y} step={1} onChange={setY} />
          <Sel label="align" value={align} options={[{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }] as { value: 'left' | 'center' | 'right'; label: string }[]} onChange={setAlign} />
        </div>
        <Num label="spacing" value={spacing} step={0.1} hint="extra letter spacing, mm" onChange={setSpacing} />
        {err && <div className="err">{err}</div>}
        <div className="muted">Letters become closed shapes (counters are holes). Carve them with a V-carve op and a V-bit, or pocket/profile them.</div>
      </div>
    </Modal>
  );
}
