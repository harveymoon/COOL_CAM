# Cool CAM

MCP-enabled, open-source 2.5D CAM for a **Shapeoko HDM** (GRBL / Carbide Motion / BitSetter), built as a TypeScript monorepo so Claude can drive it directly.

```
packages/
  core/    geometry (Clipper offsets), DXF + SVG + STL/OBJ import, tool library, feeds & speeds,
           operations: pocket (helix/ramp/plunge entry, islands), profile (in/out/on, auto/manual tabs), drill (peck),
           3D rough (Z-level clearing of a mesh) and 3D finish (parallel raster) via heightmap drop-cutter
  post/    GRBL post for Carbide Motion: M6 T<n> tool changes for the BitSetter, G53 safe moves
  sim/     heightmap stock-removal simulator with collision / over-depth checks and scrubbable keyframes
  mcp/     MCP server (stdio) exposing the whole pipeline as tools
  viewer/  Vite + React + Three.js: 3D toolpaths, live stock simulation, timeline scrubber, G-code export
jobs/      job files written by the MCP server; the viewer watches this folder and reloads live
examples/  sample drawings
```

## Quick start

```bash
npm install
npm run build          # builds core, post, sim, mcp
npm test               # vitest
npm run dev            # viewer on http://localhost:5173
```

### Use it from Claude Code

`.mcp.json` in this folder registers the server, so opening Claude Code here gives it the `cool-cam` tools. Rebuild after changing the TypeScript (`npm run build`).

Typical conversation:

1. `new_job` — name, stock size, material
2. `import_geometry` (DXF/SVG) or `add_shape` (rect, circle, slot, polygon)
3. `feeds_and_speeds` — starting numbers for a tool + material
4. `add_operation` — pocket / profile / drill
5. `generate` → `simulate` → `export_gcode`

Every mutation is saved to `jobs/current.json`; keep the viewer open and it re-renders automatically.

### Use it from the viewer

The viewer is a full editor sharing the same job file with the MCP server (edits in either place show up in the other).

- **Menu bar**: File (new, open, save as, reload, import DXF/SVG, export G-code), Edit (add shape, transform, duplicate, delete, select), Paths (add pocket/profile/drill, tool library, sync tools), View (view cube, fit, orthographic, named views, toggles), Window (show/float panels, save/recall/reset layouts).
- **Panels** dock anywhere: drag a tab to any edge or into another group, right-click a tab to float or maximize it, or use Window → Float panel. The layout is remembered; Window → Save layout stores named layouts.
- **Job & Stock**: name, material, stock size/origin, clearances.
- **Shapes**: select in the list or by clicking in 3D (shift adds). Add shape and Transform open dialogs over the viewport.
- **Operations**: each op shows its tool, shapes, depth and feeds; Edit opens the **Edit operation** pane beside the viewport (dockable like any other panel) so you see the toolpaths and simulation change as you type. One-click material feeds. Reorder, enable/disable, duplicate, delete inline.
- **Tabs**: profile ops have an Auto/Manual switch. Auto spaces N tabs evenly. Manual seeds from the auto layout, then *Place tabs in 3D* lets you click the contour to add tabs and click a marker to remove one. Tab markers show in the viewport for both modes.
- **Output**: simulation verdict with clickable problem list, G-code download.
- **Tool library** (Paths menu): your cutters live in your application-data folder (macOS `~/Library/Application Support/Cool CAM/tools.json`, Windows `%APPDATA%\Cool CAM\tools.json`, Linux `~/.config/cool-cam/tools.json`), shared with the MCP server and used for new jobs. The repo's `library/tools.json` is the bundled default that seeds it the first time; *Add bundled defaults* brings it back after a clear. The grid view draws each cutter from its parameters (or shows the tool's `image`), so a bit is easy to spot; the list view is the compact alternative.
- **View cube**: press Space to show a SolidWorks-style chamfered cube over the model; faces, edge bevels, and corner bevels are all clickable and animate into that orthographic view (corners give 3/4 views). View → Orthographic toggles back to perspective.
- **Move gizmo**: selecting shapes shows a translate handle in 3D; drag the X/Y arrows or the square for free XY moves. Hold Shift to snap to 1 mm. The move commits on release and regenerates toolpaths.
- **Stock texture**: the simulated stock is textured by material (wood grain, brushed metal, MDF speckle, plastics); cut floors tint warmer with depth so pockets read against the grain. Through-cuts open real holes onto a dark spoilboard drawn under the stock.
- Timeline: scrub or play the cut; clicking an operation jumps to the end of that operation.

### Lettering, V-carve, keyhole, relief images

- **Text**: Edit → Add text (or `add_text` / `list_fonts` over MCP) outlines a string with any TTF/OTF on this Mac into closed shapes; counters become holes. Text shapes stay editable in the Parameters panel (string, font, size, position, alignment, spacing).
- **V-carve**: a V-bit follows successive inward offsets of a region, tip depth = offset / tan(half angle), so the groove walls sit exactly on the outline. Depth cap optional; with a *flat clearing* endmill the wide areas are pocketed flat at the cap first (advanced V-carve), emitted as a separate toolpath for that tool.
- **Keyhole**: plunge, slide the slot length at the given angle, return, retract. Add a `keyhole` tool (head + shank diameter) in the tool library.
- **Contour ramp**: profiles can enter with a ramp along the contour instead of a plunge (never through a tab).
- **Rest machining**: a pocket with *rest of* set to a larger tool only cuts what that tool could not reach.
- **Image → relief**: File → Import image as relief (or `import_heightmap_image`) turns a PNG/JPEG into a solid relief model (white = high), ready for 3D rough/finish.
- **Arcs**: the post fits G2/G3 arcs over circular runs (0.01 mm tolerance), typically shrinking files 3× on round parts. `arcs: false` disables it.

### Editing

The **Parameters** panel shows either the active operation or the selected shapes. Shape mode has absolute position (min corner and centre), size, primitive parameters for rectangles, circles, polygons, slots and text, relative transforms, mirror, offset, and booleans (union, subtract, intersect). Undo/redo is ⌘Z / ⇧⌘Z. The timeline shows one segment per operation coloured by tool, with tool-change ticks and hover details; click a segment to jump to the end of that operation.

### 3D models

Import an STL or OBJ (File → Import 3D model, the Models panel, or `import_model` over MCP). The model is centred on the stock with its top at Z0; the Models panel has placement fields and snap buttons (centre, corner, top at Z0, bottom on bed, × 25.4 for inch files, fit stock). Then:

- **3D Rough**: slices the tool-offset surface every `stepdown` and clears each layer with the pocket engine (helix entry, climb). Leaves `stockToLeave` (default 0.3 mm). Use a flat endmill.
- **3D Finish**: zig-zag raster along X or Y, tool tip following the offset surface; skips air. Use a ball nose with a small stepover (10 % of diameter is a good start).

Both derive from a heightmap of the placed mesh, so the workflow is strictly 3-axis (no undercuts), which matches the machine.

**Machining boundary** (both 3D ops, "Machining boundary" section in the editor): choose the model *silhouette* (default), its *bounding box*, the *whole stock*, or *selected shapes* you drew; apply an *offset*; and pick *containment*: tool inside the boundary (default), centre on it, or tool outside. *Avoid shapes* subtract regions, and *skip above depth* is a Z window that leaves shallow surface alone. With the defaults a 3D pass touches only what is inside the model outline, so a coaster's rim is left for a tabbed profile and an engraving model's square blank never gets cut. Use containment *outside* with an offset when you want the classic moat around a free-standing carving. The boundary draws in violet in the viewport while the op is selected.

**Propose operations** (Models panel button, or `propose_operations` over MCP) analyses the mesh instead of treating it as a blob: upward-facing planar faces become exact 2.5D pocket regions at their height (largest endmill that fits, plus a rest pass with a smaller one for corners), through-holes that match a tool diameter become drills, curved faces trigger 3D rough + finish, and a part sitting on the bed gets a tabbed cutout. The proposal is appended as ordinary shapes and operations you can edit. `examples/stl/bracket-2p5d-12mm.stl` (from `examples/gen-bracket-stl.mjs`) is a plate with a pocket, a step, a counterbore and two holes for trying it. `examples/stl` holds four watertight test parts under 12 mm tall generated by `node examples/gen-test-stl.mjs`: a 2" spherical cap, a 2" face-up dodecahedron slice, a square frustum, and a coaster with a faceted star recess. Model geometry is embedded in the job file, so jobs with big meshes are a few MB. `node examples/make-example-jobs.mjs` rebuilds the example jobs for the cutters in *your* tool library, picking a 1/4" flat, a 1/8" two-flute flat, a 1/8" ball and a 60° V-bit by role (a labelled placeholder stands in for a V-bit you do not own yet).

## Conventions

- Units: mm. X0/Y0 at the stock's front-left corner by default, Z0 at stock top (BitSetter workflow).
- Depths are positive numbers below the stock top.
- Climb milling by default (material on the right of travel with a clockwise spindle).
- The post emits `M6 T<n>` before every tool including the first so Carbide Motion prompts and probes the BitSetter. Use `toolChange: "m0-pause"` for gSender/CNCjs.
- Machine numbers in `packages/core/src/machine.ts` (rapids, accel) only affect time estimates; check them against your GRBL `$` settings.

## Roadmap

- Adaptive / trochoidal clearing (constant engagement)
- V-carve (medial axis) and engraving of text
- STEP import (exact B-rep) and true rest machining from the simulated stock
- Waterline finishing, pencil/corner passes, two-sided setups
- Rest machining between tools
- Lead-in/out arcs, G2/G3 arc output, arc fitting
- Editable operations in the viewer, feed override, and sending to the machine
