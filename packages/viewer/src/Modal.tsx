import { useEffect, type ReactNode } from 'react';

export function Modal({ title, children, onClose, width = 460, footer, className }: { title: string; children: ReactNode; onClose: () => void; width?: number | string; footer?: ReactNode; className?: string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${className ? ` ${className}` : ''}`} style={{ width }} role="dialog" aria-label={title}>
        <div className="modal-head"><span>{title}</span><button className="x" onClick={onClose} aria-label="close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
