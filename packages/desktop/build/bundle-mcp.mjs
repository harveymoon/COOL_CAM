// Bundles the MCP server (packages/mcp/dist) with all its dependencies into out/mcp/index.mjs so the packaged app can run it
// with the Electron binary as Node (ELECTRON_RUN_AS_NODE=1) without any node_modules.
import { build } from 'esbuild';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
await build({
  entryPoints: [path.resolve(here, '../../mcp/dist/index.js')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outfile: path.resolve(here, '../out/mcp/index.mjs'),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
console.log('bundled MCP server → out/mcp/index.mjs');
