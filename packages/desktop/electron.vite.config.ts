import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { coolCamApi } from '../viewer/vite.config';

const viewer = path.resolve(__dirname, '../viewer');
const root = path.resolve(__dirname, '../..');

/**
 * Three builds: the Electron main process, its preload, and the renderer — which is the ordinary viewer package, unchanged.
 * In development the renderer runs on Vite with the same API middleware the browser dev loop uses; in production the main
 * process serves the built renderer and the API from one localhost server, so the renderer never learns which it is on.
 */
export default defineConfig({
  // main bundles the workspace packages (server, core/node) so the packaged app needs no node_modules at runtime;
  // 'electron' and node built-ins stay external
  main: { build: { rollupOptions: { input: path.resolve(__dirname, 'src/main/index.ts') } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: path.resolve(__dirname, 'src/preload/index.ts') } } },
  renderer: {
    root: viewer,
    plugins: [react(), coolCamApi()],
    resolve: { alias: { '@cool-cam/core': path.resolve(viewer, '../core/src/index.ts'), '@cool-cam/post': path.resolve(viewer, '../post/src/index.ts'), '@cool-cam/sim': path.resolve(viewer, '../sim/src/index.ts') } },
    optimizeDeps: { include: ['clipper-lib', 'opentype.js'] },
    worker: { format: 'es' },
    server: { fs: { allow: [root] } },
    build: { rollupOptions: { input: path.resolve(viewer, 'index.html') } },
  },
});
