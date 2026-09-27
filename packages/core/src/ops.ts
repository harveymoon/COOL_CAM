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
}

export interface DrillOp extends OpBase {
  type: 'drill';
  /** Peck depth in mm; 0 or undefined = single plunge. */
  peck?: number;
  /** Dwell seconds at bottom. */
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

export type Op = ProfileOp | PocketOp | DrillOp | Rough3DOp | Finish3DOp;
