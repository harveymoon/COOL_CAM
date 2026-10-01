import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';
import { DEFAULT_TOOLS } from '@cool-cam/core';
import type { Job, Tool, MachineProfile } from '@cool-cam/core';
import { describeElement, type HelpInfo } from './help';
import { useJobStore, type Derived, type JobUpdater, type ProjectEntry } from './store';
import { useSimulation, type SimGrid } from './useSimulation';
import type { SceneController } from './scene';
import type { DockviewApi } from 'dockview-react';

export type ModalState =
  | { kind: 'addShape' }
  | { kind: 'transform' }
  | { kind: 'tools' }
  | { kind: 'machines' }
  | { kind: 'text' }
  | { kind: 'heightmap'; file: File }
  | { kind: 'open' }
  | { kind: 'prompt'; title: string; label: string; initial?: string; onSubmit: (v: string) => void }
  | { kind: 'confirm'; title: string; message: string; onConfirm: () => void };

export interface Ui {
  files: ProjectEntry[]; file: string | null;
  job: Job | null; setJob: (u: JobUpdater | Job) => void; createJob: (j: Job) => void; saveAs: (name: string) => void; reload: () => void;
  openProject: (f: string) => Promise<void>; closeProject: () => void; deleteProject: (f: string) => Promise<void>; saveThumbnail: (dataUrl: string) => Promise<void>; refreshList: () => Promise<void>;
  /** The MCP server switched to another job; the UI offers to open it. */
  mcpSwitched: { file: string; name: string } | null; dismissMcpSwitched: () => void;
  derived: Derived | null; error: string | null; saving: boolean;
  /** True while toolpaths are being regenerated on the worker (the shown toolpaths are the previous result). */
  generating: boolean;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  /** What the Parameters panel shows: the active operation or the selected shapes. */
  paramsMode: 'op' | 'shape'; setParamsMode: (m: 'op' | 'shape') => void;
  selectedShapes: string[]; setSelectedShapes: Dispatch<SetStateAction<string[]>>; pickShape: (id: string | null, multi: boolean) => void;
  activeOp: string | null; setActiveOp: (id: string | null) => void;
  selectedModel: string | null; setSelectedModel: (id: string | null) => void;
  sim: SimGrid | null; heights: Float32Array | null; simBusy: boolean;
  progress: number; setProgress: Dispatch<SetStateAction<number>>; playing: boolean; setPlaying: (v: boolean) => void; speed: number; setSpeed: (v: number) => void;
  total: number; opOffsets: number[]; seconds: number; totalSeconds: number; jumpTo: (i: number) => void;
  showPaths: boolean; setShowPaths: (v: boolean) => void; showStock: boolean; setShowStock: (v: boolean) => void;
  showModels: boolean; setShowModels: (v: boolean) => void; showShapes: boolean; setShowShapes: (v: boolean) => void;
  xray: boolean; setXray: (v: boolean) => void;
  viewCube: boolean; setViewCube: Dispatch<SetStateAction<boolean>>; ortho: boolean; setOrtho: (v: boolean) => void;
  sceneRef: MutableRefObject<SceneController | null>; sceneReady: number; setSceneReady: Dispatch<SetStateAction<number>>;
  dockRef: MutableRefObject<DockviewApi | null>;
  /** When true, clicks in the 3D view place/remove manual tabs on the active profile op. */
  tabEdit: boolean; setTabEdit: (v: boolean) => void;
  modal: ModalState | null; openModal: (m: ModalState) => void; closeModal: () => void;
  library: Tool[]; saveLibrary: (tools: Tool[]) => void;
  /** The user's own machine profiles (presets live in core). */
  machines: MachineProfile[]; saveMachines: (m: MachineProfile[]) => void;
  /** What the mouse is over, for the Help panel. */
  hover: HelpInfo | null;
  /** Font names available from the dev server (/api/fonts). */
  fonts: string[];
}

const Ctx = createContext<Ui | null>(null);
export const useUi = () => { const u = useContext(Ctx); if (!u) throw new Error('UiProvider missing'); return u; };

export function UiProvider({ children }: { children: ReactNode }) {
  const store = useJobStore();
  const simState = useSimulation(store.job, store.derived);
  const [selectedShapes, setSelectedShapes] = useState<string[]>([]);
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [paramsMode, setParamsMode] = useState<'op' | 'shape'>('op');
  const [showPaths, setShowPaths] = useState(true);
  const [showStock, setShowStock] = useState(true);
  const [showModels, setShowModels] = useState(true);
  const [showShapes, setShowShapes] = useState(true);
  const [xray, setXray] = useState(false);
  const [viewCube, setViewCube] = useState(false);
  const [ortho, setOrtho] = useState(false);
  const [sceneReady, setSceneReady] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [library, setLibrary] = useState<Tool[]>(DEFAULT_TOOLS);
  const [fonts, setFonts] = useState<string[]>([]);
  const sceneRef = useRef<SceneController | null>(null);
  const dockRef = useRef<DockviewApi | null>(null);
  const [tabEdit, setTabEdit] = useState(false);

  useEffect(() => { fetch('/api/fonts').then(r => r.json()).then((f: string[]) => Array.isArray(f) && setFonts(f)).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/tools').then(r => r.json()).then((t: Tool[]) => { if (Array.isArray(t) && t.length) setLibrary(t); }).catch(() => {}); }, []);
  const saveLibrary = useCallback((tools: Tool[]) => { setLibrary(tools); fetch('/api/tools', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tools) }).catch(() => {}); }, []);
  const [machines, setMachines] = useState<MachineProfile[]>([]);
  useEffect(() => { fetch('/api/machines').then(r => r.json()).then((m: MachineProfile[]) => { if (Array.isArray(m)) setMachines(m); }).catch(() => {}); }, []);
  const saveMachines = useCallback((m: MachineProfile[]) => { setMachines(m); fetch('/api/machines', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {}); }, []);
  // context help: track the element under the mouse (throttled to one update per frame; the help panel itself is ignored)
  // screenshots for the MCP server: the API broadcasts a `snapshot` event, the viewer renders the viewport and posts the JPEG back
  useEffect(() => {
    let es: EventSource | null = null;
    try { es = new EventSource('/api/events'); } catch { return; }
    es.addEventListener('snapshot', async (ev) => {
      let spec: { id: string; view?: string; fit?: boolean; maxWidth?: number; quality?: number };
      try { spec = JSON.parse((ev as MessageEvent).data); } catch { return; }
      const post = (body: BodyInit) => fetch(`/api/snapshot/${encodeURIComponent(spec.id)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body }).catch(() => {});
      const sc = sceneRef.current; if (!sc) { post(new Uint8Array(0)); return; }
      if (spec.view && spec.view !== 'current') sc.viewNamed(spec.view as 'top' | 'iso', true); // snap, no animation
      if (spec.fit) sc.fit();
      await new Promise(r => setTimeout(r, 60)); // let React/three apply the state before the explicit render in screenshot()
      const url = sc.screenshot(spec.maxWidth ?? 1280, spec.quality ?? 0.85);
      if (!url) { post(new Uint8Array(0)); return; }
      post(Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0)));
    });
    return () => es?.close();
  }, []);
  const [hover, setHover] = useState<HelpInfo | null>(null);
  useEffect(() => {
    // a timer, not requestAnimationFrame: frames stop when the window is hidden or behind another one
    let timer = 0; let pending: Element | null = null; let last: Element | null = null;
    const on = (e: MouseEvent) => { const t = e.target as Element | null; if (t === last) return; last = t; pending = t; if (timer) return; timer = window.setTimeout(() => { timer = 0; const info = describeElement(pending); if (info) setHover(info); }, 40); };
    document.addEventListener('mouseover', on); return () => { document.removeEventListener('mouseover', on); if (timer) window.clearTimeout(timer); };
  }, []);

  // drop selection of shapes that no longer exist
  useEffect(() => { if (!store.job) return; const ids = new Set(store.job.shapes.map(s => s.id)); setSelectedShapes(s => s.every(id => ids.has(id)) ? s : s.filter(id => ids.has(id))); }, [store.job]);

  useEffect(() => { const op = store.job?.ops.find(o => o.id === activeOp); if (!op || op.type !== 'profile' || op.tabs?.mode !== 'manual') setTabEdit(false); }, [activeOp, store.job]);

  const pickShape = useCallback((id: string | null, multi: boolean) => {
    setSelectedShapes(prev => id === null ? (multi ? prev : []) : multi ? (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) : [id]);
    if (id !== null) setParamsMode('shape');
  }, []);
  const setActiveOpAndMode = useCallback((id: string | null) => { setActiveOp(id); if (id) setParamsMode('op'); }, []);

  const createJob = useCallback((j: Job) => { if (!j.tools?.length) j.tools = library.map(t => ({ ...t })); store.createJob(j); setSelectedShapes([]); setActiveOp(null); }, [library, store]);

  const value: Ui = useMemo(() => ({
    files: store.files, file: store.file, job: store.job, setJob: store.setJob, createJob, saveAs: store.saveAs, reload: store.reload,
    openProject: store.openProject, closeProject: store.closeProject, deleteProject: store.deleteProject, saveThumbnail: store.saveThumbnail, refreshList: store.refreshList, mcpSwitched: store.mcpSwitched, dismissMcpSwitched: store.dismissMcpSwitched,
    derived: store.derived, generating: store.generating, error: store.error, saving: store.saving, undo: store.undo, redo: store.redo, canUndo: store.canUndo, canRedo: store.canRedo, paramsMode, setParamsMode,
    selectedShapes, setSelectedShapes, pickShape, activeOp, setActiveOp: setActiveOpAndMode, selectedModel, setSelectedModel,
    ...simState,
    showPaths, setShowPaths, showStock, setShowStock, showModels, setShowModels, showShapes, setShowShapes, xray, setXray, viewCube, setViewCube, ortho, setOrtho, sceneRef, sceneReady, setSceneReady, dockRef, tabEdit, setTabEdit,
    modal, openModal: setModal, closeModal: () => setModal(null), library, saveLibrary, machines, saveMachines, hover, fonts,
  }), [store, simState, selectedShapes, pickShape, activeOp, setActiveOpAndMode, selectedModel, paramsMode, showPaths, showStock, showModels, showShapes, xray, viewCube, ortho, sceneReady, modal, library, saveLibrary, machines, saveMachines, hover, createJob, tabEdit, fonts]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
