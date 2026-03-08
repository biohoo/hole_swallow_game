import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";

import { AudioBus } from "../game/audio";
import { validateLevelContent } from "../game/content";
import { GameSession } from "../game/GameSession";
import { ShapeRegistry, createDefaultShapeRegistry } from "../game/shapeRegistry";
import {
  advanceHoleMotion,
  calculateRadiusForGrowth,
  canObjectFitInsideHole,
  computeBlockedShakeStrength,
  computeCompletionRatio,
  isObjectInsideHole,
  isObjectNearHolePlane,
  isObjectWithinAttemptRange,
} from "../game/simulation";
import type { GameConfig, LevelDefinition, ShapeDefinition } from "../game/types";

const growthCurve: GameConfig["growthCurve"] = [
  { growth: 0, radius: 1.2, tier: "Tiny" },
  { growth: 4, radius: 2.1, tier: "Small" },
  { growth: 8, radius: 3, tier: "Large" },
];

const baseLevel: LevelDefinition = {
  id: "demo",
  title: "Demo",
  arena: { width: 10, depth: 10 },
  playerSpawn: { x: 0, z: 0 },
  completionRule: { type: "scoreRatio", target: 0.8 },
  spawns: [{ shapeId: "tiny-sphere", position: [0, 0.4, 0] }],
};

const baseShapes: ShapeDefinition[] = [
  {
    id: "tiny-sphere",
    geometryType: "sphere",
    dimensions: { radius: 0.4 },
    materialPreset: "tiny",
    scoreValue: 10,
    growthValue: 1,
  },
];

const integrationConfig: GameConfig = {
  movement: {
    acceleration: 20,
    friction: 10,
    maxSpeed: 6.6,
  },
  hole: {
    startRadius: 1.2,
    verticalOffset: 0.05,
  },
  camera: {
    offset: [11, 13, 11],
    lookAtHeight: 0.2,
    smoothing: 5.5,
  },
  swallow: {
    sinkDuration: 0.2,
    blockedPulseDuration: 0.2,
    fitClearanceMultiplier: 1,
    attemptOverlapPadding: 0.3,
    blockedShakeDuration: 0.3,
    blockedShakeMaxDistance: 0.2,
    blockedShakeFrequency: 18,
    captureHeightTolerance: 0.15,
  },
  physics: {
    gravity: 12,
    maxFallSpeed: 20,
    groundSnapDistance: 0.08,
    supportProbePadding: 0.12,
  },
  growthCurve: [
    { growth: 0, radius: 1.2, tier: "Tiny" },
    { growth: 4, radius: 2.1, tier: "Small" },
    { growth: 8, radius: 3, tier: "Large" },
  ],
  hud: {
    progressTargetLabel: "Arena Cleared",
  },
  arenaTheme: {
    floorColor: "#cfd9c5",
    floorAccentColor: "#b3c19f",
    wallColor: "#51604f",
    gridColor: "#90a383",
    wallHeight: 1.4,
    wallThickness: 0.5,
  },
};

const integrationShapes: ShapeDefinition[] = [
  {
    id: "support-box",
    geometryType: "box",
    dimensions: { width: 2.4, height: 1, depth: 2.4 },
    materialPreset: "medium",
    scoreValue: 20,
    growthValue: 2,
    requiredRadius: 0.25,
  },
  {
    id: "top-sphere",
    geometryType: "sphere",
    dimensions: { radius: 0.3 },
    materialPreset: "tiny",
    scoreValue: 8,
    growthValue: 0.5,
  },
];

const integrationLevel: LevelDefinition = {
  id: "stack-test",
  title: "Stack Test",
  arena: { width: 10, depth: 10 },
  playerSpawn: { x: 0, z: 0 },
  completionRule: { type: "scoreRatio", target: 0.8 },
  spawns: [
    { shapeId: "support-box", position: [0, 0.5, 0] },
    { shapeId: "top-sphere", position: [0, 1.3, 0] },
  ],
};

describe("simulation helpers", () => {
  it("interpolates hole radius and keeps the last unlocked tier label", () => {
    expect(calculateRadiusForGrowth(growthCurve, 0)).toEqual({
      radius: 1.2,
      tierLabel: "Tiny",
    });

    expect(calculateRadiusForGrowth(growthCurve, 2)).toEqual({
      radius: 1.65,
      tierLabel: "Tiny",
    });

    expect(calculateRadiusForGrowth(growthCurve, 9)).toEqual({
      radius: 3,
      tierLabel: "Large",
    });
  });

  it("checks full footprint containment inside the hole", () => {
    expect(isObjectInsideHole([0, 0], 2, [1, 0], 0.7)).toBe(true);
    expect(isObjectInsideHole([0, 0], 2, [1.6, 0], 0.7)).toBe(false);
  });

  it("uses physical fit rather than legacy required radius", () => {
    expect(canObjectFitInsideHole(1.2, 1.35, 1)).toBe(false);
    expect(canObjectFitInsideHole(1.6, 1.35, 1)).toBe(true);
  });

  it("detects blocked attempt overlap before full containment", () => {
    expect(isObjectWithinAttemptRange([0, 0], 1.2, [1.5, 0], 0.7, 0.1)).toBe(true);
    expect(isObjectWithinAttemptRange([0, 0], 1.2, [2.2, 0], 0.7, 0.1)).toBe(false);
  });

  it("only allows objects near the hole plane to be swallowed", () => {
    expect(isObjectNearHolePlane(0.32, 0.3, 0.1)).toBe(true);
    expect(isObjectNearHolePlane(1.3, 0.3, 0.1)).toBe(false);
  });

  it("clamps the hole to arena bounds and keeps velocity from pushing through walls", () => {
    const result = advanceHoleMotion(
      {
        acceleration: 20,
        friction: 8,
        maxSpeed: 6,
      },
      { width: 12, depth: 12 },
      1.5,
      {
        position: [4.2, 0],
        velocity: [5, 0],
      },
      { up: false, down: false, left: false, right: true },
      [0, 8, 10],
      0.2,
    );

    expect(result.position[0]).toBe(4.5);
    expect(result.velocity[0]).toBe(0);
  });

  it("maps arrow keys to the viewer-facing screen directions", () => {
    const result = advanceHoleMotion(
      {
        acceleration: 20,
        friction: 8,
        maxSpeed: 6,
      },
      { width: 40, depth: 40 },
      1.5,
      {
        position: [0, 0],
        velocity: [0, 0],
      },
      { up: true, down: false, left: false, right: false },
      [11, 13, 11],
      0.1,
    );

    expect(result.velocity[0]).toBeCloseTo(-Math.SQRT2, 5);
    expect(result.velocity[1]).toBeCloseTo(-Math.SQRT2, 5);
  });

  it("computes completion ratio from consumed score", () => {
    expect(computeCompletionRatio(40, 100)).toBe(0.4);
    expect(computeCompletionRatio(120, 100)).toBe(1);
  });

  it("shakes near-fit blocked objects more than much larger ones", () => {
    const nearFitStrength = computeBlockedShakeStrength(1.2, 1.35, 1);
    const hugeStrength = computeBlockedShakeStrength(1.2, 2.8, 1);

    expect(nearFitStrength).toBeGreaterThan(hugeStrength);
    expect(nearFitStrength).toBeGreaterThan(0.8);
    expect(hugeStrength).toBeLessThan(0.5);
  });
});

describe("content validation", () => {
  it("fails clearly when a level references a missing shape id", () => {
    expect(() =>
      validateLevelContent(baseLevel, [], createDefaultShapeRegistry().supportedTypes()),
    ).toThrow(/missing shape/i);
  });

  it("fails clearly when a shape uses an unsupported geometry type", () => {
    expect(() =>
      validateLevelContent(
        baseLevel,
        [{ ...baseShapes[0], geometryType: "pyramid" }],
        createDefaultShapeRegistry().supportedTypes(),
      ),
    ).toThrow(/unsupported geometry/i);
  });
});

describe("shape registry", () => {
  it("supports custom geometry registration without touching the game loop", () => {
    const registry = new ShapeRegistry();
    registry.register(
      "diamond",
      (_definition, createMaterial) => new Mesh(new BoxGeometry(1, 1, 1), createMaterial()),
      () => 0.9,
    );

    const shape: ShapeDefinition = {
      id: "diamond-shape",
      geometryType: "diamond",
      dimensions: { width: 1 },
      materialPreset: "medium",
      scoreValue: 10,
      growthValue: 1,
      requiredRadius: 1.5,
    };

    const object = registry.createObject(shape, () => new MeshStandardMaterial());

    expect(object).toBeInstanceOf(Mesh);
    expect(registry.getFootprint(shape)).toBe(0.9);
  });
});

describe("game session physical fit and stacked falling", () => {
  beforeAll(() => {
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const path = String(input);

      if (path.endsWith("/config/game-config.json")) {
        return {
          ok: true,
          json: async () => integrationConfig,
        } as Response;
      }

      if (path.endsWith("/shapes/shapes.json")) {
        return {
          ok: true,
          json: async () => ({ shapes: integrationShapes }),
        } as Response;
      }

      if (path.endsWith("/levels/stack-test.json")) {
        return {
          ok: true,
          json: async () => integrationLevel,
        } as Response;
      }

      throw new Error(`Unexpected fetch path: ${path}`);
    }) as unknown as typeof fetch;
  });

  it("ignores legacy required radius, triggers blocked shake, and lets stacked objects fall", async () => {
    const session = new GameSession({
      audioBus: new AudioBus(),
      shapeRegistry: createDefaultShapeRegistry(),
    });

    await session.start("stack-test");

    session.update(0.1, { up: false, down: false, left: false, right: false });

    const initialState = session.getState();
    const supportBox = initialState.objects.find((object) => object.shapeId === "support-box")!;
    const topSphere = initialState.objects.find((object) => object.shapeId === "top-sphere")!;

    expect(initialState.consumedCount).toBe(0);
    expect(supportBox.blockedShakeTime).toBeGreaterThan(0);
    expect(supportBox.blockedShakeStrength).toBeGreaterThan(0);
    expect(topSphere.blockedShakeTime).toBe(0);

    initialState.hole.radius = 1.8;
    session.update(0.05, { up: false, down: false, left: false, right: false });

    expect(supportBox.swallowing).toBe(true);
    expect(initialState.consumedCount).toBe(1);

    initialState.hole.position = [3, 3];
    const startingY = topSphere.position[1];

    for (let index = 0; index < 12; index += 1) {
      session.update(0.1, { up: false, down: false, left: false, right: false });
    }

    expect(topSphere.position[1]).toBeLessThan(startingY);
    expect(topSphere.position[1]).toBeCloseTo(0.3, 2);
    expect(topSphere.consumed).toBe(false);
  });
});
