export type GeometryType = "box" | "sphere" | "cylinder" | "capsule";
export type MaterialPreset = "tiny" | "medium" | "large" | "locked" | "neutral";
export type Vec3Tuple = [number, number, number];

export interface GrowthPoint {
  growth: number;
  radius: number;
  tier: string;
}

export interface GameConfig {
  movement: {
    acceleration: number;
    friction: number;
    maxSpeed: number;
  };
  hole: {
    startRadius: number;
    verticalOffset: number;
  };
  camera: {
    offset: Vec3Tuple;
    lookAtHeight: number;
    smoothing: number;
  };
  swallow: {
    sinkDuration: number;
    blockedPulseDuration: number;
  };
  growthCurve: GrowthPoint[];
  hud: {
    progressTargetLabel: string;
  };
  arenaTheme: {
    floorColor: string;
    floorAccentColor: string;
    wallColor: string;
    gridColor: string;
    wallHeight: number;
    wallThickness: number;
  };
}

export interface ArenaDefinition {
  width: number;
  depth: number;
}

export interface ShapeDefinition {
  id: string;
  geometryType: GeometryType | string;
  dimensions: Record<string, number>;
  materialPreset: MaterialPreset;
  scoreValue: number;
  growthValue: number;
  requiredRadius: number;
}

export interface SpawnDefinition {
  shapeId: string;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: number;
  tags?: string[];
}

export interface LevelDefinition {
  id: string;
  title: string;
  tutorialText?: string;
  arena: ArenaDefinition;
  playerSpawn: {
    x: number;
    z: number;
  };
  completionRule: {
    type: "scoreRatio";
    target: number;
  };
  spawns: SpawnDefinition[];
}

export interface ShapeLibraryDefinition {
  shapes: ShapeDefinition[];
}

export interface RuntimeObjectState {
  instanceId: string;
  shapeId: string;
  shapeDefinition: ShapeDefinition;
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: number;
  footprintRadius: number;
  requiredRadius: number;
  scoreValue: number;
  growthValue: number;
  materialPreset: MaterialPreset;
  consumed: boolean;
  swallowing: boolean;
  swallowProgress: number;
  blockedFeedback: number;
}

export interface HoleState {
  position: [number, number];
  velocity: [number, number];
  radius: number;
  growth: number;
  tierLabel: string;
}

export interface GameState {
  isLoading: boolean;
  errorMessage: string | null;
  levelId: string;
  levelTitle: string;
  tutorialText?: string;
  progressTarget: number;
  progressTargetLabel: string;
  hole: HoleState;
  objects: RuntimeObjectState[];
  score: number;
  consumedScore: number;
  consumedCount: number;
  totalCount: number;
  progressRatio: number;
  isComplete: boolean;
  arena: ArenaDefinition | null;
  config: GameConfig | null;
}

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface AudioEventPayload {
  holeRadius?: number;
  score?: number;
  levelId?: string;
}

export type AudioEventName = "onSwallow" | "onGrow" | "onLevelComplete";
