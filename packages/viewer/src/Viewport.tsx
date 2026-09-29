import { useEffect, useRef, useState } from 'react';
import { SceneController } from './scene';
import { useUi } from './ui';
import { profileTabCenters, getTool, boundaryFor, translateParams } from '@cool-cam/core';

export function Viewport() {
  const ui = useUi();
  const mount = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cube, setCube] = useState(false);
  const uiRef = useRef(ui); uiRef.current = ui;

  useEffect(() => {
    const el = mount.current!;
    const sc = new SceneController(el);
    ui.sceneRef.current = sc;
    if (import.meta.env.DEV) (window as unknown as { __scene?: SceneController }).__scene = sc;
    sc.onPick = (id, multi) => ui.pickShape(id, multi);
    sc.onCubeHover = setHover;
    sc.onProjectionChange = o => ui.setOrtho(o);
    sc.onCubeChange = v => { ui.setViewCube(v); setCube(v); };
    sc.onPlaceTab = (x, y) => uiRef.current.setJob(j => ({ ...j, ops: j.ops.map(o => o.id === uiRef.current.activeOp && o.type === 'profile' ? { ...o, tabs: { ...(o.tabs ?? { count: 0, width: 6, height: 2 }), mode: 'manual', points: [...(o.tabs?.points ?? []), { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }] } } : o) }));
    sc.onRemoveTab = idx => uiRef.current.setJob(j => ({ ...j, ops: j.ops.map(o => o.id === uiRef.current.activeOp && o.type === 'profile' && o.tabs ? { ...o, tabs: { ...o.tabs, points: (o.tabs.points ?? []).filter((_, k) => k !== idx) } } : o) }));
    sc.onMoveShapes = (ids, dx, dy) => uiRef.current.setJob(j => ({ ...j, shapes: j.shapes.map(s => ids.includes(s.id) ? { ...s, polyline: { closed: s.polyline.closed, points: s.polyline.points.map(p => ({ x: Math.round((p.x + dx) * 1000) / 1000, y: Math.round((p.y + dy) * 1000) / 1000 })) }, params: s.params ? translateParams(s.params, dx, dy) : undefined } : s) }));
    ui.setSceneReady(v => v + 1);
    return () => { sc.dispose(); if (ui.sceneRef.current === sc) ui.sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sc = () => ui.sceneRef.current;
  useEffect(() => { sc()?.setJob(ui.job, ui.derived?.toolpaths ?? []); }, [ui.job, ui.derived, ui.sceneReady]);
  useEffect(() => { sc()?.setSelection(ui.selectedShapes); }, [ui.selectedShapes, ui.sceneReady]);
  useEffect(() => { sc()?.setSelectedModel(ui.selectedModel); }, [ui.selectedModel, ui.sceneReady, ui.job]);
  useEffect(() => { sc()?.setActiveOp(ui.activeOp); }, [ui.activeOp, ui.sceneReady]);
  useEffect(() => { sc()?.setProgress(ui.progress); }, [ui.progress, ui.sceneReady]);
  useEffect(() => { sc()?.setShowPaths(ui.showPaths); }, [ui.showPaths, ui.sceneReady]);
  useEffect(() => { sc()?.setShowStock(ui.showStock); }, [ui.showStock, ui.sceneReady]);
  useEffect(() => { sc()?.setShowModels(ui.showModels); }, [ui.showModels, ui.sceneReady, ui.job]);
  useEffect(() => { sc()?.setShowShapes(ui.showShapes); }, [ui.showShapes, ui.sceneReady, ui.job]);
  useEffect(() => { sc()?.setXray(ui.xray); }, [ui.xray, ui.sceneReady, ui.sim]);
  useEffect(() => { sc()?.setSimGrid(ui.sim); }, [ui.sim, ui.sceneReady]);
  useEffect(() => { sc()?.setHeights(ui.heights); }, [ui.heights, ui.sim, ui.sceneReady]);
  // project thumbnail: a little after each simulation result lands (so the cut stock is visible), capture the viewport
  useEffect(() => {
    if (!ui.sim || !ui.job || !ui.file) return;
    const t = window.setTimeout(() => { const url = sc()?.snapshot(); if (url) ui.saveThumbnail(url); }, 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.sim]);
  useEffect(() => { sc()?.setViewCube(ui.viewCube); setCube(ui.viewCube); }, [ui.viewCube, ui.sceneReady]);
  useEffect(() => { sc()?.setTabEdit(ui.tabEdit); }, [ui.tabEdit, ui.sceneReady]);
  // machining boundary outline for the active 3D op
  useEffect(() => {
    const s = sc(); if (!s) return;
    const op = ui.job?.ops.find(o => o.id === ui.activeOp);
    if (!ui.job || !op || (op.type !== 'rough3d' && op.type !== 'finish3d')) { s.setBoundaryOutline([], []); return; }
    try { const b = boundaryFor(ui.job, op, getTool(ui.job, op.toolId)); s.setBoundaryOutline(b.boundary.map(l => l.points), b.allowed.map(l => l.points)); }
    catch { s.setBoundaryOutline([], []); }
  }, [ui.job, ui.activeOp, ui.sceneReady]);
  // tab markers for the active profile op
  useEffect(() => {
    const s = sc(); if (!s) return;
    const op = ui.job?.ops.find(o => o.id === ui.activeOp);
    if (!ui.job || !op || op.type !== 'profile' || !op.tabs) { s.setTabMarkers([], 0, 0, 0, 0, false); return; }
    try { s.setTabMarkers(profileTabCenters(ui.job, op), op.tabs.width, op.tabs.height, op.depth, getTool(ui.job, op.toolId).diameter, op.tabs.mode === 'manual'); }
    catch { s.setTabMarkers([], 0, 0, 0, 0, false); }
  }, [ui.job, ui.activeOp, ui.sceneReady]);

  return (
    <div className="viewport" ref={mount}>
      <div className="view-tools" onMouseDown={e => e.stopPropagation()}>
        <button className={ui.showPaths ? 'on' : ''} onClick={() => ui.setShowPaths(!ui.showPaths)} title="toolpaths">paths</button>
        <button className={ui.showStock ? 'on' : ''} onClick={() => ui.setShowStock(!ui.showStock)} title="stock / simulated material">stock</button>
        <button className={ui.xray ? 'on' : ''} onClick={() => ui.setXray(!ui.xray)} title="translucent material" disabled={!ui.showStock}>x-ray</button>
        <button className={ui.showModels ? 'on' : ''} onClick={() => ui.setShowModels(!ui.showModels)} title="3D models" disabled={!ui.job?.models?.length}>models</button>
        <button className={ui.showShapes ? 'on' : ''} onClick={() => ui.setShowShapes(!ui.showShapes)} title="2D shapes">shapes</button>
        <span className="sep" />
        <button className={ui.ortho ? 'on' : ''} onClick={() => sc()?.setProjection(ui.ortho ? 'persp' : 'ortho')} title="orthographic / perspective">ortho</button>
        <button onClick={() => sc()?.fit()} title="fit to stock">fit</button>
        <button className={ui.viewCube ? 'on' : ''} onClick={() => ui.setViewCube(v => !v)} title="view cube (Space)">cube</button>
      </div>
      {cube && <div className="cube-hint">{hover ?? 'click a face, edge or corner · Esc to close'}</div>}
      {ui.tabEdit && !cube && <div className="cube-hint">placing tabs · click the contour to add · click a marker to remove · Esc to stop</div>}
      <div className="legend">
        <div><span style={{ background: '#5ec8ff' }} />cut <span style={{ background: '#ffb454', marginLeft: 8 }} />plunge <span style={{ background: '#c7a4ff', marginLeft: 8 }} />ramp <span style={{ background: '#ff5c5c', marginLeft: 8 }} />rapid</div>
        <div style={{ marginTop: 4 }}>drag · orbit &nbsp; right-drag · pan &nbsp; wheel · zoom &nbsp; click · select (shift adds) &nbsp; drag gizmo · move (shift snaps 1 mm) &nbsp; space · view cube</div>
      </div>
    </div>
  );
}
