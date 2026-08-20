export type FigureMode = 'Lines' | 'Solid';
export type InteractionMode = 'Original' | 'NameDrop Wave' | 'Drag Dissolve';
export type ContactReleaseStyle = 'Previous · Shockwave' | 'Current · Density';
export type ContactGatherStyle = 'Density Pull' | 'Rope Pull';
export type Phase = 'idle' | 'gathering' | 'dragging' | 'dissolving' | 'blank';

export type FigurePoint = {
  x: number;
  y: number;
  seed: number;
  seed2: number;
  startsPath?: boolean;
  pathIndex?: number;
  pathDistance?: number;
  tangentX?: number;
  tangentY?: number;
};

export type LineGraphEdge = {
  pointIndex: number;
  distance: number;
};

export type RopeField = {
  anchorPointIndex: number;
  anchorDistance: number;
  graphDistances: number[];
  maxGraphDistance: number;
};

export type EchoLineGeometry = {
  path: Path2D;
  points: FigurePoint[];
  samples: FigurePoint[];
  graph: LineGraphEdge[][];
  strokeWidth: number;
  viewBoxX: number;
  viewBoxY: number;
  width: number;
  height: number;
};

export type View = {
  width: number;
  height: number;
  fit: number;
  offsetX: number;
  offsetY: number;
};

export type DesignPoint = {
  x: number;
  y: number;
};

export type PositionedPoint = {
  x: number;
  y: number;
  designX: number;
  designY: number;
};

export type DragParticleState = {
  spawnedAt: number;
  originX: number;
  originY: number;
  velocityX: number;
  velocityY: number;
};

export type DebugApi = {
  dissolve: () => void;
  burst: (clientX?: number, clientY?: number) => void;
  reset: () => void;
  getPhase: () => Phase;
};
