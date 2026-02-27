class AudioSupportError extends Error {
  constructor(message = 'Web Audio API is not supported in this browser.') {
    super(message);
    this.name = 'AudioSupportError';
  }
}

class AudioBlockedError extends Error {
  constructor(message = 'Audio playback was blocked by the browser autoplay policy.') {
    super(message);
    this.name = 'AudioBlockedError';
  }
}

class SilentOutputError extends Error {
  constructor(message = 'Generation succeeded but no audible output was produced.') {
    super(message);
    this.name = 'SilentOutputError';
  }
}

export interface StrudelExecuteResult {
  audible: boolean;
}

export interface StrudelReplEngine {
  init: () => Promise<void>;
  execute: (pattern: string) => Promise<StrudelExecuteResult>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (position: number) => Promise<void>;
}

export interface StrudelController {
  generate: (pattern: string) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (position: number) => Promise<void>;
}

export interface StrudelRuntime {
  hasWebAudioSupport: () => boolean;
  resolveEngine: () => StrudelReplEngine;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error('Unknown REPL error');
}

function missingEngine(): StrudelReplEngine {
  throw new Error('Strudel REPL is not available.');
}

function toUserFacingError(error: unknown): Error {
  if (error instanceof AudioSupportError) {
    return new Error(
      'This browser does not support Web Audio. Try a modern browser such as Chrome, Edge, or Firefox.'
    );
  }

  if (error instanceof AudioBlockedError) {
    return new Error(
      'Audio is blocked by autoplay policy. Click Generate after interacting with the page, and allow sound if prompted.'
    );
  }

  if (error instanceof SilentOutputError) {
    return new Error(
      'Track generation completed, but no audible output was produced. Please retry with different settings.'
    );
  }

  const normalized = normalizeError(error);
  return new Error(`Could not generate track: ${normalized.message}`);
}

export function createStrudelController(runtime: Partial<StrudelRuntime> = {}): StrudelController {
  const hasWebAudioSupport = runtime.hasWebAudioSupport ?? (() => false);
  const resolveEngine = runtime.resolveEngine ?? missingEngine;

  return {
    async generate(pattern: string): Promise<void> {
      try {
        if (!hasWebAudioSupport()) {
          throw new AudioSupportError();
        }

        const activeEngine = resolveEngine();

        try {
          await activeEngine.init();
        } catch (error) {
          const normalized = normalizeError(error);
          if (/autoplay|gesture|notallowed/i.test(normalized.message)) {
            throw new AudioBlockedError();
          }

          throw normalized;
        }

        const result = await activeEngine.execute(pattern);
        if (!result.audible) {
          throw new SilentOutputError();
        }
      } catch (error) {
        throw toUserFacingError(error);
      }
    },
    async play(): Promise<void> {
      try {
        await resolveEngine().play();
      } catch (error) {
        throw toUserFacingError(error);
      }
    },
    async pause(): Promise<void> {
      try {
        await resolveEngine().pause();
      } catch (error) {
        throw toUserFacingError(error);
      }
    },
    async seek(position: number): Promise<void> {
      try {
        await resolveEngine().seek(position);
      } catch (error) {
        throw toUserFacingError(error);
      }
    }
  };
}
