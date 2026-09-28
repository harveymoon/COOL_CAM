import type { DockviewApi, SerializedDockview } from 'dockview-react';

export const PANELS: Record<string, string> = { viewport: 'Viewport', job: 'Job & Stock', shapes: 'Shapes', models: 'Models', ops: 'Operations', opedit: 'Parameters', output: 'Output' };
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

/** Keep panels from squishing: side panels get a sensible minimum width, the viewport a bit more. */
export function applyConstraints(api: DockviewApi) {
  for (const p of api.panels) { p.api.setConstraints({ minimumWidth: p.id === 'viewport' ? 320 : 280, minimumHeight: 120 }); if (PANELS[p.id] && p.title !== PANELS[p.id]) p.api.setTitle(PANELS[p.id]); }
}
