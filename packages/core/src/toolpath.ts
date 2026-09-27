export type MoveKind = 'rapid' | 'cut' | 'plunge' | 'ramp' | 'retract';

/** A move to an absolute target. `f` is feed (mm/min) for non-rapid moves. */
export interface Move {
  kind: MoveKind;
  x: number;
  y: number;
  z: number;
  f?: number;
}

export interface Toolpath {
  opId: string;
  opName: string;
  toolId: string;
  rpm: number;
  moves: Move[];
  /** Human-readable notes/warnings produced while generating. */
  warnings: string[];
}

export interface ToolpathStats {
  moves: number;
  cutLength: number;
  rapidLength: number;
  minZ: number;
  /** Estimated seconds. */
  seconds: number;
}
