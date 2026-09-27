import type { ReactNode } from 'react';

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="row" title={hint}><span className="lbl">{label}</span>{children}</label>;
}

export function Num({ label, value, onChange, step = 0.1, min, max, hint, placeholder }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; hint?: string; placeholder?: string }) {
  return (
    <Row label={label} hint={hint}>
      <input type="number" step={step} min={min} max={max} placeholder={placeholder} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </Row>
  );
}

export function Text({ label, value, onChange, hint }: { label: string; value: string | undefined; onChange: (v: string) => void; hint?: string }) {
  return <Row label={label} hint={hint}><input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} /></Row>;
}

export function Sel<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T | undefined; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <Row label={label} hint={hint}>
      <select value={value ?? ''} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </Row>
  );
}

export function Check({ label, value, onChange, hint }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void; hint?: string }) {
  return <Row label={label} hint={hint}><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /></Row>;
}
