# Cool CAM — session summary (2026-09-27/28)

What this session produced, from an empty folder to a working CAM package.

**What it is.** An open-source, MCP-controllable CAM for a Shapeoko HDM, written as a TypeScript monorepo with a dockable Three.js viewer. Two commits so far, 43 tests passing, remote set to `github.com/harveymoon/COOL_CAM`.

## Research and decision
Surveyed the open-source CAM landscape (Kiri:Moto, FreeCAD CAM, Fabex, OpenCAMLib, CAMotics, DerpCAM, ivaCAM, jscut) and chose to build fresh in TypeScript on Clipper for licensing and hackability, borrowing approaches rather than code.

## Core engine (`packages/core`)
- **Importers**: DXF, SVG, STL, OBJ, PNG/JPEG reliefs, and text from any system font.
- **2.5D ops**: pocket with islands, helix/ramp/plunge entry, finish pass, and rest machining; profile inside/outside/on with auto or manually placed tabs and ramp entry; peck drilling; keyhole slots; V-carve with depth cap and advanced flat clearing.
- **3D ops**: heightmap drop-cutter roughing in Z layers and parallel finishing, with machining boundaries (silhouette, bbox, stock, drawn shapes), containment, avoid regions, and a Z window. Verified gouge-free against a fine model heightmap.
- **Feature extraction**: planar levels, through-holes, and curved areas detected from a mesh, then turned into exact pockets, drills, 3D passes, and a tabbed cutout.
- Shape booleans, offsets, parametric primitives, feeds-and-speeds table, HDM machine profile, tool library.

## Post, simulation, MCP
- **GRBL post** for Carbide Motion: `M6` tool changes for the BitSetter, `G53` safe moves, split rapids, and G2/G3 arc fitting.
- **Stock simulator**: heightmap with keyframes for scrubbing; flags rapids through stock, cuts below stock, and deep plunges.
- **MCP server** with about 25 tools covering the whole pipeline, sharing the job file and tool library with the viewer in both directions.

## Viewer (`packages/viewer`)
Dark, square-cornered, dockable UI with saved layouts, menu bar, and modals. Textured stock with sides and bottom, through-cut holes, x-ray mode, depth shading. View cube on Space with chamfered corners and animated orthographic views. Move gizmo, click-to-select, tab placement in 3D. Parameters panel for operations and for shape geometry with absolute positioning. Timeline with per-operation segments and tool-change ticks. Undo/redo. Tool library editor.

## Test assets and examples
Four generated watertight STLs (dome cap, dodecahedron slice, frustum, star coaster) and a 2.5D bracket, each with a ready example job, plus a V-carved sign. All simulate clean. Regenerate with `node examples/gen-test-stl.mjs`, `node examples/gen-bracket-stl.mjs`, `node examples/make-example-jobs.mjs`.

## Open items
- Push to GitHub needs credentials once: `git push -u origin main`.
- Nothing has run on the machine yet; a first air-cut with Carbide Motion is the next real validation (confirm the `M6` prompt + BitSetter probe, `G53` safe moves, and feeds).
- Known gaps: waterline finishing, drawing tools, two-sided setups, image trace, generation on a worker, and meshes embedded in job files.

## Suggested next steps
1. Commit/push, reconnect the MCP server (`/mcp`).
2. Air-cut the sign or coaster example.
3. Toolpath generation in a worker with cancellation; waterline + pencil finishing.
4. Drawing tools and node editing; arrays.
5. Two-sided setups; image trace; sidecar model storage; send-to-machine.
