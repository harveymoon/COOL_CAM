import * as THREE from 'three';
import type { Tool } from '@cool-cam/core';
import { buildToolModel, disposeToolModel, addToolLights, toolSignature } from './toolGeometry';

/**
 * Renders library thumbnails with ONE shared offscreen WebGL renderer (browsers allow only a handful of contexts), cached by
 * the tool's geometric signature. Every thumbnail uses the same mm-per-pixel scale within a frame height, so a 1/16" bit
 * looks small next to a 1/4" and a 10 mm single flute looks big.
 */
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;
let failed = false;

function ensure(w: number, h: number) {
  if (failed) return null;
  if (!renderer) {
    try {
      const canvas = document.createElement('canvas');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      scene = new THREE.Scene(); addToolLights(scene);
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000); camera.up.set(0, 0, 1);
    } catch { failed = true; return null; }
  }
  renderer.setSize(w, h, false);
  return { renderer, scene: scene!, camera: camera! };
}

export function toolThumbnail(tool: Tool, w = 160, h = 240): string | null {
  const key = `${toolSignature(tool)}|${w}x${h}`;
  const hit = cache.get(key); if (hit) return hit;
  const ctx = ensure(w, h); if (!ctx) return null;
  const model = buildToolModel(tool);
  // frame: the tool axis vertical, seen from a low 3/4 angle; frame height covers the tool with a margin, never below 45 mm
  const frameH = Math.max(45, model.length * 1.12); const frameW = frameH * (w / h);
  const c = ctx.camera; c.left = -frameW / 2; c.right = frameW / 2; c.top = frameH / 2; c.bottom = -frameH / 2; c.updateProjectionMatrix();
  const mid = model.length / 2;
  c.position.set(180, -260, mid + 70); c.lookAt(0, 0, mid);
  ctx.scene.add(model.group);
  ctx.renderer.setClearColor(0x0d0f13, 1);
  ctx.renderer.render(ctx.scene, c);
  const url = ctx.renderer.domElement.toDataURL('image/png');
  ctx.scene.remove(model.group); disposeToolModel(model);
  cache.set(key, url);
  return url;
}
