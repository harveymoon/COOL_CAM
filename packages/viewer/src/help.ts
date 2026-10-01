/**
 * Context help: what the element under the mouse does. `describeElement` reads the label, the tooltip (`title`) and a
 * curated explanation keyed by the label text, so every field with a hint gets help for free and the important ones get a
 * paragraph. Shown by the Help panel.
 */
export interface HelpInfo { label: string; hint?: string; body?: string; kind: 'field' | 'button' | 'item' | 'tab' | 'other' }

const norm = (s: string) => s.toLowerCase().replace(/[…:]/g, '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+(mm|°|mm\/min)$/, '').replace(/\s+/g, ' ').trim();

const H: Record<string, string> = {
  // job & stock
  'name': 'Project name. It becomes the file name in the jobs folder and the G-code file name.',
  'material': 'Material of the stock. Drives the feeds-and-speeds suggestions (Suggest feeds in each operation) and the stock texture in the simulation.',
  'machine': 'The machine profile the job runs on: travel limits, max feeds, rapids and acceleration for time estimates, spindle range, tool-change style (M6 prompt or M0 pause) and the safe machine Z. Window → Machines… edits presets and your own.',
  'width x': 'Stock size along X, mm.', 'length y': 'Stock size along Y, mm.', 'thick z': 'Stock thickness, mm. Depths are measured from the stock top.',
  'xy origin': 'Which corner of the stock is X0/Y0 on the machine. Front-left is the Carbide Motion default.',
  'z0 at': 'Where Z0 is: the stock top (BitSetter workflow, recommended) or the stock bottom (Z0 on the spoilboard, used with a spoilboard allowance for through-cuts and mitres).',
  'safe z': 'Height above Z0 for rapid moves between operations. Clear every clamp.',
  'clearance z': 'Retract height inside an operation (between passes and links). Lower than safe Z to save time.',
  'spoilboard allowance': 'How far below the stock bottom cutting is allowed, mm. Planners floor there, the simulator treats the spoilboard as material and only reports a problem beyond it. Use it for through-cuts into a sacrificial board and for mitres finished through the face.',
  'paths': 'Imported 3D tool-tip paths (File → Import tool paths). A Trace operation follows them.',
  // operation basics
  'tool': 'The cutter for this operation, from the job tools. Add more from the tool library (Tools button).',
  'rpm': 'Spindle speed. Blank falls back to the tool default; outside the machine range you get a warning.',
  'feed': 'Cutting feed, mm/min. Blank uses the tool default. Feeds above the machine maximum are flagged (GRBL would clamp them).',
  'plunge': 'Feed for downward plunges, mm/min. Usually 25–40 % of the cutting feed.',
  'depth': 'Total depth below the stock top, mm. Deeper than the stock (plus the spoilboard allowance) means hitting the wasteboard.',
  'max depth': 'The 3D operation stops at this depth below the stock top even if the model goes deeper.',
  'per pass': 'Depth of each pass, mm. The operation repeats until it reaches the total depth. The simulator checks that no pass meets more material than this.',
  'stepdown': 'Z-level spacing for 3D roughing, mm. Each level is cleared like a pocket. Also the planned engagement the simulator checks.',
  'start depth': 'Depth where the first pass begins (0 = stock top). Use it to continue a cut or to skip material already removed.',
  'stepover': 'Sideways distance between passes, mm. Pockets: 40 % of the diameter is a good default; 3D finish with a ball nose: 10 % of the diameter for a fine surface; smaller is smoother and slower.',
  'stepover mm': 'Sideways distance between passes, mm.',
  'direction': 'Climb (material on the right of travel, cleaner finish, default) or conventional (material on the left).',
  'entry': 'How the cutter enters the material: plunge straight down, helix (spiral down inside the pocket; needs room), or ramp (slide down along the contour). Helix and ramp are much kinder to the cutter.',
  'side': 'Which side of the contour the cutter runs on: outside (cutting a part out), inside (a hole or window) or on the line (engraving the line itself).',
  'stock to leave': 'Material left on the walls or surface for a later finishing pass, mm.',
  'rest of': 'Rest machining: this pocket only cuts what the chosen larger tool could not reach (corners and narrow slots).',
  'offset': 'Distance to grow (positive) or shrink (negative) the shape, mm.',
  'offset mm': 'Creates new shapes offset from the selected ones by this distance (positive grows, negative shrinks).',
  // tabs
  'tabs': 'Small bridges left uncut on a profile so the part does not come loose before the end. Auto spaces them evenly; Manual lets you place them in 3D.',
  'count': 'Number of tabs spread evenly around the contour.', 'width': 'Tab width along the contour, mm (shape mode: the shape width).', 'height': 'Tab height above the cut floor, mm (shape mode: the shape height).',
  // 3D
  'model': 'The 3D model this operation machines (Models panel).',
  'resolution': 'Heightmap cell size, mm. Smaller is more accurate and slower. Blank picks a size from the stepover.',
  'along': 'Raster direction of the finishing passes. Run them across the longest features; use a second operation in the other axis for walls parallel to the first.',
  'finish base floor': 'Also raster the flat floor around the model at its base. Normally roughing leaves that flat already.',
  'boundary': 'Region the tool may machine: the model silhouette, its bounding box, the whole stock, or shapes you drew.',
  'containment': 'Whether the whole tool stays inside the boundary, its centre runs on it, or the tool may reach outside it (to clear a moat around the model).',
  'offset mm boundary': 'Grow the boundary by this much.',
  'skip above depth': 'Cells whose finished surface is above this depth are left alone (useful to re-run only the deep parts).',
  // trace
  'mode': 'Tip as given: the paths are run exactly as imported and, with a model selected, checked against it with exact ball-to-surface distance. Project: Z is taken from the drop-cutter surface of the model (shallow surfaces only; too conservative on steep walls).',
  'verify against': 'Model to check the imported paths against. Gouges deeper than 0.02 mm are reported in the operation warnings before anything is exported.',
  'depth offset': 'Added to every Z of the imported paths, mm. Negative cuts deeper.',
  'planned engagement': 'How much material a pass is expected to meet, mm. The simulator flags cuts that meet more than this, so set it to what the external paths really take per pass.',
  // v-carve, keyhole, drill
  'depth cap': 'Maximum tip depth for the V-bit. 0 = no cap (full V). Wide areas with a cap get a flat floor; add a flat-clearing endmill to pocket them.',
  'flat clearing': 'Endmill that clears the wide flat areas at the cap depth before the V-bit (advanced V-carve). Emitted as a separate toolpath.',
  'peck': 'Peck drilling: retract every this many mm to clear chips. 0 drills in one plunge.', 'dwell': 'Pause at the bottom of the hole, seconds.',
  'length': 'Keyhole slot length, mm.', 'angle': 'Keyhole slot direction, degrees (90 = towards +Y).',
  // shapes
  'center x': 'Centre of the selection along X. Editing it moves the shapes.', 'center y': 'Centre of the selection along Y.',
  'corner r': 'Rounded corner radius of the rectangle, mm.', 'sides': 'Number of polygon sides.', 'diameter': 'Diameter, mm.', 'rot': 'Rotation, degrees.',
  'x1': 'First slot centre X.', 'y1': 'First slot centre Y.', 'x2': 'Second slot centre X.', 'y2': 'Second slot centre Y.',
  // tools
  't number': 'Tool number used in the G-code (M6 T<n>). Keep them unique.', 'id': 'Short unique id used by operations and the MCP server.',
  'type': 'Cutter type: endmill (flat), ball nose, V-bit, drill, keyhole. Decides the tip geometry for 3D work and the simulation.',
  'flutes': 'Number of cutting edges. Feed = chip load × flutes × rpm, so more flutes allow faster feeds.',
  'flute len': 'Length of the cutting edges, mm. Cutting deeper than this rubs the shank: the simulator reports shank contact.',
  'tip angle': 'Included angle of a V-bit, degrees (60 or 90 are common).',
  'shank ø': 'Shank diameter, mm. Decides the collet and how the cutter is drawn.', 'overall len': 'Overall tool length, mm (drawing only).',
  'sku': 'Manufacturer part number, for reordering.', 'image url': 'Optional picture that replaces the rendered cutter in the grid.', 'colour': 'Colour of the rendered cutter (defaults from the coating in the name: ZrN gold, AlTiN violet, DLC black…).',
  'notes': 'Free text.',
  // machines
  'controller': 'Controller family. The post writes the common GRBL dialect which all of these accept.',
  'x': 'Travel along X, mm.', 'y': 'Travel along Y, mm.', 'z': 'Travel along Z, mm.',
  'max feed xy': 'Fastest cutting feed the machine accepts in XY, mm/min (GRBL $110/$111). Operations above it are flagged.', 'max feed z': 'Fastest feed in Z, mm/min ($112).',
  'rapid xy': 'Rapid rate in XY, mm/min. Time estimates only.', 'rapid z': 'Rapid rate in Z, mm/min. Time estimates only.',
  'accel xy': 'Acceleration in XY, mm/s² ($120/$121). Time estimates only.', 'accel z': 'Acceleration in Z, mm/s².',
  'min rpm': 'Lowest spindle speed.', 'max rpm': 'Highest spindle speed.', 'spin-up s': 'Seconds to wait after M3 before cutting.',
  'tool change': 'How the sender handles tool changes: M6 T<n> for senders that prompt (Carbide Motion with BitSetter), T<n> + M0 for senders that pause so you can swap and re-zero, or a comment only.',
  'safe z machine coords': 'Machine-coordinate Z (G53) used before tool changes and at the end, e.g. −5 on machines that home Z at the top.',
  // buttons
  'suggest feeds': 'Fills rpm, feed, plunge and depth per pass from the material and the tool (chip-load based, conservative). Tune by ear and chip colour.',
  'propose operations': 'Analyses the model: flat faces become exact pockets at their height, through-holes become drills or bores, the rest gets 3D rough and finish, and the outline a cut-out with tabs. Uses the tools in your library.',
  'download .nc': 'Writes the G-code with a timestamped name. Refused while the simulation reports errors (it asks first).',
  'show': 'Shows the G-code text.', 'edit': 'Opens this item in the Parameters panel.', 'duplicate': 'Makes a copy.', 'delete': 'Removes it.',
  'center on stock': 'Moves the selected shapes to the middle of the stock.', 'mirror x': 'Mirrors the shapes left-right about their centre.', 'mirror y': 'Mirrors the shapes front-back about their centre.',
  'union': 'Merges the selected shapes into one.', 'subtract': 'Subtracts the other shapes from the first.', 'intersect': 'Keeps only the overlap.',
  'all': 'Selects everything.', 'none': 'Clears the selection.',
  'center xy': 'Centres the model on the stock.', 'corner +5': 'Puts the model 5 mm from the front-left corner.', 'top at z0': 'Lifts or lowers the model so its top is at the stock top.', 'bottom on bed': 'Sets the model bottom on the stock bottom.', '× 25.4': 'Scales by 25.4 (an inch file imported as mm).', 'fit stock +10': 'Resizes the stock to the model plus a margin.',
  'import stl / obj': 'Imports a mesh as a model for 3D operations.', 'import stl / obj…': 'Imports a mesh as a model for 3D operations.',
  '+ pocket': 'Clears the inside of closed shapes (islands kept), with helix or ramp entry.', '+ profile': 'Cuts along a contour: outside, inside or on it, with tabs.', '+ drill': 'Drills at each shape centre, with pecking.', '+ v-carve': 'V-bit carving that follows the outline with its flank; optional flat clearing.', '+ keyhole': 'A keyhole slot for hanging.', '+ 3d rough': 'Z-level roughing of a model with a flat endmill.', '+ 3d finish': 'Raster finishing of a model with a ball nose.', '+ trace': 'Follows imported 3D tool paths, verified against the model.',
  '+ shape': 'Adds a rectangle, circle, polygon or slot.', 'new tool': 'Starts a blank cutter.', 'add bundled defaults': 'Adds the tools shipped with Cool CAM that are not in your library yet.', 'clear library…': 'Empties your library (the bundled defaults can be added back).',
  'save to library': 'Saves this cutter to your library file (shared with the MCP server).', 'update in job': 'Copies this cutter into the job tools.', 'remove from job': 'Takes the cutter out of this job (not out of the library).', 'remove unused': 'Drops job tools no operation uses.',
  'use in job': 'Makes this machine the job’s machine.', 'update job': 'Applies the edited numbers to the job’s machine.', 'save to my machines': 'Stores this profile in your machines file.', 'new machine': 'Starts from the generic GRBL profile.',
  'create and open': 'Creates the project file with this stock and opens it.', 'open': 'Opens the selected project. Its file becomes the MCP server’s current job.',
  // viewport toggles
  'paths toggle': 'Shows or hides the toolpaths.', 'stock': 'Shows or hides the simulated stock.', 'x-ray': 'Makes the stock translucent so you see paths inside it.', 'models': 'Shows or hides the 3D models.', 'shapes': 'Shows or hides the 2D shapes.', 'ortho': 'Switches between perspective and orthographic cameras.', 'fit': 'Frames the stock.', 'cube': 'Shows the view cube (Space).',
};

export function describeElement(target: Element | null): HelpInfo | null {
  if (!target) return null;
  if (target.closest('.help-panel')) return null; // hovering the help itself keeps the current text
  const el = target.closest('label.row, button, .item, .dv-tab, .project-card, .bar-btn, [title], .op-section-title, .tabs button') as HTMLElement | null;
  if (!el) return null;
  let label = ''; let kind: HelpInfo['kind'] = 'other';
  if (el.matches('label.row')) { label = el.querySelector('.lbl')?.textContent ?? ''; kind = 'field'; }
  else if (el.matches('button')) { label = el.textContent ?? ''; kind = 'button'; }
  else if (el.matches('.dv-tab')) { label = el.textContent ?? ''; kind = 'tab'; }
  else if (el.matches('.item, .project-card')) { label = (el.querySelector('.mono, .project-name')?.textContent ?? el.textContent ?? '').slice(0, 60); kind = 'item'; }
  else label = (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 60);
  label = label.replace(/\s+/g, ' ').trim();
  const titled = target.closest('[title]') as HTMLElement | null;
  const hint = titled?.title || undefined;
  const key = norm(label);
  const body = H[key] ?? H[key.replace(/^\+ /, '')] ?? (kind === 'field' ? H[key.split(' ')[0]] : undefined);
  if (!label && !hint) return null;
  return { label: label || 'Tooltip', hint: hint && hint !== body ? hint : undefined, body, kind };
}
