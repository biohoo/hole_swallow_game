import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from "three";

import type { ShapeDefinition } from "./types";

export type ShapeBuilder = (
  definition: ShapeDefinition,
  createMaterial: () => MeshStandardMaterial,
) => Object3D;

export type FootprintRule = (definition: ShapeDefinition) => number;
export type HalfHeightRule = (definition: ShapeDefinition) => number;

interface RegistryEntry {
  builder: ShapeBuilder;
  footprintRule: FootprintRule;
  halfHeightRule: HalfHeightRule;
}

export class ShapeRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(
    type: string,
    builder: ShapeBuilder,
    footprintRule: FootprintRule,
    halfHeightRule: HalfHeightRule = footprintRule,
  ): void {
    this.entries.set(type, { builder, footprintRule, halfHeightRule });
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  supportedTypes(): string[] {
    return [...this.entries.keys()];
  }

  createObject(
    definition: ShapeDefinition,
    createMaterial: () => MeshStandardMaterial,
  ): Object3D {
    const entry = this.entries.get(definition.geometryType);

    if (!entry) {
      throw new Error(`No shape builder registered for "${definition.geometryType}".`);
    }

    return entry.builder(definition, createMaterial);
  }

  getFootprint(definition: ShapeDefinition): number {
    const entry = this.entries.get(definition.geometryType);

    if (!entry) {
      throw new Error(`No footprint rule registered for "${definition.geometryType}".`);
    }

    return entry.footprintRule(definition);
  }

  getHalfHeight(definition: ShapeDefinition): number {
    const entry = this.entries.get(definition.geometryType);

    if (!entry) {
      throw new Error(`No half-height rule registered for "${definition.geometryType}".`);
    }

    return entry.halfHeightRule(definition);
  }
}

export function createDefaultShapeRegistry(): ShapeRegistry {
  const registry = new ShapeRegistry();

  registry.register(
    "box",
    (definition, createMaterial) =>
      new Mesh(
        new BoxGeometry(
          definition.dimensions.width,
          definition.dimensions.height,
          definition.dimensions.depth,
        ),
        createMaterial(),
      ),
    (definition) =>
      Math.hypot(definition.dimensions.width / 2, definition.dimensions.depth / 2),
    (definition) => definition.dimensions.height / 2,
  );

  registry.register(
    "sphere",
    (definition, createMaterial) =>
      new Mesh(new SphereGeometry(definition.dimensions.radius, 24, 18), createMaterial()),
    (definition) => definition.dimensions.radius,
    (definition) => definition.dimensions.radius,
  );

  registry.register(
    "cylinder",
    (definition, createMaterial) =>
      new Mesh(
        new CylinderGeometry(
          definition.dimensions.radiusTop,
          definition.dimensions.radiusBottom,
          definition.dimensions.height,
          28,
        ),
        createMaterial(),
      ),
    (definition) => Math.max(definition.dimensions.radiusTop, definition.dimensions.radiusBottom),
    (definition) => definition.dimensions.height / 2,
  );

  registry.register(
    "capsule",
    (definition, createMaterial) => {
      const group = new Group();
      const radius = definition.dimensions.radius;
      const midHeight = Math.max(definition.dimensions.height - radius * 2, 0.01);

      const cylinder = new Mesh(new CylinderGeometry(radius, radius, midHeight, 24), createMaterial());
      group.add(cylinder);

      const top = new Mesh(new SphereGeometry(radius, 24, 16), createMaterial());
      top.position.y = midHeight / 2;
      group.add(top);

      const bottom = new Mesh(new SphereGeometry(radius, 24, 16), createMaterial());
      bottom.position.y = -midHeight / 2;
      group.add(bottom);

      return group;
    },
    (definition) => definition.dimensions.radius + definition.dimensions.height / 2,
    (definition) => definition.dimensions.height / 2,
  );

  return registry;
}
