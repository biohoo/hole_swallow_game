import type {
  GameConfig,
  LevelDefinition,
  ShapeDefinition,
  ShapeLibraryDefinition,
  SpawnDefinition,
} from "./types";

let configPromise: Promise<GameConfig> | null = null;
let shapesPromise: Promise<ShapeDefinition[]> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status}).`);
  }

  return (await response.json()) as T;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function assertPositiveNumber(value: unknown, label: string): number {
  const number = assertNumber(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }

  return number;
}

function validateShapeDimensions(shape: ShapeDefinition): void {
  const { geometryType, dimensions } = shape;

  switch (geometryType) {
    case "box":
      assertPositiveNumber(dimensions.width, `${shape.id}.dimensions.width`);
      assertPositiveNumber(dimensions.height, `${shape.id}.dimensions.height`);
      assertPositiveNumber(dimensions.depth, `${shape.id}.dimensions.depth`);
      break;
    case "sphere":
      assertPositiveNumber(dimensions.radius, `${shape.id}.dimensions.radius`);
      break;
    case "cylinder":
      assertPositiveNumber(dimensions.radiusTop, `${shape.id}.dimensions.radiusTop`);
      assertPositiveNumber(dimensions.radiusBottom, `${shape.id}.dimensions.radiusBottom`);
      assertPositiveNumber(dimensions.height, `${shape.id}.dimensions.height`);
      break;
    case "capsule":
      assertPositiveNumber(dimensions.radius, `${shape.id}.dimensions.radius`);
      assertPositiveNumber(dimensions.height, `${shape.id}.dimensions.height`);
      break;
    default:
      throw new Error(`Unsupported geometry type "${String(geometryType)}" in shape "${shape.id}".`);
  }
}

function validateShapeLibrary(data: ShapeLibraryDefinition): ShapeDefinition[] {
  if (!data || !Array.isArray(data.shapes) || data.shapes.length === 0) {
    throw new Error("Shape library must include at least one shape.");
  }

  const seen = new Set<string>();
  return data.shapes.map((shape) => {
    if (!shape.id) {
      throw new Error("Every shape requires an id.");
    }

    if (seen.has(shape.id)) {
      throw new Error(`Duplicate shape id "${shape.id}".`);
    }

    seen.add(shape.id);
    validateShapeDimensions(shape);
    assertPositiveNumber(shape.scoreValue, `${shape.id}.scoreValue`);
    assertPositiveNumber(shape.growthValue, `${shape.id}.growthValue`);
    assertPositiveNumber(shape.requiredRadius, `${shape.id}.requiredRadius`);
    return shape;
  });
}

function validateSpawn(spawn: SpawnDefinition, index: number): void {
  if (!spawn.shapeId) {
    throw new Error(`Spawn ${index} is missing a shapeId.`);
  }

  if (!Array.isArray(spawn.position) || spawn.position.length !== 3) {
    throw new Error(`Spawn ${index} position must be a 3-item tuple.`);
  }

  spawn.position.forEach((value, valueIndex) => {
    assertNumber(value, `spawn ${index}.position[${valueIndex}]`);
  });

  if (spawn.rotation) {
    if (!Array.isArray(spawn.rotation) || spawn.rotation.length !== 3) {
      throw new Error(`Spawn ${index} rotation must be a 3-item tuple.`);
    }

    spawn.rotation.forEach((value, valueIndex) => {
      assertNumber(value, `spawn ${index}.rotation[${valueIndex}]`);
    });
  }

  if (spawn.scale !== undefined) {
    assertPositiveNumber(spawn.scale, `spawn ${index}.scale`);
  }
}

function validateGameConfig(config: GameConfig): GameConfig {
  assertPositiveNumber(config.movement.acceleration, "movement.acceleration");
  assertPositiveNumber(config.movement.friction, "movement.friction");
  assertPositiveNumber(config.movement.maxSpeed, "movement.maxSpeed");
  assertPositiveNumber(config.hole.startRadius, "hole.startRadius");
  assertPositiveNumber(config.swallow.sinkDuration, "swallow.sinkDuration");
  assertPositiveNumber(config.swallow.blockedPulseDuration, "swallow.blockedPulseDuration");

  if (!Array.isArray(config.camera.offset) || config.camera.offset.length !== 3) {
    throw new Error("camera.offset must be a 3-item tuple.");
  }

  config.camera.offset.forEach((value, index) => {
    assertNumber(value, `camera.offset[${index}]`);
  });

  if (!Array.isArray(config.growthCurve) || config.growthCurve.length === 0) {
    throw new Error("growthCurve must contain at least one point.");
  }

  let previousGrowth = -Infinity;
  for (const point of config.growthCurve) {
    assertNumber(point.growth, "growthCurve.growth");
    assertPositiveNumber(point.radius, "growthCurve.radius");
    if (!point.tier) {
      throw new Error("growthCurve.tier must be present.");
    }
    if (point.growth < previousGrowth) {
      throw new Error("growthCurve must be sorted by growth.");
    }
    previousGrowth = point.growth;
  }

  assertPositiveNumber(config.arenaTheme.wallHeight, "arenaTheme.wallHeight");
  assertPositiveNumber(config.arenaTheme.wallThickness, "arenaTheme.wallThickness");

  return config;
}

function validateLevel(level: LevelDefinition): LevelDefinition {
  if (!level.id) {
    throw new Error("Level id is required.");
  }

  if (!level.title) {
    throw new Error("Level title is required.");
  }

  assertPositiveNumber(level.arena.width, "arena.width");
  assertPositiveNumber(level.arena.depth, "arena.depth");
  assertNumber(level.playerSpawn.x, "playerSpawn.x");
  assertNumber(level.playerSpawn.z, "playerSpawn.z");

  if (level.completionRule.type !== "scoreRatio") {
    throw new Error(`Unsupported completion rule "${level.completionRule.type}".`);
  }

  const target = assertNumber(level.completionRule.target, "completionRule.target");
  if (target <= 0 || target > 1) {
    throw new Error("completionRule.target must be between 0 and 1.");
  }

  if (!Array.isArray(level.spawns) || level.spawns.length === 0) {
    throw new Error("Level must contain at least one spawn.");
  }

  level.spawns.forEach(validateSpawn);
  return level;
}

export function validateLevelContent(
  level: LevelDefinition,
  shapes: ShapeDefinition[],
  supportedGeometryTypes: string[],
): void {
  const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));

  for (const spawn of level.spawns) {
    const shape = shapeById.get(spawn.shapeId);

    if (!shape) {
      throw new Error(`Level "${level.id}" references missing shape "${spawn.shapeId}".`);
    }

    if (!supportedGeometryTypes.includes(shape.geometryType)) {
      throw new Error(
        `Shape "${shape.id}" uses unsupported geometry type "${shape.geometryType}".`,
      );
    }
  }
}

export async function loadGameConfig(): Promise<GameConfig> {
  if (!configPromise) {
    configPromise = fetchJson<GameConfig>("/config/game-config.json").then(validateGameConfig);
  }

  return configPromise;
}

export async function loadShapeLibrary(): Promise<ShapeDefinition[]> {
  if (!shapesPromise) {
    shapesPromise = fetchJson<ShapeLibraryDefinition>("/shapes/shapes.json").then(validateShapeLibrary);
  }

  return shapesPromise;
}

export async function loadLevel(levelId: string): Promise<LevelDefinition> {
  const suffix = levelId.endsWith(".json") ? levelId : `${levelId}.json`;
  return fetchJson<LevelDefinition>(`/levels/${suffix}`).then(validateLevel);
}
