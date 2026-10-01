import type { DockviewApi, SerializedDockview } from 'dockview-react';

export const PANELS: Record<string, string> = { viewport: 'Viewport', job: 'Job & Stock', shapes: 'Shapes', models: 'Models', ops: 'Operations', opedit: 'Parameters', output: 'Output', help: 'Help' };
const KEY_CURRENT = 'coolcam.layout.current';
const KEY_SAVED = 'coolcam.layouts';

export function defaultLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', tabComponent: 'locked' });
  api.addPanel({ id: 'job', component: 'job', title: PANELS.job, position: { direction: 'left', referencePanel: 'viewport' }, initialWidth: 330 });
  api.addPanel({ id: 'shapes', component: 'shapes', title: PANELS.shapes, position: { direction: 'below', referencePanel: 'job' } });
  api.addPanel({ id: 'models', component: 'models', title: PANELS.models, position: { direction: 'within', referencePanel: 'shapes' } });
  api.getPanel('shapes')?.api.setActive();
  api.addPanel({ id: 'ops', component: 'ops', title: PANELS.ops, position: { direction: 'right', referencePanel: 'viewport' }, initialWidth: 360 });
  api.addPanel({ id: 'output', component: 'output', title: PANELS.output, position: { direction: 'below', referencePanel: 'ops' } });
}

export function showPanel(api: DockviewApi, id: string) {
  const p = api.getPanel(id);
  if (p) { p.api.setActive(); return; }
  if (id === 'viewport') api.addPanel({ id, component: id, title: PANELS[id], tabComponent: 'locked', position: api.panels.length ? { direction: 'right' } : undefined });
  else if (id === 'opedit' && api.getPanel('viewport')) api.addPanel({ id, component: id, title: PANELS[id], position: { direction: 'right', referencePanel: 'viewport' }, initialWidth: 340 });
  else if (id === 'models' && api.getPanel('shapes')) api.addPanel({ id, component: id, title: PANELS[id], position: { direction: 'within', referencePanel: 'shapes' } });
  else api.addPanel({ id, component: id, title: PANELS[id], floating: { width: 360, height: 420, x: 80, y: 80 } });
}

export function floatPanel(api: DockviewApi, id: string) {
  const p = api.getPanel(id); if (!p) return;
  if (p.group.api.location.type === 'floating') return;
  api.addFloatingGroup(p, { width: 360, height: 420, x: 80, y: 80 });
}

export function persistCurrent(api: DockviewApi) { try { localStorage.setItem(KEY_CURRENT, JSON.stringify(api.toJSON())); } catch { /* ignore */ } }
export function restoreCurrent(api: DockviewApi): boolean {
  try { const raw = localStorage.getItem(KEY_CURRENT); if (!raw) return false; api.fromJSON(JSON.parse(raw) as SerializedDockview); return api.panels.length > 0; } catch { return false; }
}
export function savedLayouts(): Record<string, SerializedDockview> { try { return JSON.parse(localStorage.getItem(KEY_SAVED) ?? '{}'); } catch { return {}; } }
export function saveLayout(api: DockviewApi, name: string) { const all = savedLayouts(); all[name] = api.toJSON(); localStorage.setItem(KEY_SAVED, JSON.stringify(all)); }
export function deleteLayout(name: string) { const all = savedLayouts(); delete all[name]; localStorage.setItem(KEY_SAVED, JSON.stringify(all)); }
export function loadLayout(api: DockviewApi, name: string): boolean { const l = savedLayouts()[name]; if (!l) return false; try { api.fromJSON(l); return true; } catch { return false; } }

/** Narrowest a panel may be dragged before its forms and lists start to jumble (matches `.panel-body { min-width }`). */
export const MIN_PANEL_WIDTH = 320;
export const MIN_VIEWPORT_WIDTH = 400;
/**
 * Keep panels from squishing. Constraints live on dockview *groups*, so they are (re)applied to every group whenever the
 * layout changes: a panel dragged into a new group takes its minimum along, and floating groups get one too.
 */
const applied = new WeakMap<object, string>();
let applying = false;
export function applyConstraints(api: DockviewApi) {
  // setConstraints itself raises a layout-change event, so this must be re-entrancy safe and only touch groups whose
  // constraints actually change (otherwise the layout-change handler and this function call each other forever)
  if (applying) return;
  applying = true;
  try {
    for (const p of api.panels) { if (PANELS[p.id] && p.title !== PANELS[p.id]) p.api.setTitle(PANELS[p.id]); }
    for (const g of api.groups) {
      const ids = g.panels.map(p => p.id);
      const minimumWidth = ids.includes('viewport') ? MIN_VIEWPORT_WIDTH : ids.length ? MIN_PANEL_WIDTH : 0;
      const key = `${minimumWidth}`;
      if (applied.get(g) === key) continue;
      try { g.api.setConstraints({ minimumWidth, minimumHeight: 140 }); applied.set(g, key); } catch { /* group being disposed */ }
    }
  } finally { applying = false; }
}
