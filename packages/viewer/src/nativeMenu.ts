import { useEffect, useRef } from 'react';
import type { Menu, MenuItem } from './Menu';

/**
 * Native application menu bridge. In Electron the preload exposes `window.coolcam`; the same menu definitions that drive
 * the in-app menubar are serialised (labels, state, ids) and sent to the main process, which builds the OS menu. Clicks
 * come back as ids and are dispatched to the original handlers. In a browser there is no bridge and nothing happens.
 */
export interface MenuItemSpec { id?: string; label?: string; sep?: boolean; disabled?: boolean; checked?: boolean; shortcut?: string; submenu?: MenuItemSpec[] }
export interface MenuSpec { label: string; items: MenuItemSpec[] }

declare global {
  interface Window {
    coolcam?: {
      isElectron: true;
      platform: string;
      setMenu(menus: MenuSpec[]): void;
      onMenuClick(cb: (id: string) => void): () => void;
    };
  }
}

export const isElectron = () => typeof window !== 'undefined' && !!window.coolcam?.isElectron;

function serialize(items: MenuItem[], prefix: string, registry: Map<string, () => void>): MenuItemSpec[] {
  return items.map((it, i) => {
    if (it === 'sep') return { sep: true };
    const id = `${prefix}.${i}`;
    if (it.onClick) registry.set(id, it.onClick);
    return { id, label: it.label, disabled: it.disabled, checked: it.checked, shortcut: it.shortcut, submenu: it.submenu ? serialize(it.submenu, id, registry) : undefined };
  });
}

/** Mirror `menus` into the native menu when running in Electron. Returns whether the native menu is in use. */
export function useNativeMenu(menus: Menu[]): boolean {
  const native = isElectron();
  const registry = useRef(new Map<string, () => void>());
  const lastJson = useRef('');
  // handlers close over the latest state, so rebuild the registry every render; only resend the spec when it changed
  const reg = new Map<string, () => void>();
  const spec: MenuSpec[] = menus.map((m, i) => ({ label: m.label, items: serialize(m.items, `m${i}`, reg) }));
  registry.current = reg;
  useEffect(() => {
    if (!native) return;
    const json = JSON.stringify(spec);
    if (json !== lastJson.current) { lastJson.current = json; window.coolcam!.setMenu(spec); }
  });
  useEffect(() => { if (!native) return; return window.coolcam!.onMenuClick(id => registry.current.get(id)?.()); }, [native]);
  return native;
}
