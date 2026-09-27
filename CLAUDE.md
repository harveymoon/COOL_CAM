# Cool CAM — notes for Claude

- Monorepo with npm workspaces. Library packages (`core`, `post`, `sim`, `mcp`) compile with `tsc -b` to `dist/`; the viewer aliases them to `src/` so it needs no build.
- `npm test` runs vitest across `packages/*/test`. Keep tests passing; add one when you add an operation or importer feature.
- The MCP server (`packages/mcp`) must be rebuilt (`npm run build`) before Claude Code picks up changes; it is launched from `.mcp.json`.
- Coordinate/orientation conventions live in `packages/core/src/ops/profile.ts` and `pocket.ts` (Clipper returns outers CCW / holes CW; climb = material on the right).
- Safety-relevant code: `packages/post` (tool change + G53 moves) and `packages/sim` (rapid-into-stock, below-stock). Be conservative when changing them.
- Style: dark theme, no rounded corners anywhere in the viewer.
- Viewer edits save via `PUT /api/jobs/<file>` (Vite plugin in `packages/viewer/vite.config.ts`); the MCP server re-reads `jobs/current.json` when its mtime is newer than its own last write, so both sides stay in sync.
- Viewer structure: `ui.tsx` (context with job store, selection, sim, modals), `scene.ts` (all three.js, view cube, cameras), `actions.ts` (menu/panel actions), `panels/*` (dockview panels), `modals/*`, `layout.ts` (dockview layouts in localStorage). Dockview 8 via `dockview-react`.
- Tool library: `library/tools.json`, served by the Vite plugin at `/api/tools` and read by the MCP server (`COOL_CAM_LIBRARY` env overrides the path).
- 3D pipeline: `packages/core/src/mesh.ts` (heightmap rasteriser, drop-cutter offset surface, marching squares), `ops/surface.ts` (cached per model/tool/res), `ops/rough3d.ts` + `ops/finish3d.ts`. Safety margins: offset radius is enlarged by 0.71×res and roughing regions shrink by 0.5×res so interpolation between samples never lands inside a wall. `test/mesh.test.ts` has a gouge check against a fine heightmap; keep it passing.
- `geometry/polyline.ts#simplify` is Douglas–Peucker; the old local-collinearity version collapsed smooth loops.
- Feature extraction: `packages/core/src/features.ts` (`extractFeatures` groups upward-facing triangles by Z into planar levels via Clipper unions; `footprintAbove(z)` projects the mesh above a plane; `proposeOperations` builds level pockets from `domain − footprintAbove(z)`, rest passes, drills, 3D ops and a cutout). Test STL for it: `examples/stl/bracket-2p5d-12mm.stl`.
- 3D machining boundary: `ops/boundary.ts` (`boundaryFor` → boundary + tool-centre `allowed` polygons; `maskFromPolygons` rasterises it). `surface.ts` sizes the heightmap from `allowed` and exposes `offMasked` (used by finish3d); rough3d clips exact contours with `allowed` instead, for smooth rings. Defaults: silhouette, containment inside, offset 0; `proposeOperations` and the example jobs use containment outside + offset for a moat.
