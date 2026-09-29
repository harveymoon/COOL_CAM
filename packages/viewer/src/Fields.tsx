import { useState } from 'react';
import type { ReactNode } from 'react';

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="row" title={hint}><span className="lbl">{label}</span>{children}</label>;
}

/**
 * Numeric field. While it has focus it shows exactly what was typed (a draft), so the value can be blanked or partially
 * edited on the way to a new number even when the owner ignores or clamps intermediate values and re-renders with its own.
 * Every parseable change is still reported live; on blur or Enter the draft is dropped and the field shows the real value
 * again, so an invalid entry simply snaps back.
 */
export function Num({ label, value, onChange, step = 0.1, min, max, hint, placeholder }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; hint?: string; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Row label={label} hint={hint}>
      <input type="number" step={step} min={min} max={max} placeholder={placeholder} value={draft ?? (value ?? '')}
        onChange={e => { const t = e.target.value; setDraft(t); if (t === '') onChange(undefined); else { const n = Number(t); if (Number.isFinite(n)) onChange(n); } }}
        onBlur={() => setDraft(null)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); } }} />
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
