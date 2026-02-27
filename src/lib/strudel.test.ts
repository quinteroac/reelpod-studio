import { describe, expect, it, vi } from 'vitest';
import {
  AudioBlockedError,
  AudioSupportError,
  SilentOutputError,
  createStrudelController,
  getUserFriendlyError
} from './strudel';
import type { StrudelReplEngine, StrudelRuntime } from './strudel';

function createEngine(overrides: Partial<StrudelReplEngine> = {}): StrudelReplEngine {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ audible: true }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function createRuntime(
  engine: StrudelReplEngine,
  overrides: Partial<StrudelRuntime> = {}
): Required<StrudelRuntime> {
  return {
    hasWebAudioSupport: () => true,
    resolveEngine: () => engine,
    ...overrides
  };
}

describe('createStrudelController', () => {
  it('creates controller without eagerly resolving engine', () => {
    const resolveEngine = vi.fn().mockImplementation(() => {
      throw new Error('Strudel REPL is not available.');
    });

    expect(() =>
      createStrudelController({
        hasWebAudioSupport: () => true,
        resolveEngine
      })
    ).not.toThrow();
    expect(resolveEngine).not.toHaveBeenCalled();
  });

  it('throws a support error when Web Audio is unavailable', async () => {
    const controller = createStrudelController(createRuntime(createEngine(), { hasWebAudioSupport: () => false }));
    await expect(controller.generate('pattern')).rejects.toBeInstanceOf(AudioSupportError);
  });

  it('throws autoplay-blocked error when init fails due to browser policy', async () => {
    const engine = createEngine({ init: vi.fn().mockRejectedValue(new Error('NotAllowedError: autoplay blocked')) });
    const controller = createStrudelController(createRuntime(engine));

    await expect(controller.generate('pattern')).rejects.toBeInstanceOf(AudioBlockedError);
  });

  it('throws silent output error when execute returns no audible output', async () => {
    const engine = createEngine({ execute: vi.fn().mockResolvedValue({ audible: false }) });
    const controller = createStrudelController(createRuntime(engine));

    await expect(controller.generate('pattern')).rejects.toBeInstanceOf(SilentOutputError);
  });

  it('throws when the runtime cannot resolve a REPL engine', async () => {
    const controller = createStrudelController({
      hasWebAudioSupport: () => true,
      resolveEngine: () => {
        throw new Error('Strudel REPL is not available.');
      }
    });

    await expect(controller.generate('pattern')).rejects.toThrow('Strudel REPL is not available.');
  });

  it('forwards playback controls to the resolved engine', async () => {
    const engine = createEngine();
    const controller = createStrudelController(
      createRuntime(engine, {
        resolveEngine: vi.fn().mockReturnValue(engine)
      })
    );

    await controller.play();
    await controller.pause();
    await controller.seek(10);

    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(10);
  });

  it('maps specialized errors into actionable messages', () => {
    expect(getUserFriendlyError(new AudioSupportError())).toContain('does not support Web Audio');
    expect(getUserFriendlyError(new AudioBlockedError())).toContain('autoplay policy');
    expect(getUserFriendlyError(new SilentOutputError())).toContain('no audible output');
  });
});
