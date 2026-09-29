import { useCallback, useEffect, useRef, useState } from 'react';
import { DockviewReact, DockviewDefaultTab, themeDark, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelHeaderProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { UiProvider, useUi } from './ui';
import { MenuBar, type Menu } from './Menu';
import { Viewport } from './Viewport';
import { Timeline } from './Timeline';
import { JobPanel } from './panels/JobPanel';
import { ShapesPanel } from './panels/ShapesPanel';
import { OpsPanel } from './panels/OpsPanel';
import { OutputPanel } from './panels/OutputPanel';
import { OpEditPanel } from './panels/OpEditPanel';
import { ModelsPanel } from './panels/ModelsPanel';
import { TextModal } from './modals/TextModal';
import { HeightmapModal } from './modals/HeightmapModal';
import { AddShapeModal } from './modals/AddShapeModal';
import { TransformModal } from './modals/TransformModal';
import { ToolLibraryModal } from './modals/ToolLibraryModal';
import { PromptModal, ConfirmModal, OpenJobModal } from './modals/SmallModals';
import { addOperation, deleteShapes, downloadGcode, duplicateShapes, importFile, importModelFile, syncToolsFromLibrary, openShapeParams, booleanShapes, offsetShapes } from './actions';
import { PANELS, applyConstraints, defaultLayout, deleteLayout, floatPanel, loadLayout, persistCurrent, restoreCurrent, saveLayout, savedLayouts, showPanel } from './layout';

const components = { viewport: Viewport, job: JobPanel, shapes: ShapesPanel, models: ModelsPanel, ops: OpsPanel, opedit: OpEditPanel, output: OutputPanel };
const tabComponents = { locked: (p: IDockviewPanelHeaderProps) => <DockviewDefaultTab {...p} hideClose /> };

export function App() { return <UiProvider><Shell /></UiProvider>; }

function Shell() {
  const ui = useUi();
  const apiRef = useRef<DockviewApi | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const onReady = useCallback((e: DockviewReadyEvent) => {
    apiRef.current = e.api; ui.dockRef.current = e.api;
    if (!restoreCurrent(e.api)) defaultLayout(e.api);
    else if (!e.api.getPanel('models')) { showPanel(e.api, 'models'); e.api.getPanel('shapes')?.api.setActive(); }
    applyConstraints(e.api);
    e.api.onDidAddPanel(() => applyConstraints(e.api));
    let t: number | null = null;
    e.api.onDidLayoutChange(() => { if (t) window.clearTimeout(t); t = window.setTimeout(() => { persistCurrent(e.api); setLayoutTick(x => x + 1); }, 200); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyboard: space toggles the view cube, escape closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ui.modal) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ui.redo(); else ui.undo(); return; }
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); ui.setViewCube(v => !v); }
      else if (e.key === 'Escape') { ui.setViewCube(false); ui.setTabEdit(false); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [ui]);

  const api = apiRef.current;
  const layouts = Object.keys(savedLayouts());
  const scene = () => ui.sceneRef.current;
  const menus: Menu[] = [
    { label: 'File', items: [
      { label: 'New job…', shortcut: '', onClick: () => ui.openModal({ kind: 'prompt', title: 'New job', label: 'name', initial: 'New job', onSubmit: n => ui.createJob(n) }) },
      { label: 'Open…', onClick: () => ui.openModal({ kind: 'open' }) },
      { label: 'Save as…', disabled: !ui.job, onClick: () => ui.openModal({ kind: 'prompt', title: 'Save job as', label: 'name', initial: ui.job?.name, onSubmit: n => ui.saveAs(n) }) },
      { label: 'Reload from disk', onClick: ui.reload },
      'sep',
      { label: 'Import DXF / SVG…', onClick: () => fileInput.current?.click() },
      { label: 'Import 3D model (STL / OBJ)…', onClick: () => modelInput.current?.click() },
      { label: 'Import image as relief…', disabled: !ui.job, onClick: () => imageInput.current?.click() },
      { label: 'Export G-code (.nc)', disabled: !ui.derived?.toolpaths.some(t => t.moves.length), onClick: () => downloadGcode(ui) },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', shortcut: '⌘Z', disabled: !ui.canUndo, onClick: ui.undo },
      { label: 'Redo', shortcut: '⇧⌘Z', disabled: !ui.canRedo, onClick: ui.redo },
      'sep',
      { label: 'Add shape…', disabled: !ui.job, onClick: () => ui.openModal({ kind: 'addShape' }) },
      { label: 'Add text…', disabled: !ui.job, onClick: () => ui.openModal({ kind: 'text' }) },
      { label: 'Edit shape parameters', disabled: !ui.selectedShapes.length, onClick: () => openShapeParams(ui, ui.selectedShapes) },
      { label: 'Transform…', disabled: !ui.job?.shapes.length, onClick: () => ui.openModal({ kind: 'transform' }) },
      { label: 'Union', disabled: ui.selectedShapes.length < 2, onClick: () => booleanShapes(ui, 'union') },
      { label: 'Subtract (first − rest)', disabled: ui.selectedShapes.length < 2, onClick: () => booleanShapes(ui, 'subtract') },
      { label: 'Intersect', disabled: ui.selectedShapes.length < 2, onClick: () => booleanShapes(ui, 'intersect') },
      { label: 'Offset…', disabled: !ui.selectedShapes.length, onClick: () => ui.openModal({ kind: 'prompt', title: 'Offset selected shapes', label: 'mm', initial: '1', onSubmit: v => offsetShapes(ui, parseFloat(v)) }) },
      { label: 'Duplicate shapes', disabled: !ui.selectedShapes.length, onClick: () => duplicateShapes(ui) },
      { label: 'Delete shapes', disabled: !ui.selectedShapes.length, onClick: () => deleteShapes(ui) },
      'sep',
      { label: 'Select all', disabled: !ui.job, onClick: () => ui.setSelectedShapes(ui.job?.shapes.map(s => s.id) ?? []) },
      { label: 'Select none', onClick: () => ui.setSelectedShapes([]) },
    ] },
    { label: 'Paths', items: [
      { label: 'Add pocket', disabled: !ui.job, onClick: () => addOperation(ui, 'pocket') },
      { label: 'Add profile', disabled: !ui.job, onClick: () => addOperation(ui, 'profile') },
      { label: 'Add drill', disabled: !ui.job, onClick: () => addOperation(ui, 'drill') },
      { label: 'Add V-carve', disabled: !ui.job, onClick: () => addOperation(ui, 'vcarve') },
      { label: 'Add keyhole', disabled: !ui.job, onClick: () => addOperation(ui, 'keyhole') },
      { label: 'Add 3D rough', disabled: !ui.job?.models?.length, onClick: () => addOperation(ui, 'rough3d') },
      { label: 'Add 3D finish', disabled: !ui.job?.models?.length, onClick: () => addOperation(ui, 'finish3d') },
      'sep',
      { label: 'Tool library…', onClick: () => ui.openModal({ kind: 'tools' }) },
      { label: 'Sync job tools from library', disabled: !ui.job, onClick: () => syncToolsFromLibrary(ui, ui.library) },
    ] },
    { label: 'View', items: [
      { label: 'View cube', shortcut: 'Space', checked: ui.viewCube, onClick: () => ui.setViewCube(v => !v) },
      { label: 'Fit to stock', onClick: () => scene()?.fit() },
      { label: 'Orthographic', checked: ui.ortho, onClick: () => scene()?.setProjection(ui.ortho ? 'persp' : 'ortho') },
      'sep',
      { label: 'Top', onClick: () => scene()?.viewNamed('top') }, { label: 'Front', onClick: () => scene()?.viewNamed('front') }, { label: 'Right', onClick: () => scene()?.viewNamed('right') }, { label: 'Isometric', onClick: () => scene()?.viewNamed('iso') },
      'sep',
      { label: 'Toolpaths', checked: ui.showPaths, onClick: () => ui.setShowPaths(!ui.showPaths) },
      { label: 'Stock', checked: ui.showStock, onClick: () => ui.setShowStock(!ui.showStock) },
      { label: 'X-ray material', checked: ui.xray, onClick: () => ui.setXray(!ui.xray) },
      { label: 'Models', checked: ui.showModels, onClick: () => ui.setShowModels(!ui.showModels) },
      { label: 'Shapes', checked: ui.showShapes, onClick: () => ui.setShowShapes(!ui.showShapes) },
    ] },
    { label: 'Window', items: [
      ...Object.entries(PANELS).map(([id, label]) => ({ label, checked: !!api?.getPanel(id), onClick: () => api && showPanel(api, id) })),
      'sep' as const,
      { label: 'Float panel', submenu: Object.entries(PANELS).filter(([id]) => id !== 'viewport').map(([id, label]) => ({ label, disabled: !api?.getPanel(id), onClick: () => api && floatPanel(api, id) })) },
      'sep' as const,
      { label: 'Save layout…', onClick: () => ui.openModal({ kind: 'prompt', title: 'Save layout', label: 'name', onSubmit: n => { if (api) { saveLayout(api, n); setLayoutTick(x => x + 1); } } }) },
      ...(layouts.length ? [{ label: 'Layouts', submenu: layouts.map(n => ({ label: n, onClick: () => api && loadLayout(api, n) })) }, { label: 'Delete layout', submenu: layouts.map(n => ({ label: n, onClick: () => { deleteLayout(n); setLayoutTick(x => x + 1); } })) }] : []),
      { label: 'Reset layout', onClick: () => api && defaultLayout(api) },
    ] },
  ];
  void layoutTick;

  return (
    <div className="app">
      <MenuBar menus={menus} right={<span className="stat muted">{ui.error ? <span className="err">{ui.error} </span> : null}{ui.generating ? 'generating… ' : ''}{ui.saving ? 'saving…' : ui.job ? `${ui.job.name} · ${ui.file}` : 'no job'}</span>} />
      <input ref={fileInput} type="file" accept=".dxf,.svg" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) importFile(ui, f); e.target.value = ''; }} />
      <input ref={modelInput} type="file" accept=".stl,.obj" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) importModelFile(ui, f); e.target.value = ''; }} />
      <input ref={imageInput} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) ui.openModal({ kind: 'heightmap', file: f }); e.target.value = ''; }} />
      <div className="dock" onDragOver={e => e.preventDefault()} onDrop={async e => { const f = e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); if (f.name.endsWith('.json')) ui.setJob(JSON.parse(await f.text())); else if (/\.(stl|obj)$/i.test(f.name)) importModelFile(ui, f); else importFile(ui, f); }}>
        <DockviewReact components={components} tabComponents={tabComponents} onReady={onReady} theme={themeDark} getTabContextMenuItems={() => ['float', 'maximize', 'separator', 'close']} />
        {ui.modal?.kind === 'addShape' && <AddShapeModal />}
        {ui.modal?.kind === 'transform' && <TransformModal />}
        {ui.modal?.kind === 'tools' && <ToolLibraryModal />}
        {ui.modal?.kind === 'text' && <TextModal />}
        {ui.modal?.kind === 'heightmap' && <HeightmapModal file={ui.modal.file} />}
        {ui.modal?.kind === 'open' && <OpenJobModal />}
        {ui.modal?.kind === 'prompt' && <PromptModal title={ui.modal.title} label={ui.modal.label} initial={ui.modal.initial} onSubmit={ui.modal.onSubmit} />}
        {ui.modal?.kind === 'confirm' && <ConfirmModal title={ui.modal.title} message={ui.modal.message} onConfirm={ui.modal.onConfirm} />}
      </div>
      <Timeline />
    </div>
  );
}
