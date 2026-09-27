import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';
import { DEFAULT_TOOLS, newJob } from '@cool-cam/core';
import type { Job, Tool } from '@cool-cam/core';
import { useJobStore, type Derived, type JobUpdater } from './store';
import { useSimulation, type SimGrid } from './useSimulation';
import type { SceneController } from './scene';
import type { DockviewApi } from 'dockview-react';

export type ModalState =
  | { kind: 'addShape' }
  | { kind: 'transform' }
  | { kind: 'tools' }
  | { kind: 'open' }
  | { kind: 'prompt'; title: string; label: string; initial?: string; onSubmit: (v: string) => void }
  | { kind: 'confirm'; title: string; message: string; onConfirm: () => void };

export interface Ui {
  files: { name: string; mtime: number }[]; file: string; setFile: (f: string) => void;
  job: Job | null; setJob: (u: JobUpdater | Job) => void; createJob: (name: string) => void; saveAs: (name: string) => void; reload: () => void;
  derived: Derived | null; error: string | null; saving: boolean;
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
}

const Ctx = createContext<Ui | null>(null);
export const useUi = () => { const u = useContext(Ctx); if (!u) throw new Error('UiProvider missing'); return u; };

export function UiProvider({ children }: { children: ReactNode }) {
  const store = useJobStore();
  const simState = useSimulation(store.job, store.derived);
  const [selectedShapes, setSelectedShapes] = useState<string[]>([]);
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
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
  const sceneRef = useRef<SceneController | null>(null);
  const dockRef = useRef<DockviewApi | null>(null);
  const [tabEdit, setTabEdit] = useState(false);

  useEffect(() => { fetch('/api/tools').then(r => r.json()).then((t: Tool[]) => { if (Array.isArray(t) && t.length) setLibrary(t); }).catch(() => {}); }, []);
  const saveLibrary = useCallback((tools: Tool[]) => { setLibrary(tools); fetch('/api/tools', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tools) }).catch(() => {}); }, []);

  // drop selection of shapes that no longer exist
  useEffect(() => { if (!store.job) return; const ids = new Set(store.job.shapes.map(s => s.id)); setSelectedShapes(s => s.every(id => ids.has(id)) ? s : s.filter(id => ids.has(id))); }, [store.job]);

  useEffect(() => { const op = store.job?.ops.find(o => o.id === activeOp); if (!op || op.type !== 'profile' || op.tabs?.mode !== 'manual') setTabEdit(false); }, [activeOp, store.job]);

  const pickShape = useCallback((id: string | null, multi: boolean) => {
    setSelectedShapes(prev => id === null ? (multi ? prev : []) : multi ? (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) : [id]);
  }, []);

  const createJob = useCallback((name: string) => { const j = newJob(name); j.tools = library.map(t => ({ ...t })); store.createJob(j); setSelectedShapes([]); setActiveOp(null); }, [library, store]);

  const value: Ui = useMemo(() => ({
    files: store.files, file: store.file, setFile: store.setFile, job: store.job, setJob: store.setJob, createJob, saveAs: store.saveAs, reload: store.reload,
    derived: store.derived, error: store.error, saving: store.saving,
    selectedShapes, setSelectedShapes, pickShape, activeOp, setActiveOp, selectedModel, setSelectedModel,
    ...simState,
    showPaths, setShowPaths, showStock, setShowStock, showModels, setShowModels, showShapes, setShowShapes, xray, setXray, viewCube, setViewCube, ortho, setOrtho, sceneRef, sceneReady, setSceneReady, dockRef, tabEdit, setTabEdit,
    modal, openModal: setModal, closeModal: () => setModal(null), library, saveLibrary,
  }), [store, simState, selectedShapes, pickShape, activeOp, selectedModel, showPaths, showStock, showModels, showShapes, xray, viewCube, ortho, sceneReady, modal, library, saveLibrary, createJob, tabEdit]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
