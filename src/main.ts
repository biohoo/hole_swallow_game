import "./style.css";

import { AudioBus } from "./game/audio";
import { GameSession } from "./game/GameSession";
import { InputController } from "./game/input";
import { GameRenderer } from "./game/renderer";
import { createDefaultShapeRegistry } from "./game/shapeRegistry";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

app.innerHTML = `
  <div class="app-shell">
    <div id="game-root"></div>
    <div class="hud">
      <div class="hud-top">
        <section class="hud-card dark">
          <span class="eyebrow">Demo Arena</span>
          <h1 class="hud-title" id="hud-title">Loading...</h1>
          <p class="hud-copy" id="hud-copy">Preparing the swallow sandbox.</p>
          <p class="hud-meta" id="hud-meta">Arrow keys move the hole.</p>
          <div class="meter"><div class="meter-fill" id="hud-progress-fill"></div></div>
        </section>
        <section class="hud-card light">
          <span class="eyebrow">Current Growth</span>
          <h2 class="hud-title" id="hud-tier">Tier</h2>
          <p class="hud-copy" id="hud-score">Score 0</p>
          <p class="hud-copy" id="hud-radius">Radius 0.00</p>
        </section>
      </div>
      <div class="hud-bottom">
        <div class="chip" id="hud-progress">Cleared 0%</div>
        <div class="chip" id="hud-objects">0 / 0 objects</div>
        <div class="chip">Arrow keys to move</div>
        <div class="chip">R to restart</div>
      </div>
      <div class="overlay visible" id="hud-overlay">
        <h2 id="hud-overlay-title">Starting arena</h2>
        <p id="hud-overlay-copy">Use the arrow keys to sweep up the smallest shapes first.</p>
      </div>
      <div class="status-banner" id="hud-banner">Loading</div>
    </div>
  </div>
`;

const gameRoot = document.querySelector<HTMLDivElement>("#game-root");

if (!gameRoot) {
  throw new Error("Missing #game-root container.");
}

const titleEl = document.querySelector<HTMLElement>("#hud-title")!;
const copyEl = document.querySelector<HTMLElement>("#hud-copy")!;
const metaEl = document.querySelector<HTMLElement>("#hud-meta")!;
const progressFillEl = document.querySelector<HTMLElement>("#hud-progress-fill")!;
const tierEl = document.querySelector<HTMLElement>("#hud-tier")!;
const scoreEl = document.querySelector<HTMLElement>("#hud-score")!;
const radiusEl = document.querySelector<HTMLElement>("#hud-radius")!;
const progressEl = document.querySelector<HTMLElement>("#hud-progress")!;
const objectsEl = document.querySelector<HTMLElement>("#hud-objects")!;
const overlayEl = document.querySelector<HTMLElement>("#hud-overlay")!;
const overlayTitleEl = document.querySelector<HTMLElement>("#hud-overlay-title")!;
const overlayCopyEl = document.querySelector<HTMLElement>("#hud-overlay-copy")!;
const bannerEl = document.querySelector<HTMLElement>("#hud-banner")!;

const input = new InputController(window);
const audio = new AudioBus();
const registry = createDefaultShapeRegistry();
const session = new GameSession({ audioBus: audio, shapeRegistry: registry });
const renderer = new GameRenderer({
  container: gameRoot,
  registry,
});

let overlayDismissed = false;
let restartInFlight = false;

function syncHud() {
  const state = session.getState();

  if (state.isLoading) {
    bannerEl.hidden = false;
    bannerEl.textContent = "Loading";
    return;
  }

  if (state.errorMessage) {
    bannerEl.hidden = false;
    bannerEl.textContent = "Load Error";
    overlayEl.classList.add("visible");
    overlayTitleEl.textContent = "Something broke";
    overlayCopyEl.textContent = state.errorMessage;
    return;
  }

  bannerEl.hidden = true;
  const currentProgressPercent = Math.round(state.progressRatio * 100);
  const targetProgressPercent = Math.round(state.progressTarget * 100);
  titleEl.textContent = state.levelTitle;
  copyEl.textContent = state.tutorialText ?? "Swallow enough shapes to clear the arena.";
  metaEl.textContent = `${state.progressTargetLabel}: ${currentProgressPercent}% • Target ${targetProgressPercent}%`;
  tierEl.textContent = state.hole.tierLabel;
  scoreEl.textContent = `Score ${state.score}`;
  radiusEl.textContent = `Radius ${state.hole.radius.toFixed(2)}`;
  progressEl.textContent = `Cleared ${currentProgressPercent}%`;
  progressFillEl.style.width = `${Math.min(100, state.progressRatio * 100)}%`;
  objectsEl.textContent = `${state.consumedCount} / ${state.totalCount} objects`;

  if (state.isComplete) {
    overlayEl.classList.add("visible");
    overlayTitleEl.textContent = "Arena cleared";
    overlayCopyEl.textContent = "You hit the completion target. Press R to restart the demo level.";
    return;
  }

  if (!overlayDismissed) {
    overlayEl.classList.add("visible");
    overlayTitleEl.textContent = "Starter objective";
    overlayCopyEl.textContent =
      state.tutorialText ?? "Use the arrow keys to swallow the smallest shapes and grow.";
  } else {
    overlayEl.classList.remove("visible");
  }
}

audio.on("onSwallow", () => {
  overlayDismissed = true;
});

audio.on("onLevelComplete", () => {
  overlayDismissed = true;
});

async function boot() {
  await session.start("demo-01");
  syncHud();
}

void boot();

let lastTime = performance.now();

async function restartLevel() {
  if (restartInFlight) {
    return;
  }

  restartInFlight = true;
  overlayDismissed = false;

  try {
    await session.start(session.getState().levelId || "demo-01");
  } finally {
    restartInFlight = false;
  }
}

function frame(time: number) {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  if (input.consumeRestartPressed()) {
    void restartLevel();
  }

  if (!restartInFlight) {
    session.update(dt, input.getState());
  }

  renderer.render(session.getState());
  syncHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
