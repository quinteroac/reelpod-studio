import { useEffect, useMemo, useState } from 'react';
import { generatePattern, type GenerationParams, type Mood, type Style } from './lib/pattern-generator';
import { createBrowserStrudelController } from './lib/strudel-adapter';
import { getUserFriendlyError, type StrudelController } from './lib/strudel';

type GenerationStatus = 'idle' | 'loading' | 'success' | 'error';

const defaultParams: GenerationParams = {
  mood: 'chill',
  tempo: 80,
  style: 'jazz'
};
const SEEK_MIN = 0;
const SEEK_MAX = 100;
const SEEK_STEP = 1;
const SEEK_POLL_INTERVAL_MS = 500;

interface AppProps {
  controller?: StrudelController;
}

export function App({ controller }: AppProps) {
  const strudelController = useMemo(() => controller ?? createBrowserStrudelController(), [controller]);
  const [params, setParams] = useState<GenerationParams>(defaultParams);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasGeneratedTrack, setHasGeneratedTrack] = useState(false);
  const [seekPosition, setSeekPosition] = useState(SEEK_MIN);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!hasGeneratedTrack || !isPlaying) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSeekPosition((prev) => Math.min(prev + SEEK_STEP, SEEK_MAX));
    }, SEEK_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasGeneratedTrack, isPlaying]);

  async function handleGenerate(): Promise<void> {
    if (status === 'loading') {
      return;
    }

    setStatus('loading');
    setErrorMessage(null);

    try {
      const pattern = generatePattern(params);
      await strudelController.generate(pattern);
      setStatus('success');
      setHasGeneratedTrack(true);
      setSeekPosition(SEEK_MIN);
      setIsPlaying(true);
      setErrorMessage(null);
    } catch (error) {
      setStatus('error');
      setErrorMessage(getUserFriendlyError(error));
    }
  }

  async function handlePlay(): Promise<void> {
    await strudelController.play();
    setIsPlaying(true);
  }

  async function handlePause(): Promise<void> {
    await strudelController.pause();
    setIsPlaying(false);
  }

  function handleSeekChange(position: number): void {
    setSeekPosition(position);
    void strudelController.seek(position);
  }

  return (
    <main className="min-h-screen bg-lofi-bg px-6 py-10 text-lofi-text">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="font-serif text-4xl font-bold text-lofi-text">Lofi Maker</h1>
          <p className="text-sm text-stone-300">Generate warm, mellow loops in your browser.</p>
        </header>

        <section aria-label="Generation parameters" className="grid gap-3 rounded-lg bg-lofi-panel p-4">
          <label htmlFor="mood">Mood</label>
        <select
          id="mood"
          className="rounded-md border border-stone-500 bg-stone-900 px-2 py-1 text-lofi-text"
          value={params.mood}
          onChange={(event) => setParams((prev) => ({ ...prev, mood: event.target.value as Mood }))}
          disabled={status === 'loading'}
        >
          <option value="chill">chill</option>
          <option value="melancholic">melancholic</option>
          <option value="upbeat">upbeat</option>
        </select>

        <label htmlFor="tempo">Tempo (BPM)</label>
        <input
          id="tempo"
          type="range"
          className="accent-lofi-accent"
          min={60}
          max={120}
          value={params.tempo}
          onChange={(event) =>
            setParams((prev) => ({
              ...prev,
              tempo: Number(event.target.value)
            }))
          }
          disabled={status === 'loading'}
        />
        <output htmlFor="tempo">{params.tempo}</output>

        <label htmlFor="style">Style</label>
        <select
          id="style"
          className="rounded-md border border-stone-500 bg-stone-900 px-2 py-1 text-lofi-text"
          value={params.style}
          onChange={(event) => setParams((prev) => ({ ...prev, style: event.target.value as Style }))}
          disabled={status === 'loading'}
        >
          <option value="jazz">jazz</option>
          <option value="hip-hop">hip-hop</option>
          <option value="ambient">ambient</option>
        </select>
        </section>

        <section aria-label="Generation actions" className="space-y-3 rounded-lg bg-lofi-panel p-4">
          <button
            type="button"
            className="rounded-md bg-lofi-accent px-4 py-2 font-semibold text-stone-950 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleGenerate()}
            disabled={status === 'loading'}
          >
            Generate
          </button>

          {status === 'loading' && <p role="status">Generating track...</p>}

          {errorMessage && (
            <div className="space-y-2">
              <p role="alert">{errorMessage}</p>
              <button
                type="button"
                className="rounded-md border border-lofi-accent px-3 py-1 text-lofi-text"
                onClick={() => void handleGenerate()}
              >
                Retry
              </button>
            </div>
          )}
        </section>

        {hasGeneratedTrack && (
          <section aria-label="Playback controls" className="grid gap-3 rounded-lg bg-lofi-panel p-4">
            <button
              type="button"
              className="rounded-md border border-lofi-accent px-3 py-2 text-lofi-text disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handlePlay()}
              disabled={isPlaying}
              aria-pressed={isPlaying}
            >
              Play
            </button>
            <button
              type="button"
              className="rounded-md border border-lofi-accent px-3 py-2 text-lofi-text disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handlePause()}
              disabled={!isPlaying}
              aria-pressed={!isPlaying}
            >
              Pause
            </button>
            <label htmlFor="seek">Seek</label>
            <input
              id="seek"
              className="accent-lofi-accent"
              type="range"
              min={SEEK_MIN}
              max={SEEK_MAX}
              value={seekPosition}
              onChange={(event) => handleSeekChange(Number(event.target.value))}
            />
          </section>
        )}
      </div>
    </main>
  );
}
