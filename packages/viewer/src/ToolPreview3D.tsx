import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Tool } from '@cool-cam/core';
import { buildToolModel, disposeToolModel, addToolLights, toolSignature } from './toolGeometry';

/** Live, slowly rotating 3D view of one cutter (the tool being edited in the library). One WebGL context. */
export function ToolPreview3D({ tool, width = 150, height = 220 }: { tool: Tool; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sig = toolSignature(tool);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(width, height, false); renderer.setClearColor(0x0d0f13, 1);
    const scene = new THREE.Scene(); addToolLights(scene);
    const model = buildToolModel(tool); scene.add(model.group);
    const frameH = Math.max(40, model.length * 1.1); const frameW = frameH * (width / height);
    const cam = new THREE.OrthographicCamera(-frameW / 2, frameW / 2, frameH / 2, -frameH / 2, 0.1, 2000); cam.up.set(0, 0, 1);
    const mid = model.length / 2; cam.position.set(180, -260, mid + 60); cam.lookAt(0, 0, mid);
    let raf = 0; let t0 = performance.now();
    const loop = (now: number) => { model.group.rotation.z = ((now - t0) / 1000) * 0.6; renderer.render(scene, cam); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); disposeToolModel(model); renderer.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, width, height]);
  return <canvas ref={ref} width={width} height={height} style={{ width, height, display: 'block', background: '#0d0f13', border: '1px solid var(--border)' }} title={tool.name} />;
}
