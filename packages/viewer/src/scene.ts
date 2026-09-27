import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { stockBounds, getTool, bbox, placedMesh } from '@cool-cam/core';
import type { Job, Toolpath } from '@cool-cam/core';

export interface SimGridInfo { w: number; h: number; res: number; x0: number; y0: number; top: number; bottom: number }

const KIND_COLORS: Record<string, THREE.Color> = {
  rapid: new THREE.Color('#ff5c5c'), retract: new THREE.Color('#ff5c5c'), cut: new THREE.Color('#5ec8ff'), plunge: new THREE.Color('#ffb454'), ramp: new THREE.Color('#c7a4ff'),
};
const DIM = new THREE.Color('#2b3340');
const FOV = 40;
const CUBE_PX = 220;
const TEX_REPEAT_MM = 120;

interface Flat { x: number; y: number; z: number; kind: string; opId: string }
interface Anim { t0: number; dur: number; fromDir: THREE.Vector3; q: THREE.Quaternion; fromUp: THREE.Vector3; toUp: THREE.Vector3; dist: number; toOrtho: boolean }

const FACES: { name: string; n: THREE.Vector3; up: THREE.Vector3 }[] = [
  { name: 'TOP', n: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  { name: 'BOTTOM', n: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  { name: 'FRONT', n: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  { name: 'BACK', n: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1) },
  { name: 'RIGHT', n: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  { name: 'LEFT', n: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
];

function labelTexture(text: string, hot = false): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = hot ? 'rgba(94,200,255,0.9)' : 'rgba(52,58,72,0.92)'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = hot ? '#041018' : '#d7dae0'; g.font = 'bold 44px -apple-system, Inter, Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Deterministic pseudo-random for repeatable textures. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Procedural surface texture for the stock, keyed by job material. */
function stockTexture(material: string | undefined): THREE.CanvasTexture {
  const size = 512; const c = document.createElement('canvas'); c.width = size; c.height = size; const g = c.getContext('2d')!;
  const r = rng(7);
  const kind = material ?? 'none';
  const wood = ['softwood', 'hardwood', 'plywood'].includes(kind);
  const base: Record<string, string> = { softwood: '#d9b98a', hardwood: '#b8875a', plywood: '#d8b784', mdf: '#b79a72', acrylic: '#c7d5df', hdpe: '#dfe3e6', aluminum: '#b9bec4', brass: '#c9a84c', foam: '#c9d6ee', none: '#9aa1aa' };
  g.fillStyle = base[kind] ?? base.none; g.fillRect(0, 0, size, size);
  // everything below is drawn periodically so the tile repeats without a seam
  const wrapRect = (x: number, y: number, w: number, h: number, style: string) => { g.fillStyle = style; for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) g.fillRect(x + dx, y + dy, w, h); };
  if (wood) {
    // grain: wavy horizontal bands; frequencies are whole cycles per tile so both ends of a band meet
    for (let i = 0; i < 90; i++) {
      const y = r() * size; const amp = 4 + r() * 10; const cycles = 1 + Math.floor(r() * 4); const freq = (2 * Math.PI * cycles) / size; const cycles2 = cycles * 3; const width = 1 + r() * 3; const alpha = 0.05 + r() * 0.16; const phase = r() * Math.PI * 2;
      g.strokeStyle = `rgba(70,40,15,${alpha})`; g.lineWidth = width;
      for (const dy of [-size, 0, size]) {
        g.beginPath();
        for (let x = 0; x <= size; x += 4) { const yy = y + dy + Math.sin(x * freq + phase) * amp + Math.sin((x * freq * cycles2) / cycles + phase * 2) * amp * 0.3; if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy); }
        g.stroke();
      }
    }
    for (let i = 0; i < 6000; i++) wrapRect(r() * size, r() * size, 1 + r() * 2, 1, `rgba(0,0,0,${0.02 + r() * 0.05})`);
  } else if (kind === 'aluminum' || kind === 'brass') {
    // brushed: neutral light/dark streaks only
    for (let i = 0; i < 2400; i++) { const y = r() * size; const dark = r() > 0.5; g.strokeStyle = `rgba(${dark ? 0 : 255},${dark ? 0 : 255},${dark ? 0 : 255},${0.02 + r() * 0.05})`; g.lineWidth = 1; for (const dy of [-size, 0, size]) { g.beginPath(); g.moveTo(0, y + dy); g.lineTo(size, y + dy); g.stroke(); } }
  } else if (kind === 'mdf') {
    for (let i = 0; i < 20000; i++) { const dark = r() > 0.5; wrapRect(r() * size, r() * size, 1.5, 1.5, `rgba(${dark ? 40 : 255},${dark ? 30 : 240},${dark ? 20 : 220},${0.03 + r() * 0.06})`); }
  } else {
    for (let i = 0; i < 9000; i++) { const dark = r() > 0.5; wrapRect(r() * size, r() * size, 2, 2, `rgba(${dark ? 0 : 255},${dark ? 0 : 255},${dark ? 0 : 255},${0.02 + r() * 0.04})`); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/** Owns the WebGL renderer, cameras, controls, job geometry, stock mesh, the view cube, the move gizmo and camera animation. */
export class SceneController {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  onPick: (id: string | null, multi: boolean) => void = () => {};
  onCubeHover: (name: string | null) => void = () => {};
  onProjectionChange: (ortho: boolean) => void = () => {};
  onCubeChange: (visible: boolean) => void = () => {};
  /** Fired when the user finishes dragging the selection with the gizmo. */
  onMoveShapes: (ids: string[], dx: number, dy: number) => void = () => {};
  /** Tab placement mode: a click on the stock plane reports world XY; a click on a marker reports its index. */
  onPlaceTab: (x: number, y: number) => void = () => {};
  onRemoveTab: (index: number) => void = () => {};

  private el: HTMLElement;
  private jobGroup = new THREE.Group();
  private pathLines: THREE.LineSegments | null = null;
  private pathGeom: THREE.BufferGeometry | null = null;
  private baseColors: Float32Array | null = null;
  private flat: Flat[] = [];
  private toolMesh: THREE.Mesh | null = null;
  private stockMesh: THREE.Mesh | null = null;
  private simMesh: THREE.Mesh | null = null;
  private simGeom: THREE.BufferGeometry | null = null;
  private simInfo: SimGridInfo | null = null;
  private simIndexAll: Uint32Array | null = null;
  private spoilboard: THREE.Mesh | null = null;
  private skirt: THREE.Mesh | null = null;
  private skirtPerim: Int32Array | null = null;
  private simBottom: THREE.Mesh | null = null;
  private showModels = true; private showShapes = true; private xray = false;
  private shapeObjs: THREE.Object3D[] = [];
  private modelMeshes: THREE.Mesh[] = [];
  private modelEdges: THREE.LineSegments[] = [];
  private selectedModel: string | null = null;
  private job: Job | null = null;
  private toolpaths: Toolpath[] = [];
  private showPaths = true; private showStock = true;
  private progress = 0; private activeOp: string | null = null; private selected: string[] = [];
  private raf = 0; private ro: ResizeObserver; private anim: Anim | null = null;
  private down: [number, number] | null = null;
  private textures = new Map<string, THREE.CanvasTexture>();
  private tabGroup = new THREE.Group();
  private boundaryGroup = new THREE.Group();
  private tabMarkers: THREE.Mesh[] = [];
  private tabEdit = false;
  // gizmo
  private proxy = new THREE.Object3D();
  private tc: TransformControls;
  private dragStart: THREE.Vector3 | null = null;
  // view cube
  private cubeScene = new THREE.Scene();
  private cubeCam = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 100);
  private cubeGroup = new THREE.Group();
  private facets: THREE.Mesh[] = [];
  private cubeVisible = false;
  private cubeHot: THREE.Mesh | null = null;
  private mouse = { x: -1, y: -1 };

  constructor(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth || 1, el.clientHeight || 1);
    this.renderer.setClearColor(0x0d0f13);
    this.renderer.autoClear = false;
    el.appendChild(this.renderer.domElement);
    const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    this.persp = new THREE.PerspectiveCamera(FOV, aspect, 0.5, 8000); this.persp.up.set(0, 0, 1); this.persp.position.set(-120, -220, 180);
    this.ortho = new THREE.OrthographicCamera(-100 * aspect, 100 * aspect, 100, -100, -4000, 4000); this.ortho.up.set(0, 0, 1);
    this.camera = this.persp;
    this.controls = this.bindControls(this.persp);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(-200, -300, 500); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35); fill.position.set(300, 200, 200); this.scene.add(fill);
    const grid = new THREE.GridHelper(1000, 100, 0x2a2f3a, 0x1c2029); grid.rotation.x = Math.PI / 2; grid.position.z = -0.05; this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(30));
    this.scene.add(this.jobGroup); this.scene.add(this.tabGroup); this.scene.add(this.boundaryGroup);
    // move gizmo (translate in XY on the stock top)
    this.scene.add(this.proxy);
    this.tc = new TransformControls(this.persp, this.renderer.domElement);
    this.tc.showZ = false; this.tc.setSize(0.8); this.tc.setSpace('world');
    const helper = this.tc.getHelper(); helper.visible = false; this.scene.add(helper);
    this.tc.enabled = false;
    this.tc.addEventListener('dragging-changed', (e: { value: unknown }) => {
      const dragging = !!e.value; this.controls.enabled = !dragging;
      if (dragging) this.dragStart = this.proxy.position.clone();
      else if (this.dragStart) { const d = this.proxy.position.clone().sub(this.dragStart); this.dragStart = null; if (Math.hypot(d.x, d.y) > 1e-6) this.onMoveShapes(this.selected.slice(), d.x, d.y); else this.offsetSelected(0, 0); }
    });
    this.tc.addEventListener('objectChange', () => { if (!this.dragStart) return; const d = this.proxy.position.clone().sub(this.dragStart); this.offsetSelected(d.x, d.y); });
    this.buildViewCube();
    this.cubeCam.up.set(0, 0, 1);

    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el);
    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', this.onDown); dom.addEventListener('click', this.onClick); dom.addEventListener('mousemove', this.onMove); dom.addEventListener('mouseleave', () => { this.mouse.x = -1; });
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey);
    this.loop(0);
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose(); this.tc.dispose(); this.renderer.dispose();
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey);
    if (this.renderer.domElement.parentElement === this.el) this.el.removeChild(this.renderer.domElement);
  }

  private onKey = (e: KeyboardEvent) => { this.tc.setTranslationSnap(e.shiftKey ? 1 : null); };

  private bindControls(cam: THREE.Camera): OrbitControls {
    const target = this.controls?.target.clone();
    this.controls?.dispose();
    const c = new OrbitControls(cam, this.renderer.domElement);
    c.enableDamping = true; c.dampingFactor = 0.12;
    if (target) c.target.copy(target);
    this.controls = c;
    if (this.tc) this.tc.camera = cam;
    return c;
  }

  private resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.persp.aspect = aspect; this.persp.updateProjectionMatrix();
    const half = this.ortho.top; this.ortho.left = -half * aspect; this.ortho.right = half * aspect; this.ortho.updateProjectionMatrix();
  }

  private loop = (now: number) => {
    this.stepAnim(now);
    this.controls.update();
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, w, h); this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.cubeVisible) {
      const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
      this.cubeCam.position.copy(dir).multiplyScalar(5); this.cubeCam.up.copy(this.camera.up); this.cubeCam.lookAt(0, 0, 0);
      const x = Math.round((w - CUBE_PX) / 2), y = Math.round((h - CUBE_PX) / 2);
      this.renderer.setViewport(x, y, CUBE_PX, CUBE_PX); this.renderer.setScissor(x, y, CUBE_PX, CUBE_PX); this.renderer.setScissorTest(true);
      this.renderer.clearDepth();
      this.renderer.render(this.cubeScene, this.cubeCam);
      this.renderer.setScissorTest(false);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // ---------- picking ----------
  private onDown = (e: MouseEvent) => { this.down = [e.clientX, e.clientY]; };
  private onMove = (e: MouseEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (this.cubeVisible) this.updateCubeHover();
  };
  private onClick = (e: MouseEvent) => {
    const moved = this.down ? Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) : 0; this.down = null;
    if (moved > 4 || e.button !== 0) return;
    if (this.tc.axis || this.tc.dragging) return; // click landed on the gizmo
    if (this.cubeVisible) {
      if (this.cubeHot) { const d = (this.cubeHot.userData.dir as THREE.Vector3).clone(); this.setViewCube(false); this.viewDirection(d); }
      return;
    }
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.params.Line = { threshold: 1.2 }; ray.setFromCamera(ndc, this.camera);
    if (this.tabEdit && this.job) {
      const mh = ray.intersectObjects(this.tabMarkers, false)[0];
      if (mh) { this.onRemoveTab(mh.object.userData.index as number); return; }
      const top = stockBounds(this.job.stock).top;
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -top); const pt = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, pt)) this.onPlaceTab(pt.x, pt.y);
      return;
    }
    const hits = ray.intersectObjects(this.shapeObjs, false);
    let pick: string | null = null;
    if (hits.length) {
      const lineHit = hits.find(h => !h.object.userData.fill);
      if (lineHit) pick = lineHit.object.userData.shapeId as string;
      else { let best = Infinity; for (const h of hits) { const g = (h.object as THREE.Mesh).geometry; g.computeBoundingBox(); const bb = g.boundingBox!; const a = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y); if (a < best) { best = a; pick = h.object.userData.shapeId as string; } } }
    }
    this.onPick(pick, e.shiftKey || e.metaKey);
  };

  // ---------- view cube (chamfered: faces, edges and corners are all clickable) ----------
  private buildViewCube() {
    const h = 0.5, c = 0.16, a = h - c;
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const addFacet = (pts: THREE.Vector3[], dir: THREE.Vector3, label?: { name: string; up: THREE.Vector3 }) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const idx: number[] = []; for (let i = 1; i + 1 < pts.length; i++) idx.push(0, i, i + 1);
      geo.setIndex(idx); geo.computeVertexNormals();
      const n = new THREE.Vector3().fromArray(geo.getAttribute('normal').array as Float32Array, 0);
      if (n.dot(dir) < 0) { geo.setIndex(idx.slice().reverse()); geo.computeVertexNormals(); }
      const mat = new THREE.MeshBasicMaterial({ color: 0x2f3542, transparent: true, opacity: 0.92 });
      const m = new THREE.Mesh(geo, mat); m.userData.dir = dir.clone().normalize(); m.userData.kind = label ? 'face' : 'facet';
      this.cubeGroup.add(m); this.facets.push(m);
      // outline
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8a919e })); this.cubeGroup.add(line);
      if (label) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * a * 0.98, 2 * a * 0.98), new THREE.MeshBasicMaterial({ map: labelTexture(label.name), transparent: true, side: THREE.FrontSide, depthWrite: false }));
        const z = dir.clone(), y = label.up.clone(), x = new THREE.Vector3().crossVectors(y, z);
        plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); plane.position.copy(dir).multiplyScalar(h + 0.002);
        plane.userData.name = label.name; m.userData.label = plane; this.cubeGroup.add(plane);
      }
    };
    // faces
    for (const f of FACES) {
      const n = f.n; const i = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].indexOf(1); const s = n.x + n.y + n.z;
      const u = axes[(i + 1) % 3], v = axes[(i + 2) % 3];
      const base = axes[i].clone().multiplyScalar(s * h);
      addFacet([base.clone().addScaledVector(u, -a).addScaledVector(v, -a), base.clone().addScaledVector(u, a).addScaledVector(v, -a), base.clone().addScaledVector(u, a).addScaledVector(v, a), base.clone().addScaledVector(u, -a).addScaledVector(v, a)], n, { name: f.name, up: f.up });
    }
    // edges
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const k = 3 - i - j;
      for (const si of [-1, 1]) for (const sj of [-1, 1]) {
        const P = (ci: number, cj: number, ck: number) => axes[i].clone().multiplyScalar(ci).addScaledVector(axes[j], cj).addScaledVector(axes[k], ck);
        addFacet([P(si * h, sj * a, a), P(si * a, sj * h, a), P(si * a, sj * h, -a), P(si * h, sj * a, -a)], axes[i].clone().multiplyScalar(si).addScaledVector(axes[j], sj));
      }
    }
    // corners
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      addFacet([new THREE.Vector3(sx * h, sy * a, sz * a), new THREE.Vector3(sx * a, sy * h, sz * a), new THREE.Vector3(sx * a, sy * a, sz * h)], new THREE.Vector3(sx, sy, sz));
    }
    const ax = new THREE.AxesHelper(0.9); ax.position.set(-0.5, -0.5, -0.5); this.cubeGroup.add(ax);
    this.cubeScene.add(this.cubeGroup);
  }

  setViewCube(visible: boolean) {
    const changed = this.cubeVisible !== visible;
    this.cubeVisible = visible;
    if (!visible) { this.setCubeHot(null); }
    if (changed) this.onCubeChange(visible);
  }
  get viewCubeVisible() { return this.cubeVisible; }

  private updateCubeHover() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const x0 = (w - CUBE_PX) / 2, y0 = (h - CUBE_PX) / 2;
    const mx = this.mouse.x - x0, my = this.mouse.y - y0;
    if (mx < 0 || my < 0 || mx > CUBE_PX || my > CUBE_PX) { this.setCubeHot(null); return; }
    const ndc = new THREE.Vector2((mx / CUBE_PX) * 2 - 1, -(my / CUBE_PX) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.cubeCam);
    const hit = ray.intersectObjects(this.facets, false)[0];
    this.setCubeHot(hit ? (hit.object as THREE.Mesh) : null);
  }

  private setCubeHot(m: THREE.Mesh | null) {
    if (m === this.cubeHot) return;
    const style = (f: THREE.Mesh, hot: boolean) => {
      (f.material as THREE.MeshBasicMaterial).color.set(hot ? 0x5ec8ff : 0x2f3542);
      const label = f.userData.label as THREE.Mesh | undefined;
      if (label) { const lm = label.material as THREE.MeshBasicMaterial; lm.map?.dispose(); lm.map = labelTexture(label.userData.name as string, hot); lm.needsUpdate = true; }
    };
    if (this.cubeHot) style(this.cubeHot, false);
    this.cubeHot = m;
    if (m) style(m, true);
    const name = m ? FACES.filter(f => f.n.dot(m.userData.dir as THREE.Vector3) > 0.01).map(f => f.name).join(' · ') : null;
    this.onCubeHover(name);
  }

  // ---------- camera ----------
  viewDirection(dir: THREE.Vector3, toOrtho = true) {
    const d = dir.clone().normalize();
    const up = Math.abs(d.z) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const fromDir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    const dist = this.camera.position.distanceTo(this.controls.target) || 300;
    const q = new THREE.Quaternion().setFromUnitVectors(fromDir, d);
    this.anim = { t0: performance.now(), dur: 450, fromDir, q, fromUp: this.camera.up.clone(), toUp: up, dist, toOrtho };
  }
  viewNamed(name: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso') {
    const m: Record<string, [number, number, number]> = { top: [0, 0, 1], bottom: [0, 0, -1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], iso: [-1, -1, 1] };
    this.viewDirection(new THREE.Vector3(...m[name]), name !== 'iso');
  }
  private stepAnim(now: number) {
    const a = this.anim; if (!a) return;
    const t = Math.min(1, (now - a.t0) / a.dur); const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const qi = new THREE.Quaternion().slerp(a.q, e);
    const dir = a.fromDir.clone().applyQuaternion(qi).normalize();
    const up = a.fromUp.clone().lerp(a.toUp, e).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, a.dist);
    this.camera.up.copy(up); this.camera.lookAt(this.controls.target);
    if (t >= 1) { this.anim = null; this.setProjection(a.toOrtho ? 'ortho' : 'persp'); }
  }
  setProjection(mode: 'ortho' | 'persp') {
    const target = this.controls.target.clone();
    const dir = new THREE.Vector3().subVectors(this.camera.position, target).normalize();
    const up = this.camera.up.clone();
    if (mode === 'ortho' && this.camera !== this.ortho) {
      const dist = this.camera.position.distanceTo(target);
      const half = dist * Math.tan((FOV * Math.PI) / 360);
      const aspect = (this.el.clientWidth || 1) / (this.el.clientHeight || 1);
      this.ortho.top = half; this.ortho.bottom = -half; this.ortho.left = -half * aspect; this.ortho.right = half * aspect; this.ortho.zoom = 1; this.ortho.updateProjectionMatrix();
      this.ortho.position.copy(target).addScaledVector(dir, dist); this.ortho.up.copy(up); this.ortho.lookAt(target);
      this.camera = this.ortho; this.bindControls(this.ortho); this.onProjectionChange(true);
    } else if (mode === 'persp' && this.camera !== this.persp) {
      const half = this.ortho.top / this.ortho.zoom; const dist = half / Math.tan((FOV * Math.PI) / 360);
      this.persp.position.copy(target).addScaledVector(dir, dist); this.persp.up.copy(up); this.persp.lookAt(target);
      this.camera = this.persp; this.bindControls(this.persp); this.onProjectionChange(false);
    }
  }
  get isOrtho() { return this.camera === this.ortho; }
  /** World → canvas pixel coordinates (for tests and overlays). */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.el.clientWidth, y: ((1 - v.y) / 2) * this.el.clientHeight };
  }
  get gizmoPosition() { return this.proxy.position.clone(); }
  fit() {
    if (!this.job) return;
    const b = stockBounds(this.job.stock); const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; const span = Math.max(this.job.stock.width, this.job.stock.length);
    this.controls.target.set(cx, cy, b.top);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(-0.5, -0.8, 0.6).normalize();
    const dist = span * 1.6;
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    if (this.camera === this.ortho) { const half = dist * Math.tan((FOV * Math.PI) / 360); const aspect = (this.el.clientWidth || 1) / (this.el.clientHeight || 1); this.ortho.top = half; this.ortho.bottom = -half; this.ortho.left = -half * aspect; this.ortho.right = half * aspect; this.ortho.zoom = 1; this.ortho.updateProjectionMatrix(); }
    this.camera.lookAt(this.controls.target); this.controls.update();
  }

  // ---------- job geometry ----------
  private texture(): THREE.CanvasTexture {
    const key = this.job?.material ?? 'none';
    let t = this.textures.get(key); if (!t) { t = stockTexture(key); this.textures.set(key, t); }
    return t;
  }
  setJob(job: Job | null, toolpaths: Toolpath[]) {
    const first = this.job === null && job !== null;
    this.job = job; this.toolpaths = toolpaths;
    this.jobGroup.clear(); this.pathLines = null; this.pathGeom = null; this.toolMesh = null; this.stockMesh = null; this.flat = []; this.shapeObjs = [];
    if (this.simMesh) { this.jobGroup.add(this.simMesh); if (this.spoilboard) this.jobGroup.add(this.spoilboard); if (this.skirt) this.jobGroup.add(this.skirt); if (this.simBottom) this.jobGroup.add(this.simBottom); for (const m of [this.simMesh, this.skirt, this.simBottom]) if (m) { (m.material as THREE.MeshLambertMaterial).map = this.texture(); (m.material as THREE.MeshLambertMaterial).needsUpdate = true; } }
    if (!job) { this.updateGizmo(); return; }
    const b = stockBounds(job.stock);
    const box = new THREE.BoxGeometry(job.stock.width, job.stock.length, job.stock.thickness);
    this.stockMesh = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ map: this.texture(), transparent: true, opacity: 0.35, depthWrite: false }));
    this.stockMesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.top + b.bottom) / 2);
    this.stockMesh.visible = this.showStock && !this.simMesh;
    this.jobGroup.add(this.stockMesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x5a6270 })); edges.position.copy(this.stockMesh.position); this.jobGroup.add(edges);
    for (const s of job.shapes) {
      const pts = s.polyline.points.map(q => new THREE.Vector3(q.x, q.y, b.top + 0.05));
      if (s.polyline.closed && pts.length) pts.push(pts[0].clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      line.userData.shapeId = s.id; this.jobGroup.add(line); this.shapeObjs.push(line);
      if (s.polyline.closed && s.polyline.points.length >= 3) {
        const shape = new THREE.Shape(s.polyline.points.map(q => new THREE.Vector2(q.x, q.y)));
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
        fill.position.z = b.top + 0.04; fill.userData.shapeId = s.id; fill.userData.fill = true; this.jobGroup.add(fill); this.shapeObjs.push(fill);
      }
    }
    // 3D models: translucent target surface
    this.modelMeshes = []; this.modelEdges = [];
    for (const model of job.models ?? []) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(placedMesh(model).positions, 3)); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: model.id === this.selectedModel ? 0x5ec8ff : 0x8fb8d8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      mesh.userData.modelId = model.id; mesh.renderOrder = 1; this.jobGroup.add(mesh); this.modelMeshes.push(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.5 })); edges.visible = this.showModels; mesh.visible = this.showModels; this.jobGroup.add(edges); this.modelEdges.push(edges);
    }
    const pos: number[] = [], col: number[] = []; let prev = { x: 0, y: 0, z: b.top + job.safeZ };
    for (const tp of toolpaths) for (const m of tp.moves) {
      const c = KIND_COLORS[m.kind] ?? KIND_COLORS.cut;
      pos.push(prev.x, prev.y, prev.z, m.x, m.y, m.z); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      this.flat.push({ x: m.x, y: m.y, z: m.z, kind: m.kind, opId: tp.opId }); prev = m;
    }
    this.pathGeom = new THREE.BufferGeometry();
    this.pathGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.pathGeom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.baseColors = Float32Array.from(col);
    this.pathLines = new THREE.LineSegments(this.pathGeom, new THREE.LineBasicMaterial({ vertexColors: true })); this.jobGroup.add(this.pathLines);
    const dia = toolpaths[0] ? getTool(job, toolpaths[0].toolId).diameter : 6;
    this.toolMesh = new THREE.Mesh(new THREE.CylinderGeometry(dia / 2, dia / 2, 25, 24), new THREE.MeshLambertMaterial({ color: 0xffb454, transparent: true, opacity: 0.85 }));
    this.toolMesh.rotation.x = Math.PI / 2; this.jobGroup.add(this.toolMesh);
    this.applySelection(); this.applyActiveOp(); this.applyProgress(); this.updateGizmo(); this.setShowShapes(this.showShapes);
    if (first) this.fit();
  }
  setSelection(ids: string[]) { this.selected = ids; this.applySelection(); this.updateGizmo(); }
  setSelectedModel(id: string | null) { this.selectedModel = id; for (const m of this.modelMeshes) (m.material as THREE.MeshLambertMaterial).color.set(m.userData.modelId === id ? 0x5ec8ff : 0x8fb8d8); }
  private applySelection() {
    for (const o of this.shapeObjs) {
      const sel = this.selected.includes(o.userData.shapeId as string);
      if (o.userData.fill) { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = sel ? 0.28 : 0.06; continue; }
      const m = (o as THREE.Line).material as THREE.LineBasicMaterial; m.color.set(sel ? 0x5ec8ff : 0xffffff); m.opacity = sel ? 1 : 0.55; o.renderOrder = sel ? 2 : 0;
    }
  }
  /** Position the move gizmo at the centre of the selected shapes, or hide it. */
  private updateGizmo() {
    const helper = this.tc.getHelper();
    if (!this.job || !this.selected.length || this.dragStart) { if (!this.dragStart) { helper.visible = false; this.tc.enabled = false; this.tc.detach(); } return; }
    const shapes = this.job.shapes.filter(s => this.selected.includes(s.id));
    if (!shapes.length) { helper.visible = false; this.tc.enabled = false; this.tc.detach(); return; }
    const bb = bbox(shapes.map(s => s.polyline)); const b = stockBounds(this.job.stock);
    this.proxy.position.set((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, b.top + 0.1);
    this.tc.attach(this.proxy); this.tc.enabled = true; helper.visible = true;
  }
  /** Visually offset the selected shape objects while dragging (committed on mouse-up via onMoveShapes). */
  private offsetSelected(dx: number, dy: number) {
    for (const o of this.shapeObjs) if (this.selected.includes(o.userData.shapeId as string)) o.position.set(dx, dy, o.userData.fill ? (o.position.z || 0) : 0);
  }
  setActiveOp(id: string | null) { this.activeOp = id; this.applyActiveOp(); }
  /** Draw machining boundary (violet) and tool-centre region (dim violet) loops at the stock top. */
  setBoundaryOutline(boundary: { x: number; y: number }[][], allowed: { x: number; y: number }[][]) {
    this.boundaryGroup.clear();
    if (!this.job) return;
    const top = stockBounds(this.job.stock).top + 0.15;
    const add = (loops: { x: number; y: number }[][], color: number, opacity: number) => {
      for (const l of loops) { if (l.length < 2) continue; const pts = l.map(q => new THREE.Vector3(q.x, q.y, top)); pts.push(pts[0].clone()); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity })); line.renderOrder = 4; this.boundaryGroup.add(line); }
    };
    add(boundary, 0xc7a4ff, 1); add(allowed, 0xc7a4ff, 0.35);
  }
  setTabEdit(on: boolean) { this.tabEdit = on; this.renderer.domElement.style.cursor = on ? 'crosshair' : ''; if (on) { this.tc.enabled = false; this.tc.getHelper().visible = false; } else this.updateGizmo(); }
  /** Draw tab markers (centre, tangent angle) as small blocks at the bottom of the cut. */
  setTabMarkers(tabs: { x: number; y: number; angle: number }[], width: number, height: number, depth: number, toolDia: number, manual: boolean) {
    this.tabGroup.clear(); this.tabMarkers = [];
    if (!this.job) return;
    const top = stockBounds(this.job.stock).top;
    const zc = top - depth + height / 2;
    tabs.forEach((t, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(width, toolDia + 1.5, Math.max(height, 0.4)), new THREE.MeshLambertMaterial({ color: manual ? 0x5ec8ff : 0xffb454, transparent: true, opacity: 0.85 }));
      m.position.set(t.x, t.y, zc); m.rotation.z = t.angle; m.userData.index = i; m.renderOrder = 3;
      this.tabGroup.add(m); this.tabMarkers.push(m);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, top - zc + 6, 8), new THREE.MeshBasicMaterial({ color: manual ? 0x5ec8ff : 0xffb454 }));
      post.rotation.x = Math.PI / 2; post.position.set(t.x, t.y, (zc + top + 6) / 2); this.tabGroup.add(post);
    });
  }
  private applyActiveOp() {
    if (!this.pathGeom || !this.baseColors) return;
    const attr = this.pathGeom.getAttribute('color') as THREE.BufferAttribute; const arr = attr.array as Float32Array;
    for (let i = 0; i < this.flat.length; i++) { const dim = this.activeOp && this.flat[i].opId !== this.activeOp; for (let k = 0; k < 6; k++) arr[i * 6 + k] = dim ? [DIM.r, DIM.g, DIM.b][k % 3] : this.baseColors[i * 6 + k]; }
    attr.needsUpdate = true;
  }
  setProgress(p: number) { this.progress = p; this.applyProgress(); }
  setShowPaths(v: boolean) { this.showPaths = v; this.applyProgress(); }
  private applyProgress() {
    if (!this.pathGeom || !this.pathLines) return;
    const total = this.flat.length; const idx = Math.max(0, Math.min(total, this.progress)); const whole = Math.floor(idx);
    this.pathGeom.setDrawRange(0, this.showPaths ? whole * 2 : 0); this.pathLines.visible = this.showPaths;
    if (this.toolMesh && total && this.job) {
      const tgt = this.flat[Math.min(total - 1, whole)]; const prev = whole > 0 ? this.flat[whole - 1] : { x: 0, y: 0, z: this.flat[0].z }; const f = whole >= total ? 1 : idx - whole;
      this.toolMesh.position.set(prev.x + (tgt.x - prev.x) * f, prev.y + (tgt.y - prev.y) * f, prev.z + (tgt.z - prev.z) * f + 12.5);
      const tp = this.toolpaths.find(t => t.opId === tgt.opId);
      if (tp) { const d = getTool(this.job, tp.toolId).diameter; const s = d / ((this.toolMesh.geometry as THREE.CylinderGeometry).parameters.radiusTop * 2); this.toolMesh.scale.set(s, 1, s); }
    }
  }
  setShowStock(v: boolean) { this.showStock = v; for (const m of [this.simMesh, this.skirt, this.simBottom, this.spoilboard]) if (m) m.visible = v; if (this.stockMesh) this.stockMesh.visible = v && !this.simMesh; }
  /** Translucent material so toolpaths and the model show through the stock. */
  setXray(v: boolean) {
    this.xray = v;
    for (const m of [this.simMesh, this.skirt, this.simBottom, this.stockMesh]) {
      if (!m) continue; const mat = m.material as THREE.MeshLambertMaterial;
      const base = m === this.stockMesh ? 0.35 : 1;
      mat.transparent = v || m === this.stockMesh; mat.opacity = v ? Math.min(base, 0.3) : base; mat.depthWrite = !v && m !== this.stockMesh; mat.needsUpdate = true;
    }
  }
  setShowModels(v: boolean) { this.showModels = v; for (const m of this.modelMeshes) m.visible = v; for (const e of this.modelEdges) e.visible = v; }
  setShowShapes(v: boolean) { this.showShapes = v; for (const o of this.shapeObjs) o.visible = v; }
  setSimGrid(info: SimGridInfo | null) {
    if (this.simMesh) { this.jobGroup.remove(this.simMesh); this.simGeom?.dispose(); this.simMesh = null; this.simGeom = null; }
    this.simInfo = info;
    if (!info) { if (this.spoilboard) { this.jobGroup.remove(this.spoilboard); this.spoilboard = null; } if (this.skirt) { this.jobGroup.remove(this.skirt); this.skirt = null; } if (this.simBottom) { this.jobGroup.remove(this.simBottom); this.simBottom = null; } if (this.stockMesh) this.stockMesh.visible = this.showStock; return; }
    const { w, h, res, x0, y0 } = info;
    const positions = new Float32Array(w * h * 3), colors = new Float32Array(w * h * 3), uvs = new Float32Array(w * h * 2);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; positions[k * 3] = x0 + i * res; positions[k * 3 + 1] = y0 + j * res; positions[k * 3 + 2] = info.top;
      uvs[k * 2] = (i * res) / TEX_REPEAT_MM; uvs[k * 2 + 1] = (j * res) / TEX_REPEAT_MM;
      colors[k * 3] = colors[k * 3 + 1] = colors[k * 3 + 2] = 1;
    }
    const idx = new Uint32Array((w - 1) * (h - 1) * 6); let k = 0;
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i, b2 = a + 1, c = a + w, d = c + 1; idx[k++] = a; idx[k++] = b2; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = c; }
    this.simIndexAll = idx;
    this.simGeom = new THREE.BufferGeometry();
    this.simGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3)); this.simGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3)); this.simGeom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.simGeom.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    // spoilboard under the stock so through-cuts read as holes
    if (this.spoilboard) { this.jobGroup.remove(this.spoilboard); this.spoilboard = null; }
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(w * res + 40, h * res + 40), new THREE.MeshLambertMaterial({ color: 0x3a3126 }));
    sb.position.set(x0 + (w * res) / 2, y0 + (h * res) / 2, info.bottom - 0.3); this.jobGroup.add(sb); this.spoilboard = sb;
    // side skirt: perimeter of the heightmap down to the stock bottom, so the block keeps its sides once the sim takes over
    if (this.skirt) { this.jobGroup.remove(this.skirt); this.skirt.geometry.dispose(); this.skirt = null; }
    if (this.simBottom) { this.jobGroup.remove(this.simBottom); this.simBottom = null; }
    const perim: number[] = [];
    for (let i = 0; i < w; i++) perim.push(i);
    for (let j = 1; j < h; j++) perim.push(j * w + (w - 1));
    for (let i = w - 2; i >= 0; i--) perim.push((h - 1) * w + i);
    for (let j = h - 2; j >= 1; j--) perim.push(j * w);
    const N = perim.length; const sp = new Float32Array(N * 2 * 3), suv = new Float32Array(N * 2 * 2); const sidx: number[] = [];
    let along = 0;
    for (let k = 0; k < N; k++) {
      const vi = perim[k]; const x = positions[vi * 3], y = positions[vi * 3 + 1];
      if (k > 0) { const pv = perim[k - 1]; along += Math.hypot(x - positions[pv * 3], y - positions[pv * 3 + 1]); }
      sp[k * 6] = x; sp[k * 6 + 1] = y; sp[k * 6 + 2] = info.top; sp[k * 6 + 3] = x; sp[k * 6 + 4] = y; sp[k * 6 + 5] = info.bottom;
      suv[k * 4] = along / TEX_REPEAT_MM; suv[k * 4 + 1] = info.top / TEX_REPEAT_MM; suv[k * 4 + 2] = along / TEX_REPEAT_MM; suv[k * 4 + 3] = info.bottom / TEX_REPEAT_MM;
      const a = k * 2, b = ((k + 1) % N) * 2; sidx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('uv', new THREE.BufferAttribute(suv, 2)); sg.setIndex(sidx); sg.computeVertexNormals();
    this.skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: this.texture(), side: THREE.DoubleSide })); this.skirt.visible = this.showStock; this.jobGroup.add(this.skirt); this.skirtPerim = Int32Array.from(perim);
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry((w - 1) * res, (h - 1) * res), new THREE.MeshLambertMaterial({ map: this.texture(), side: THREE.DoubleSide }));
    bottom.position.set(x0 + ((w - 1) * res) / 2, y0 + ((h - 1) * res) / 2, info.bottom); bottom.visible = this.showStock; this.jobGroup.add(bottom); this.simBottom = bottom;
    if (this.xray) this.setXray(true);
    this.simMesh = new THREE.Mesh(this.simGeom, new THREE.MeshLambertMaterial({ map: this.texture(), vertexColors: true, side: THREE.DoubleSide })); this.simMesh.visible = this.showStock;
    this.jobGroup.add(this.simMesh); if (this.stockMesh) this.stockMesh.visible = false;
  }
  setHeights(heights: Float32Array | null) {
    if (!this.simGeom || !heights || !this.simInfo) return;
    const pos = this.simGeom.getAttribute('position') as THREE.BufferAttribute, col = this.simGeom.getAttribute('color') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array, ca = col.array as Float32Array;
    const top = this.simInfo.top, bottom = this.simInfo.bottom, range = Math.max(0.01, top - bottom);
    // vertex colour multiplies the material texture: uncut = white, cut floors take a warm tint that deepens with depth
    for (let i = 0; i < heights.length; i++) {
      const z = heights[i]; pa[i * 3 + 2] = z; const d = (top - z) / range;
      if (d <= 0.001) { ca[i * 3] = ca[i * 3 + 1] = ca[i * 3 + 2] = 1; }
      else { const f = Math.min(1, d); ca[i * 3] = 1.0; ca[i * 3 + 1] = 0.9 - 0.35 * f; ca[i * 3 + 2] = 0.8 - 0.5 * f; }
    }
    // hide floor triangles that are entirely at (or below) the stock bottom: a through-cut becomes a hole
    if (this.simIndexAll) {
      const all = this.simIndexAll; const out = this.simGeom.getIndex()!.array as Uint32Array; const floor = bottom + 1e-3; let n = 0;
      for (let t = 0; t < all.length; t += 3) {
        const a = all[t], b = all[t + 1], c = all[t + 2];
        if (heights[a] <= floor && heights[b] <= floor && heights[c] <= floor) continue;
        out[n++] = a; out[n++] = b; out[n++] = c;
      }
      this.simGeom.getIndex()!.needsUpdate = true; this.simGeom.setDrawRange(0, n);
    }
    pos.needsUpdate = true; col.needsUpdate = true; this.simGeom.computeVertexNormals();
    if (this.skirt && this.skirtPerim) {
      const sp = this.skirt.geometry.getAttribute('position') as THREE.BufferAttribute; const arr = sp.array as Float32Array;
      for (let k = 0; k < this.skirtPerim.length; k++) arr[k * 6 + 2] = Math.max(bottom, heights[this.skirtPerim[k]]);
      sp.needsUpdate = true;
    }
  }
}
