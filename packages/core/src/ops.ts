export type Direction = 'climb' | 'conventional';

export interface OpBase {
  id: string;
  name?: string;
  toolId: string;
  /** Shape ids this op consumes. */
  shapeIds: string[];
  enabled?: boolean;
  /** Total depth below stock top (positive mm). */
  depth: number;
  /** Max depth per pass (positive mm). Defaults to tool diameter. */
  depthPerPass?: number;
  /** Start cutting this far below stock top (positive mm). Default 0. */
  startDepth?: number;
  rpm?: number;
  feed?: number;
  plunge?: number;
}

export interface Tabs {
  /** 'auto' spaces `count` tabs evenly; 'manual' uses `points` (world XY near the path, projected onto the cut loop). */
  mode?: 'auto' | 'manual';
  count: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
}

export interface ProfileOp extends OpBase {
  type: 'profile';
  /** Which side of the shape to cut. 'on' follows the line (engraving, open paths). */
  side: 'outside' | 'inside' | 'on';
  direction?: Direction;
  tabs?: Tabs;
  /** Extra material left on the wall (positive = leave stock). */
  stockToLeave?: number;
  /** Lead-in/out arc radius in mm (0 = none). */
  leadRadius?: number;
  /** How each pass starts: straight plunge (default) or a ramp along the contour. */
  entry?: 'plunge' | 'ramp';
  /** Ramp angle in degrees (default 5). */
  rampAngle?: number;
}

export interface PocketOp extends OpBase {
  type: 'pocket';
  /** Stepover in mm. Default 40% of tool diameter. */
  stepover?: number;
  direction?: Direction;
  entry?: 'plunge' | 'helix' | 'ramp';
  stockToLeave?: number;
  /** Add a final wall pass at zero stock-to-leave after each depth. */
  finishPass?: boolean;
  /** Rest machining: only cut what this earlier (larger) tool could not reach. */
  restToolId?: string;
}

/** V-carve closed regions with a V-bit: the groove walls follow the region outline, depth grows with width. */
export interface VCarveOp extends OpBase {
  type: 'vcarve';
  /** Distance between successive offset passes, mm (default 0.4). */
  stepover?: number;
  /** Optional flat-area clearing endmill (advanced V-carve): areas wider than the V reach are pocketed at `depth`. */
  flatToolId?: string;
  /** Stepover for the flat clearing tool, mm. */
  flatStepover?: number;
}

/** Keyhole slots for hanging: plunge at the shape (or the start of a 2-point line), cut a slot of `length` at `angle`, come back and retract. */
export interface KeyholeOp extends OpBase {
  type: 'keyhole';
  /** Slot length in mm (default 20). */
  length?: number;
  /** Slot direction in degrees (0 = +X, 90 = +Y; default 90). Ignored for 2-point line shapes. */
  angle?: number;
}

export interface DrillOp extends OpBase {
  type: 'drill';
  /** Peck depth in mm; 0 or undefined = single plunge. */
  peck?: number;
  /** Dwell seconds at bottom. Accepted for forward compatibility; not emitted by the generator yet. */
  dwell?: number;
}

/** Z-level roughing of a 3D model: slices the tool-offset surface and clears each layer like a pocket. */
export interface Rough3DOp extends OpBase {
  type: 'rough3d';
  modelId: string;
  /** Stepover in mm (default 40% of diameter). */
  stepover?: number;
  direction?: Direction;
  entry?: 'plunge' | 'helix' | 'ramp';
  /** Material left on the model for finishing (default 0.3 mm). */
  stockToLeave?: number;
  /** Offset applied to the machining boundary, mm (default 0; negative shrinks). */
  boundary?: number;
  /** Heightmap resolution in mm (default derived from stepover). */
  resolution?: number;
  /** Where the tool may machine: the model silhouette (default), its bounding box, the whole stock, or the op's shapes. */
  boundaryMode?: BoundaryMode;
  /** Tool containment relative to the boundary: whole tool inside (default), centre on the boundary, or tool fully outside. */
  containment?: Containment;
  /** Shapes whose interior is excluded from machining. */
  avoidShapeIds?: string[];
}
export type BoundaryMode = 'silhouette' | 'bbox' | 'stock' | 'shapes';
export type Containment = 'inside' | 'center' | 'outside';

/** Parallel (raster) finishing along X or Y following the tool-offset surface. */
export interface Finish3DOp extends OpBase {
  type: 'finish3d';
  modelId: string;
  /** Stepover between passes in mm (default 10% of diameter). */
  stepover?: number;
  /** Raster direction. */
  axis?: 'x' | 'y';
  stockToLeave?: number;
  boundary?: number;
  resolution?: number;
  boundaryMode?: BoundaryMode;
  containment?: Containment;
  avoidShapeIds?: string[];
  /** Also raster the flat floor at the model base outside the footprint (default false: roughing leaves it flat). */
  finishFloor?: boolean;
}

export type Op = ProfileOp | PocketOp | DrillOp | Rough3DOp | Finish3DOp | VCarveOp | KeyholeOp;
