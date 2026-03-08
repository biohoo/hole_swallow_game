import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";

import { validateLevelContent } from "../game/content";
import { ShapeRegistry, createDefaultShapeRegistry } from "../game/shapeRegistry";
import {
  advanceHoleMotion,
  calculateRadiusForGrowth,
  computeCompletionRatio,
  isObjectInsideHole,
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
    requiredRadius: 1.2,
  },
];

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
