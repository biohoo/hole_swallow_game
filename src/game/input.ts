import type { InputState } from "./types";

const CONTROLLED_CODES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyR"]);

export class InputController {
  private readonly state: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  private restartPressed = false;

  constructor(private readonly target: Window) {
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
  }

  getState(): InputState {
    return { ...this.state };
  }

  consumeRestartPressed(): boolean {
    const wasPressed = this.restartPressed;
    this.restartPressed = false;
    return wasPressed;
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (CONTROLLED_CODES.has(event.code)) {
      event.preventDefault();
    }

    switch (event.code) {
      case "ArrowUp":
        this.state.up = true;
        break;
      case "ArrowDown":
        this.state.down = true;
        break;
      case "ArrowLeft":
        this.state.left = true;
        break;
      case "ArrowRight":
        this.state.right = true;
        break;
      case "KeyR":
        if (!event.repeat) {
          this.restartPressed = true;
        }
        break;
      default:
        break;
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (CONTROLLED_CODES.has(event.code)) {
      event.preventDefault();
    }

    switch (event.code) {
      case "ArrowUp":
        this.state.up = false;
        break;
      case "ArrowDown":
        this.state.down = false;
        break;
      case "ArrowLeft":
        this.state.left = false;
        break;
      case "ArrowRight":
        this.state.right = false;
        break;
      default:
        break;
    }
  };
}
