import { loadGameConfig, loadLevel, loadShapeLibrary, validateLevelContent } from "./content";
import {
  advanceHoleMotion,
  calculateRadiusForGrowth,
  canObjectFitInsideHole,
  computeBlockedShakeStrength,
  computeCompletionRatio,
  isObjectInsideHole,
  isObjectNearHolePlane,
  isObjectWithinAttemptRange,
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

    this.updateObjectTimers(dt);
    this.updateObjectPhysics(dt);

    for (const object of this.state.objects) {
      if (object.consumed || object.swallowing) {
        continue;
      }

      if (
        !isObjectNearHolePlane(
          object.position[1],
          object.halfHeight,
          this.config.swallow.captureHeightTolerance,
        )
      ) {
        continue;
      }

      const fitsInsideHole = canObjectFitInsideHole(
        this.state.hole.radius,
        object.fitRadius,
        this.config.swallow.fitClearanceMultiplier,
      );
      const attemptRangeReached = isObjectWithinAttemptRange(
        this.state.hole.position,
        this.state.hole.radius,
        [object.position[0], object.position[2]],
        object.fitRadius,
        this.config.swallow.attemptOverlapPadding,
      );

      if (!fitsInsideHole && attemptRangeReached) {
        this.triggerBlockedResponse(object);
        continue;
      }

      if (
        fitsInsideHole &&
        isObjectInsideHole(
          this.state.hole.position,
          this.state.hole.radius,
          [object.position[0], object.position[2]],
          object.fitRadius,
        )
      ) {
        this.swallowObject(object);
      }
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
        fitRadius: this.options.shapeRegistry.getFootprint(shape) * (spawn.scale ?? 1),
        halfHeight: this.options.shapeRegistry.getHalfHeight(shape) * (spawn.scale ?? 1),
        scoreValue: shape.scoreValue,
        growthValue: shape.growthValue,
        materialPreset: shape.materialPreset,
        consumed: false,
        swallowing: false,
        swallowProgress: 0,
        verticalVelocity: 0,
        blockedFeedback: 0,
        blockedShakeTime: 0,
        blockedShakeStrength: 0,
      };
    });
  }

  private swallowObject(object: RuntimeObjectState): void {
    object.swallowing = true;
    object.swallowProgress = 0;
    object.blockedFeedback = 0;
    object.blockedShakeTime = 0;
    object.blockedShakeStrength = 0;
    object.verticalVelocity = 0;
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

  private updateObjectTimers(dt: number): void {
    for (const object of this.state.objects) {
      if (object.blockedFeedback > 0) {
        object.blockedFeedback = Math.max(0, object.blockedFeedback - dt);
      }

      if (object.blockedShakeTime > 0) {
        object.blockedShakeTime = Math.max(0, object.blockedShakeTime - dt);

        if (object.blockedShakeTime === 0) {
          object.blockedShakeStrength = 0;
        }
      }

      if (!object.swallowing) {
        continue;
      }

      object.swallowProgress = Math.min(1, object.swallowProgress + dt / this.config!.swallow.sinkDuration);

      if (object.swallowProgress >= 1) {
        object.swallowing = false;
        object.consumed = true;
      }
    }
  }

  private updateObjectPhysics(dt: number): void {
    const activeObjects = this.state.objects
      .filter((object) => !object.consumed && !object.swallowing)
      .sort((left, right) => left.position[1] - right.position[1]);

    for (const object of activeObjects) {
      const gravityVelocity = Math.max(
        -this.config!.physics.maxFallSpeed,
        object.verticalVelocity - this.config!.physics.gravity * dt,
      );
      const nextCenterY = object.position[1] + gravityVelocity * dt;
      const supportTopY = this.findSupportTopY(object, activeObjects);
      const snappedCenterY = supportTopY + object.halfHeight;
      const nextBottomY = nextCenterY - object.halfHeight;
      const currentBottomY = object.position[1] - object.halfHeight;

      if (
        nextBottomY <= supportTopY + this.config!.physics.groundSnapDistance &&
        currentBottomY >= supportTopY - this.config!.physics.groundSnapDistance
      ) {
        object.position[1] = snappedCenterY;
        object.verticalVelocity = 0;
      } else {
        object.position[1] = nextCenterY;
        object.verticalVelocity = gravityVelocity;
      }
    }
  }

  private findSupportTopY(
    object: RuntimeObjectState,
    activeObjects: RuntimeObjectState[],
  ): number {
    let highestSupportTopY = 0;
    const objectBottomY = object.position[1] - object.halfHeight;

    for (const candidate of activeObjects) {
      if (candidate.instanceId === object.instanceId) {
        continue;
      }

      const candidateTopY = candidate.position[1] + candidate.halfHeight;
      if (candidateTopY > objectBottomY + this.config!.physics.groundSnapDistance) {
        continue;
      }

      const horizontalDistance = Math.hypot(
        object.position[0] - candidate.position[0],
        object.position[2] - candidate.position[2],
      );
      const supportReach =
        candidate.fitRadius * 0.65 + this.config!.physics.supportProbePadding;

      if (horizontalDistance > supportReach) {
        continue;
      }

      if (candidateTopY > highestSupportTopY) {
        highestSupportTopY = candidateTopY;
      }
    }

    return highestSupportTopY;
  }

  private triggerBlockedResponse(object: RuntimeObjectState): void {
    const shakeStrength = computeBlockedShakeStrength(
      this.state.hole.radius,
      object.fitRadius,
      this.config!.swallow.fitClearanceMultiplier,
    );

    if (shakeStrength <= 0) {
      return;
    }

    const retriggerThreshold = this.config!.swallow.blockedShakeDuration * 0.3;
    if (
      object.blockedShakeTime <= retriggerThreshold ||
      shakeStrength > object.blockedShakeStrength + 0.08
    ) {
      object.blockedShakeTime = this.config!.swallow.blockedShakeDuration;
      object.blockedShakeStrength = shakeStrength;
    }

    object.blockedFeedback = Math.max(
      object.blockedFeedback,
      this.config!.swallow.blockedPulseDuration,
    );
  }
}
