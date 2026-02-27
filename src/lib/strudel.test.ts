import { describe, expect, it, vi } from 'vitest';
import {
  AudioBlockedError,
  AudioSupportError,
  SilentOutputError,
  createStrudelController,
  getUserFriendlyError,
  type StrudelReplEngine
} from './strudel';

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

function withWebAudioSupport(): () => void {
  const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');
  Object.defineProperty(window, 'AudioContext', { value: function AudioContext() {}, configurable: true });

  return () => {
    if (originalAudioContext) {
      Object.defineProperty(window, 'AudioContext', originalAudioContext);
    }
  };
}

describe('createStrudelController', () => {
  it('throws a support error when Web Audio is unavailable', async () => {
    const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    const originalWebkitAudioContext = Object.getOwnPropertyDescriptor(window, 'webkitAudioContext');

    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true });

    const controller = createStrudelController(createEngine());
    await expect(controller.generate('pattern')).rejects.toBeInstanceOf(AudioSupportError);

    if (originalAudioContext) {
      Object.defineProperty(window, 'AudioContext', originalAudioContext);
    }

    if (originalWebkitAudioContext) {
      Object.defineProperty(window, 'webkitAudioContext', originalWebkitAudioContext);
    }
  });

  it('throws autoplay-blocked error when init fails due to browser policy', async () => {
    const restore = withWebAudioSupport();
    const controller = createStrudelController(
      createEngine({ init: vi.fn().mockRejectedValue(new Error('NotAllowedError: autoplay blocked')) })
    );

    await expect(controller.generate('pattern')).rejects.toBeInstanceOf(AudioBlockedError);
    restore();
  });

  it('throws silent output error when execute returns no audible output', async () => {
    const restore = withWebAudioSupport();
    const controller = createStrudelController(createEngine({ execute: vi.fn().mockResolvedValue({ audible: false }) }));

    await expect(controller.generate('pattern')).rejects.toBeInstanceOf(SilentOutputError);
    restore();
  });

  it('maps specialized errors into actionable messages', () => {
    expect(getUserFriendlyError(new AudioSupportError())).toContain('does not support Web Audio');
    expect(getUserFriendlyError(new AudioBlockedError())).toContain('autoplay policy');
    expect(getUserFriendlyError(new SilentOutputError())).toContain('no audible output');
  });
});
