import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createApi } from '../server/src/index';

const root = path.resolve(__dirname, '../..');

/**
 * Mounts the local API (packages/server) on Vite's dev server: jobs, tool library, fonts and the /api/events change feed.
 * The packaged app and the `cool-cam` CLI host the very same handlers, so the renderer is identical in all three.
 */
export function coolCamApi(): Plugin {
  return {
    name: 'cool-cam-api',
    configureServer(server) {
      const api = createApi({ jobsDir: process.env.COOL_CAM_JOBS_DIR ?? path.join(root, 'jobs'), bundledLibrary: path.join(root, 'library', 'tools.json'), fontDirs: [path.join(root, 'library', 'fonts')] });
      server.middlewares.use((req, res, next) => { if (!api.handle(req, res)) next(); });
      server.httpServer?.once('close', () => api.close());
    },
  };
}

export default defineConfig({
  plugins: [react(), coolCamApi()],
  resolve: {
    alias: {
      '@cool-cam/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@cool-cam/post': path.resolve(__dirname, '../post/src/index.ts'),
      '@cool-cam/sim': path.resolve(__dirname, '../sim/src/index.ts'),
    },
  },
  optimizeDeps: { include: ['clipper-lib', 'opentype.js'] },
  worker: { format: 'es' },
  server: { port: 5173, fs: { allow: [root] } },
});
