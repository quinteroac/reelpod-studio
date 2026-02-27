import { evaluate, hush, initStrudel, samples } from '@strudel/web';
import type { StrudelReplEngine } from './strudel';

class StrudelWebReplEngine implements StrudelReplEngine {
  private initPromise: Promise<void> | null = null;
  private activePattern: string | null = null;

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = Promise.resolve(
        initStrudel({ prebake: () => samples('github:tidalcycles/dirt-samples') })
      ).then(() => undefined);
    }

    return this.initPromise;
  }

  async execute(pattern: string): Promise<{ audible: boolean }> {
    await this.init();
    this.activePattern = pattern;
    evaluate(`${pattern}.play()`);

    return { audible: true };
  }

  async play(): Promise<void> {
    await this.init();
    if (!this.activePattern) {
      return;
    }

    evaluate(`${this.activePattern}.play()`);
  }

  async pause(): Promise<void> {
    await this.init();
    hush();
  }

  async seek(_position: number): Promise<void> {
    // Strudel's public browser API does not expose timeline seek; restart the current pattern.
    await this.pause();
    await this.play();
  }
}

let engine: StrudelReplEngine | null = null;

export function bootstrapStrudelRepl(): Promise<void> {
  if (!engine) {
    engine = new StrudelWebReplEngine();
  }

  window.__strudelRepl = engine;

  return engine.init();
}
