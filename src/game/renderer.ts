import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  PCFSoftShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

import { canObjectFitInsideHole } from "./simulation";
import type { ShapeRegistry } from "./shapeRegistry";
import type { GameState, MaterialPreset, RuntimeObjectState } from "./types";

interface GameRendererOptions {
  container: HTMLElement;
  registry: ShapeRegistry;
}

const PRESET_COLORS: Record<MaterialPreset, string> = {
  tiny: "#7eb37b",
  medium: "#eca24b",
  large: "#cf7a5f",
  locked: "#6e7f8e",
  neutral: "#cfd9c5",
};

export class GameRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 100);
  private readonly arenaGroup = new Group();
  private readonly objectGroup = new Group();
  private readonly holeGroup = new Group();
  private readonly holeMesh = new Mesh(
    new CircleGeometry(1, 48),
    new MeshBasicMaterial({ color: "#0d100f" }),
  );
  private readonly holeRim = new Mesh(
    new RingGeometry(1.05, 1.2, 48),
    new MeshBasicMaterial({ color: "#425047", transparent: true, opacity: 0.9 }),
  );
  private readonly cameraLookAt = new Vector3();
  private readonly cameraTarget = new Vector3();
  private readonly sun = new DirectionalLight("#fff7e8", 1.1);
  private readonly objectMap = new Map<string, Object3D>();
  private readonly objectMaterials = new Map<string, MeshStandardMaterial[]>();
  private currentLevelId = "";
  private lastStateTime = performance.now();

  constructor(private readonly options: GameRendererOptions) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = "game-canvas";
    this.options.container.appendChild(this.renderer.domElement);

    this.scene.add(this.arenaGroup);
    this.scene.add(this.objectGroup);
    this.scene.add(this.holeGroup);

    this.holeMesh.rotation.x = -Math.PI / 2;
    this.holeRim.rotation.x = -Math.PI / 2;
    this.holeGroup.add(this.holeMesh);
    this.holeGroup.add(this.holeRim);

    this.scene.add(new AmbientLight("#fff7e8", 0.8));
    this.sun.position.set(8, 14, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 35;
    this.sun.shadow.camera.left = -18;
    this.sun.shadow.camera.right = 18;
    this.sun.shadow.camera.top = 18;
    this.sun.shadow.camera.bottom = -18;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.background = new Color("#dbe7cf");

    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  render(state: GameState): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastStateTime) / 1000);
    this.lastStateTime = now;

    if (state.errorMessage) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (!state.isLoading && state.config && state.arena && state.levelId !== this.currentLevelId) {
      this.currentLevelId = state.levelId;
      this.rebuildArena(state);
    }

    if (!state.isLoading && state.config && state.arena) {
      this.syncObjects(state);
      this.syncHole(state);
      this.syncCamera(state, dt);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private rebuildArena(state: GameState): void {
    this.arenaGroup.clear();
    this.objectGroup.clear();
    this.objectMap.clear();
    this.objectMaterials.clear();

    const theme = state.config!.arenaTheme;
    this.scene.background = new Color(theme.floorColor);

    const floor = new Mesh(
      new PlaneGeometry(state.arena!.width, state.arena!.depth),
      new MeshStandardMaterial({
        color: theme.floorColor,
        roughness: 1,
        metalness: 0,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.arenaGroup.add(floor);

    const grid = new GridHelper(
      Math.max(state.arena!.width, state.arena!.depth),
      Math.max(state.arena!.width, state.arena!.depth),
      theme.gridColor,
      theme.gridColor,
    );
    grid.position.y = 0.01;
    (grid.material as MeshBasicMaterial).opacity = 0.3;
    (grid.material as MeshBasicMaterial).transparent = true;
    this.arenaGroup.add(grid);

    const wallThickness = theme.wallThickness;
    const wallHeight = theme.wallHeight;
    const wallMaterial = new MeshStandardMaterial({
      color: theme.wallColor,
      roughness: 0.95,
    });

    const wallNorth = new Mesh(
      new BoxGeometry(state.arena!.width + wallThickness * 2, wallHeight, wallThickness),
      wallMaterial,
    );
    wallNorth.position.set(0, wallHeight / 2, -(state.arena!.depth / 2 + wallThickness / 2));
    wallNorth.castShadow = true;
    wallNorth.receiveShadow = true;
    this.arenaGroup.add(wallNorth);

    const wallSouth = wallNorth.clone();
    wallSouth.position.z = state.arena!.depth / 2 + wallThickness / 2;
    this.arenaGroup.add(wallSouth);

    const wallEast = new Mesh(
      new BoxGeometry(wallThickness, wallHeight, state.arena!.depth),
      wallMaterial,
    );
    wallEast.position.set(state.arena!.width / 2 + wallThickness / 2, wallHeight / 2, 0);
    wallEast.castShadow = true;
    wallEast.receiveShadow = true;
    this.arenaGroup.add(wallEast);

    const wallWest = wallEast.clone();
    wallWest.position.x = -(state.arena!.width / 2 + wallThickness / 2);
    this.arenaGroup.add(wallWest);
  }

  private syncObjects(state: GameState): void {
    const liveIds = new Set(state.objects.map((object) => object.instanceId));

    for (const [instanceId, object3d] of this.objectMap.entries()) {
      if (!liveIds.has(instanceId)) {
        this.objectGroup.remove(object3d);
        this.objectMap.delete(instanceId);
        this.objectMaterials.delete(instanceId);
      }
    }

    for (const object of state.objects) {
      if (!this.objectMap.has(object.instanceId)) {
        const object3d = this.createObjectMesh(object);
        this.objectMap.set(object.instanceId, object3d);
        this.objectGroup.add(object3d);
      }

      const object3d = this.objectMap.get(object.instanceId)!;
      const materials = this.objectMaterials.get(object.instanceId) ?? [];
      const swallowOffset = object.swallowing ? object.swallowProgress * 1.2 : 0;
      const scale = object.scale * (object.swallowing ? 1 - object.swallowProgress * 0.65 : 1);
      const shakeOffset = this.getBlockedShakeOffset(object, state);

      object3d.position.set(
        object.position[0] + shakeOffset.x,
        object.position[1] - swallowOffset,
        object.position[2] + shakeOffset.z,
      );
      object3d.rotation.set(object.rotation[0], object.rotation[1], object.rotation[2]);
      object3d.scale.setScalar(scale);
      object3d.visible = !object.consumed;

      const blockedPulse =
        object.blockedFeedback > 0
          ? 0.45 +
            (object.blockedFeedback / state.config!.swallow.blockedPulseDuration) * 0.65
          : 0;
      const eligible = canObjectFitInsideHole(
        state.hole.radius,
        object.fitRadius,
        state.config!.swallow.fitClearanceMultiplier,
      );

      for (const material of materials) {
        const baseColor = new Color(
          eligible ? PRESET_COLORS[object.materialPreset] : PRESET_COLORS.locked,
        );
        material.color.copy(baseColor);
        material.emissive.copy(new Color("#fff4c6"));
        material.emissiveIntensity = blockedPulse;
        material.opacity = object.swallowing ? 1 - object.swallowProgress * 0.75 : 1;
        material.transparent = object.swallowing;
      }
    }
  }

  private syncHole(state: GameState): void {
    const y = state.config!.hole.verticalOffset;
    this.holeGroup.position.set(state.hole.position[0], y, state.hole.position[1]);
    this.holeGroup.scale.setScalar(state.hole.radius);
  }

  private syncCamera(state: GameState, dt: number): void {
    const [offsetX, offsetY, offsetZ] = state.config!.camera.offset;
    this.cameraTarget.set(
      state.hole.position[0] + offsetX,
      offsetY,
      state.hole.position[1] + offsetZ,
    );
    const smoothingAlpha = 1 - Math.exp(-state.config!.camera.smoothing * dt);
    this.camera.position.lerp(this.cameraTarget, smoothingAlpha);

    this.cameraLookAt.set(
      state.hole.position[0],
      state.config!.camera.lookAtHeight,
      state.hole.position[1],
    );
    this.camera.lookAt(this.cameraLookAt);
    this.sun.position.set(
      state.hole.position[0] + 8,
      14,
      state.hole.position[1] + 6,
    );
    this.sun.target.position.copy(this.cameraLookAt);
    this.sun.target.updateMatrixWorld();
  }

  private createObjectMesh(object: RuntimeObjectState): Object3D {
    const materials: MeshStandardMaterial[] = [];
    const object3d = this.options.registry.createObject(object.shapeDefinition, () => {
      const material = new MeshStandardMaterial({
        color: PRESET_COLORS[object.materialPreset],
        roughness: 0.8,
        metalness: 0.05,
      });
      materials.push(material);
      return material;
    });

    object3d.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });

    this.objectMaterials.set(object.instanceId, materials);
    return object3d;
  }

  private onResize = () => {
    const { clientWidth, clientHeight } = this.options.container;
    const width = clientWidth || window.innerWidth;
    const height = clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private getBlockedShakeOffset(
    object: RuntimeObjectState,
    state: GameState,
  ): { x: number; z: number } {
    if (
      object.swallowing ||
      object.blockedShakeTime <= 0 ||
      object.blockedShakeStrength <= 0
    ) {
      return { x: 0, z: 0 };
    }

    const duration = state.config!.swallow.blockedShakeDuration;
    const progress = 1 - object.blockedShakeTime / duration;
    const envelope = Math.sin(progress * Math.PI);
    const phase = progress * state.config!.swallow.blockedShakeFrequency * Math.PI * 2;
    const sizeDamping = Math.max(0.18, Math.min(1, 1 / Math.max(1, object.fitRadius)));
    const distance =
      state.config!.swallow.blockedShakeMaxDistance *
      object.blockedShakeStrength *
      sizeDamping *
      envelope *
      Math.sin(phase);
    const direction = this.getShakeDirection(object.instanceId);

    return {
      x: direction.x * distance,
      z: direction.z * distance,
    };
  }

  private getShakeDirection(instanceId: string): { x: number; z: number } {
    let hash = 0;

    for (let index = 0; index < instanceId.length; index += 1) {
      hash = (hash * 31 + instanceId.charCodeAt(index)) >>> 0;
    }

    const angle = (hash % 360) * (Math.PI / 180);
    return {
      x: Math.cos(angle),
      z: Math.sin(angle),
    };
  }
}
