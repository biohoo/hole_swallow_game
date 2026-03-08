import { loadGameConfig, loadLevel, loadShapeLibrary, validateLevelContent } from "./content";
import {
  advanceHoleMotion,
  calculateRadiusForGrowth,
  computeCompletionRatio,
  isObjectInsideHole,
} from "./simulation";
import type { AudioBus } from "./audio";
import type { ShapeRegistry } from "./shapeRegistry";
import type {
  GameConfig,
  GameState,
  InputState,
  LevelDefinition,
  RuntimeObjectState,
  ShapeDefinition,
} from "./types";

interface GameSessionOptions {
  audioBus: AudioBus;
  shapeRegistry: ShapeRegistry;
}

const INITIAL_STATE: GameState = {
  isLoading: false,
  errorMessage: null,
  levelId: "",
  levelTitle: "",
  tutorialText: "",
  progressTarget: 1,
  progressTargetLabel: "Arena Cleared",
  hole: {
    position: [0, 0],
    velocity: [0, 0],
    radius: 1,
    growth: 0,
    tierLabel: "Tiny",
  },
  objects: [],
  score: 0,
  consumedScore: 0,
  consumedCount: 0,
  totalCount: 0,
  progressRatio: 0,
  isComplete: false,
  arena: null,
  config: null,
};

function createInitialState(): GameState {
  return {
    isLoading: INITIAL_STATE.isLoading,
    errorMessage: INITIAL_STATE.errorMessage,
    levelId: INITIAL_STATE.levelId,
    levelTitle: INITIAL_STATE.levelTitle,
    tutorialText: INITIAL_STATE.tutorialText,
    progressTarget: INITIAL_STATE.progressTarget,
    progressTargetLabel: INITIAL_STATE.progressTargetLabel,
    hole: {
      position: [...INITIAL_STATE.hole.position],
      velocity: [...INITIAL_STATE.hole.velocity],
      radius: INITIAL_STATE.hole.radius,
      growth: INITIAL_STATE.hole.growth,
      tierLabel: INITIAL_STATE.hole.tierLabel,
    },
    objects: [],
    score: INITIAL_STATE.score,
    consumedScore: INITIAL_STATE.consumedScore,
    consumedCount: INITIAL_STATE.consumedCount,
    totalCount: INITIAL_STATE.totalCount,
    progressRatio: INITIAL_STATE.progressRatio,
    isComplete: INITIAL_STATE.isComplete,
    arena: INITIAL_STATE.arena,
    config: INITIAL_STATE.config,
  };
}

export class GameSession {
  private state: GameState = createInitialState();
  private level: LevelDefinition | null = null;
  private config: GameConfig | null = null;
  private shapesById = new Map<string, ShapeDefinition>();

  constructor(private readonly options: GameSessionOptions) {}

  async start(levelId: string): Promise<void> {
    this.state = {
      ...createInitialState(),
      isLoading: true,
      levelId,
    };

    try {
      const [config, shapes, level] = await Promise.all([
        loadGameConfig(),
        loadShapeLibrary(),
        loadLevel(levelId),
      ]);

      validateLevelContent(level, shapes, this.options.shapeRegistry.supportedTypes());

      this.config = config;
      this.level = level;
      this.shapesById = new Map(shapes.map((shape) => [shape.id, shape]));

      const initialHole = calculateRadiusForGrowth(config.growthCurve, 0);
      const runtimeObjects = this.createRuntimeObjects(level, this.shapesById);

      this.state = {
        isLoading: false,
        errorMessage: null,
        levelId: level.id,
        levelTitle: level.title,
        tutorialText: level.tutorialText,
        progressTarget: level.completionRule.target,
        progressTargetLabel: config.hud.progressTargetLabel,
        hole: {
          position: [level.playerSpawn.x, level.playerSpawn.z],
          velocity: [0, 0],
          radius: initialHole.radius,
          growth: 0,
          tierLabel: initialHole.tierLabel,
        },
        objects: runtimeObjects,
        score: 0,
        consumedScore: 0,
        consumedCount: 0,
        totalCount: runtimeObjects.length,
        progressRatio: 0,
        isComplete: false,
        arena: level.arena,
        config,
      };
    } catch (error) {
      this.state = {
        ...createInitialState(),
        isLoading: false,
        levelId,
        errorMessage: error instanceof Error ? error.message : "Unknown loading error.",
      };
    }
  }

  getState(): GameState {
    return this.state;
  }

  update(dt: number, input: InputState): void {
    if (this.state.isLoading || this.state.errorMessage || !this.config || !this.level || !this.state.arena) {
      return;
    }

    const holeMotion = advanceHoleMotion(
      this.config.movement,
      this.state.arena,
      this.state.hole.radius,
      {
        position: this.state.hole.position,
        velocity: this.state.hole.velocity,
      },
      input,
      this.config.camera.offset,
      dt,
    );

    this.state.hole.position = holeMotion.position;
    this.state.hole.velocity = holeMotion.velocity;

    for (const object of this.state.objects) {
      if (object.blockedFeedback > 0) {
        object.blockedFeedback = Math.max(0, object.blockedFeedback - dt);
      }

      if (object.swallowing) {
        object.swallowProgress = Math.min(1, object.swallowProgress + dt / this.config.swallow.sinkDuration);

        if (object.swallowProgress >= 1) {
          object.swallowing = false;
          object.consumed = true;
        }

        continue;
      }

      if (object.consumed) {
        continue;
      }

      const insideHole = isObjectInsideHole(
        this.state.hole.position,
        this.state.hole.radius,
        [object.position[0], object.position[2]],
        object.footprintRadius,
      );

      if (!insideHole) {
        continue;
      }

      if (this.state.hole.radius < object.requiredRadius) {
        object.blockedFeedback = this.config.swallow.blockedPulseDuration;
        continue;
      }

      this.swallowObject(object);
    }

    this.state.progressRatio = computeCompletionRatio(
      this.state.consumedScore,
      this.getTotalScore(this.state.objects),
    );

    if (!this.state.isComplete && this.state.progressRatio >= this.state.progressTarget) {
      this.state.isComplete = true;
      this.options.audioBus.emit("onLevelComplete", { levelId: this.state.levelId });
    }
  }

  private createRuntimeObjects(
    level: LevelDefinition,
    shapesById: Map<string, ShapeDefinition>,
  ): RuntimeObjectState[] {
    return level.spawns.map((spawn, index) => {
      const shape = shapesById.get(spawn.shapeId);

      if (!shape) {
        throw new Error(`Missing shape definition for "${spawn.shapeId}".`);
      }

      return {
        instanceId: `${level.id}-${index}-${spawn.shapeId}`,
        shapeId: spawn.shapeId,
        shapeDefinition: shape,
        position: [...spawn.position],
        rotation: spawn.rotation ? [...spawn.rotation] : [0, 0, 0],
        scale: spawn.scale ?? 1,
        footprintRadius: this.options.shapeRegistry.getFootprint(shape) * (spawn.scale ?? 1),
        requiredRadius: shape.requiredRadius * (spawn.scale ?? 1),
        scoreValue: shape.scoreValue,
        growthValue: shape.growthValue,
        materialPreset: shape.materialPreset,
        consumed: false,
        swallowing: false,
        swallowProgress: 0,
        blockedFeedback: 0,
      };
    });
  }

  private swallowObject(object: RuntimeObjectState): void {
    object.swallowing = true;
    object.swallowProgress = 0;
    this.state.score += object.scoreValue;
    this.state.consumedScore += object.scoreValue;
    this.state.consumedCount += 1;
    this.state.hole.growth += object.growthValue;

    const previousRadius = this.state.hole.radius;
    const nextHole = calculateRadiusForGrowth(this.config!.growthCurve, this.state.hole.growth);
    this.state.hole.radius = nextHole.radius;
    this.state.hole.tierLabel = nextHole.tierLabel;

    this.options.audioBus.emit("onSwallow", {
      holeRadius: this.state.hole.radius,
      score: this.state.score,
    });

    if (Math.abs(previousRadius - nextHole.radius) > 0.001) {
      this.options.audioBus.emit("onGrow", {
        holeRadius: nextHole.radius,
      });
    }
  }

  private getTotalScore(objects: RuntimeObjectState[]): number {
    return objects.reduce((total, object) => total + object.scoreValue, 0);
  }
}
