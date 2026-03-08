import type { ArenaDefinition, GameConfig, GrowthPoint, InputState } from "./types";

export interface HoleMotionState {
  position: [number, number];
  velocity: [number, number];
}

export function calculateRadiusForGrowth(
  growthCurve: GrowthPoint[],
  growth: number,
): { radius: number; tierLabel: string } {
  if (growthCurve.length === 0) {
    throw new Error("Growth curve cannot be empty.");
  }

  if (growth <= growthCurve[0].growth) {
    return {
      radius: growthCurve[0].radius,
      tierLabel: growthCurve[0].tier,
    };
  }

  for (let index = 1; index < growthCurve.length; index += 1) {
    const previous = growthCurve[index - 1];
    const current = growthCurve[index];

    if (growth <= current.growth) {
      const span = current.growth - previous.growth;
      const progress = span <= 0 ? 1 : (growth - previous.growth) / span;

      return {
        radius: previous.radius + (current.radius - previous.radius) * progress,
        tierLabel: previous.tier,
      };
    }
  }

  const finalPoint = growthCurve[growthCurve.length - 1];
  return {
    radius: finalPoint.radius,
    tierLabel: finalPoint.tier,
  };
}

export function isObjectInsideHole(
  holePosition: [number, number],
  holeRadius: number,
  objectPosition: [number, number],
  fitRadius: number,
): boolean {
  const dx = objectPosition[0] - holePosition[0];
  const dz = objectPosition[1] - holePosition[1];
  return Math.hypot(dx, dz) + fitRadius <= holeRadius;
}

export function canObjectFitInsideHole(
  holeRadius: number,
  fitRadius: number,
  fitClearanceMultiplier: number,
): boolean {
  return fitRadius <= holeRadius * fitClearanceMultiplier;
}

export function isObjectWithinAttemptRange(
  holePosition: [number, number],
  holeRadius: number,
  objectPosition: [number, number],
  fitRadius: number,
  overlapPadding: number,
): boolean {
  const dx = objectPosition[0] - holePosition[0];
  const dz = objectPosition[1] - holePosition[1];
  return Math.hypot(dx, dz) <= holeRadius + fitRadius + overlapPadding;
}

export function computeBlockedShakeStrength(
  holeRadius: number,
  fitRadius: number,
  fitClearanceMultiplier: number,
): number {
  if (fitRadius <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, (holeRadius * fitClearanceMultiplier) / fitRadius));
}

export function isObjectNearHolePlane(
  positionY: number,
  halfHeight: number,
  captureHeightTolerance: number,
): boolean {
  return positionY - halfHeight <= captureHeightTolerance;
}

export function computeCompletionRatio(consumedScore: number, totalScore: number): number {
  if (totalScore <= 0) {
    return 1;
  }

  return Math.min(1, consumedScore / totalScore);
}

export function advanceHoleMotion(
  movementConfig: GameConfig["movement"],
  arena: ArenaDefinition,
  holeRadius: number,
  holeState: HoleMotionState,
  input: InputState,
  cameraOffset: GameConfig["camera"]["offset"],
  dt: number,
): HoleMotionState {
  const horizontalInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const verticalInput = (input.up ? 1 : 0) - (input.down ? 1 : 0);

  const planarOffsetX = cameraOffset[0];
  const planarOffsetZ = cameraOffset[2];
  const planarOffsetLength = Math.hypot(planarOffsetX, planarOffsetZ);

  const forwardX = planarOffsetLength > 0 ? -planarOffsetX / planarOffsetLength : 0;
  const forwardZ = planarOffsetLength > 0 ? -planarOffsetZ / planarOffsetLength : -1;
  const rightX = -forwardZ;
  const rightZ = forwardX;

  const directionX = horizontalInput * rightX + verticalInput * forwardX;
  const directionZ = horizontalInput * rightZ + verticalInput * forwardZ;

  let velocityX = holeState.velocity[0];
  let velocityZ = holeState.velocity[1];

  if (directionX !== 0 || directionZ !== 0) {
    const length = Math.hypot(directionX, directionZ);
    const normalizedX = directionX / length;
    const normalizedZ = directionZ / length;

    velocityX += normalizedX * movementConfig.acceleration * dt;
    velocityZ += normalizedZ * movementConfig.acceleration * dt;

    const speed = Math.hypot(velocityX, velocityZ);
    if (speed > movementConfig.maxSpeed) {
      const ratio = movementConfig.maxSpeed / speed;
      velocityX *= ratio;
      velocityZ *= ratio;
    }
  } else {
    const damping = Math.max(0, 1 - movementConfig.friction * dt);
    velocityX *= damping;
    velocityZ *= damping;

    if (Math.abs(velocityX) < 0.01) {
      velocityX = 0;
    }

    if (Math.abs(velocityZ) < 0.01) {
      velocityZ = 0;
    }
  }

  const halfWidth = arena.width / 2 - holeRadius;
  const halfDepth = arena.depth / 2 - holeRadius;

  let positionX = holeState.position[0] + velocityX * dt;
  let positionZ = holeState.position[1] + velocityZ * dt;

  if (positionX < -halfWidth) {
    positionX = -halfWidth;
    velocityX = Math.max(0, velocityX);
  }

  if (positionX > halfWidth) {
    positionX = halfWidth;
    velocityX = Math.min(0, velocityX);
  }

  if (positionZ < -halfDepth) {
    positionZ = -halfDepth;
    velocityZ = Math.max(0, velocityZ);
  }

  if (positionZ > halfDepth) {
    positionZ = halfDepth;
    velocityZ = Math.min(0, velocityZ);
  }

  return {
    position: [positionX, positionZ],
    velocity: [velocityX, velocityZ],
  };
}
