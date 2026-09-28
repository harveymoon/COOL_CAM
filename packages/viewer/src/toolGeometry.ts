import * as THREE from 'three';
import type { Tool } from '@cool-cam/core';

/**
 * A 3D cutter built from its library parameters: shank, fluted body with real helical flutes, and the tip geometry
 * (flat, ball, V cone at the included angle, drill point, keyhole head). Built once per tool and used both for the
 * library thumbnails / preview and for the tool shown in the simulation viewport.
 *
 * Coordinates: the tool axis is +Z, the tip is at the origin, the shank extends up to `length`. Units are mm.
 */
export interface ToolModel { group: THREE.Group; length: number; fluteLength: number; radius: number; signature: string }

export function toolSignature(t: Tool): string {
  return JSON.stringify([t.type, t.diameter, t.flutes, t.fluteLength, t.tipAngle, t.shankDiameter, t.overallLength, coatingOf(t), t.color]);
}

/** Coating guessed from the name/notes/sku: ZrN and TiN are gold, DLC/Spektra/AlTiN are near-black, otherwise bright carbide. */
function coatingOf(t: Tool): 'gold' | 'dark' | 'steel' {
  const s = `${t.name} ${t.notes ?? ''} ${t.sku ?? ''}`.toLowerCase();
  if (/zrn|tin\b|titanium nitride|gold/.test(s)) return 'gold';
  if (/dlc|spektra|altin|tialn|black|diamond/.test(s)) return 'dark';
  return 'steel';
}
const COAT = { gold: 0xd4b04a, dark: 0x3b4048, steel: 0xc3c9d3 } as const;

function bodyMaterial(t: Tool): THREE.MeshStandardMaterial {
  const c = coatingOf(t);
  // moderate metalness: without an environment map a fully metallic surface renders almost black
  return new THREE.MeshStandardMaterial({ color: t.color ? new THREE.Color(t.color) : COAT[c], metalness: c === 'dark' ? 0.3 : 0.45, roughness: c === 'dark' ? 0.5 : 0.35 });
}
const SHANK_MAT = () => new THREE.MeshStandardMaterial({ color: 0xa4abb7, metalness: 0.4, roughness: 0.45 });

/** Radius of the cutting body at height z above the tip (before flute grooves). */
function profileRadius(t: Tool, z: number, r: number, flute: number, neckR: number): number {
  const half = ((t.tipAngle ?? (t.type === 'drill' ? 118 : 90)) * Math.PI) / 360;
  switch (t.type) {
    case 'ballnose': return z < r ? Math.sqrt(Math.max(0, r * r - (r - z) * (r - z))) : r;
    case 'vbit': return Math.min(r, Math.max(0.02, z * Math.tan(half)));
    case 'drill': return Math.min(r, Math.max(0.02, z * Math.tan(half)));
    case 'keyhole': { const head = Math.min(flute * 0.45, Math.max(3, r * 1.2)); return z < head ? r : neckR; }
    default: return r;
  }
}

export function buildToolModel(t: Tool): ToolModel {
  const r = Math.max(0.15, t.diameter / 2);
  const d = t.diameter;
  const shankR = Math.max(0.3, (t.shankDiameter ?? (t.type === 'keyhole' ? d * 0.4 : Math.min(d, 6.35))) / 2);
  const half = ((t.tipAngle ?? (t.type === 'drill' ? 118 : 90)) * Math.PI) / 360;
  let flute = t.fluteLength ?? d * 3;
  if (t.type === 'vbit') flute = Math.max(flute, r / Math.tan(half) + Math.max(1, r * 0.3)); // the cone plus a short straight
  if (t.type === 'drill') flute = Math.max(flute, r / Math.tan(half) + 2);
  // ground neck between flutes and shank: a cone at ~30° from the axis wherever the two radii differ
  const topR = t.type === 'keyhole' ? Math.min(shankR * 0.9, r * 0.9) : r;
  const taperH = Math.abs(shankR - topR) > 0.05 ? Math.abs(shankR - topR) / Math.tan((30 * Math.PI) / 180) : 0;
  const length = Math.max(flute + taperH + 6, t.overallLength ?? flute + taperH + Math.max(25, d * 4));
  const shankLen = length - flute - taperH;
  const neckR = Math.min(shankR * 0.9, r * 0.9);
  const flutes = Math.max(1, Math.min(8, Math.round(t.flutes || 2)));
  // groove depth and helix: single flutes are deep (chip room), V-bits/drills shallower; helix ≈ 30° for endmills, straight for V-bits
  const grooveDepth = t.type === 'vbit' ? 0.22 : t.type === 'keyhole' ? 0.18 : flutes === 1 ? 0.42 : flutes === 2 ? 0.34 : 0.26;
  const helixPerMm = t.type === 'vbit' ? 0 : Math.tan((t.type === 'drill' ? 30 : 32) * Math.PI / 180) / r;
  const around = Math.max(36, Math.min(96, Math.round(r * 24)));
  const along = Math.max(40, Math.min(160, Math.round(flute * 3)));

  // body: parametric surface u around, v along the flute length, radius modulated by the flute grooves
  const pos: number[] = [], idx: number[] = [];
  const groove = (u: number, z: number) => { const a = flutes * (u * Math.PI * 2 + helixPerMm * z); const g = Math.max(0, Math.cos(a)); return 1 - grooveDepth * g * g; };
  for (let j = 0; j <= along; j++) {
    // denser sampling near the tip where the profile curves
    const v = Math.pow(j / along, 1.4); const z = v * flute;
    const R = profileRadius(t, z, r, flute, neckR);
    for (let i = 0; i <= around; i++) {
      const u = i / around; const th = u * Math.PI * 2;
      const rr = R * (R > r * 0.35 ? groove(u, z) : 1); // no grooves right at a pointed tip
      pos.push(rr * Math.cos(th), rr * Math.sin(th), z);
    }
  }
  const row = around + 1;
  for (let j = 0; j < along; j++) for (let i = 0; i < around; i++) {
    const a = j * row + i, b = a + 1, c = a + row, dd = c + 1;
    idx.push(a, b, dd, a, dd, c);
  }
  // caps: tip disc (flat endmills / keyhole heads) and the top disc that meets the shank
  const capFan = (z: number, R: number, up: boolean, mod: boolean) => {
    const centre = pos.length / 3; pos.push(0, 0, z);
    const start = pos.length / 3;
    for (let i = 0; i <= around; i++) { const u = i / around; const th = u * Math.PI * 2; const rr = R * (mod ? groove(u, z) : 1); pos.push(rr * Math.cos(th), rr * Math.sin(th), z); }
    for (let i = 0; i < around; i++) { const a = start + i, b = start + i + 1; if (up) idx.push(centre, a, b); else idx.push(centre, b, a); }
  };
  const R0 = profileRadius(t, 0, r, flute, neckR);
  if (R0 > r * 0.35) capFan(0, R0, false, true);
  capFan(flute, profileRadius(t, flute, r, flute, neckR), true, true);
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setIndex(idx); body.computeVertexNormals();

  const group = new THREE.Group();
  group.add(new THREE.Mesh(body, bodyMaterial(t)));
  if (taperH > 0) {
    // CylinderGeometry's radiusTop is at +Y; after rotating +Y onto +Z the top radius sits at the shank end
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(shankR, topR, taperH, 40, 1, false), SHANK_MAT());
    neck.rotation.x = Math.PI / 2; neck.position.z = flute + taperH / 2; group.add(neck);
  }
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(shankR, shankR, shankLen, 40, 1, false), SHANK_MAT());
  shank.rotation.x = Math.PI / 2; shank.position.z = flute + taperH + shankLen / 2; group.add(shank);
  // a short flat on the shank end reads as "where the collet grips"
  const collet = new THREE.Mesh(new THREE.CylinderGeometry(shankR * 1.02, shankR * 1.02, Math.min(8, shankLen * 0.3), 40), new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.6, roughness: 0.6 }));
  collet.rotation.x = Math.PI / 2; collet.position.z = length - Math.min(8, shankLen * 0.3) / 2; group.add(collet);
  group.userData.toolId = t.id;
  return { group, length, fluteLength: flute, radius: r, signature: toolSignature(t) };
}

export function disposeToolModel(m: ToolModel) {
  m.group.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); } });
}

/** Lights that make carbide read as metal: a key, a cool fill, and a rim from behind. */
export function addToolLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(60, -80, 120); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.6); fill.position.set(-80, -20, 40); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe0b0, 0.9); rim.position.set(30, 90, -20); scene.add(rim);
}
