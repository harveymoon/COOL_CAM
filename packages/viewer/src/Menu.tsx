import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem = 'sep' | { label: string; onClick?: () => void; disabled?: boolean; checked?: boolean; shortcut?: string; submenu?: MenuItem[] };
export interface Menu { label: string; items: MenuItem[] }

export function MenuBar({ menus, right }: { menus: Menu[]; right?: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="menubar" ref={ref}>
      <span className="brand"><img src="/icon.svg" alt="" className="brand-icon" />COOL CAM</span>
      {menus.map((m, i) => (
        <div key={m.label} className={`menu${open === i ? ' open' : ''}`}>
          <button className="menu-title" onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => { if (open !== null) setOpen(i); }}>{m.label}</button>
          {open === i && <MenuList items={m.items} close={() => setOpen(null)} />}
        </div>
      ))}
      <span className="spacer" />
      {right}
    </div>
  );
}

function MenuList({ items, close }: { items: MenuItem[]; close: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="menu-list">
      {items.map((it, i) => it === 'sep' ? <div className="menu-sep" key={i} /> : (
        <div key={i} className={`menu-item${it.disabled ? ' disabled' : ''}${it.submenu ? ' has-sub' : ''}`} onMouseEnter={() => setSub(it.submenu ? i : null)}
          onClick={e => { e.stopPropagation(); if (it.disabled) return; if (it.submenu) { setSub(sub === i ? null : i); return; } it.onClick?.(); close(); }}>
          <span className="check">{it.checked ? '✓' : ''}</span>
          <span className="label">{it.label}</span>
          {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          {it.submenu && <span className="shortcut">▸</span>}
          {it.submenu && sub === i && <div className="submenu"><MenuList items={it.submenu} close={close} /></div>}
        </div>
      ))}
    </div>
  );
}
