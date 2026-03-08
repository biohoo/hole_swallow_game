import type { AudioEventName, AudioEventPayload } from "./types";

type Listener = (payload: AudioEventPayload) => void;

export class AudioBus {
  private listeners = new Map<AudioEventName, Set<Listener>>();

  on(eventName: AudioEventName, listener: Listener): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);

    return () => {
      listeners.delete(listener);
    };
  }

  emit(eventName: AudioEventName, payload: AudioEventPayload = {}): void {
    const listeners = this.listeners.get(eventName);

    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  }
}
