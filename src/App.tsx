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

        <section aria-label="Generation parameters" className="space-y-4 rounded-lg bg-lofi-panel p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <fieldset
              data-testid="mood-control-card"
              className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3"
            >
              <legend className="text-sm font-semibold text-lofi-text">Mood</legend>
              <label htmlFor="mood" className="sr-only">
                Mood
              </label>
              <select
                id="mood"
                className="w-full rounded-md border border-stone-500 bg-stone-900 px-2 py-2 text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                value={params.mood}
                onChange={(event) => setParams((prev) => ({ ...prev, mood: event.target.value as Mood }))}
                disabled={status === 'loading'}
              >
                <option value="chill">chill</option>
                <option value="melancholic">melancholic</option>
                <option value="upbeat">upbeat</option>
              </select>
            </fieldset>

            <fieldset
              data-testid="tempo-control-card"
              className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3"
            >
              <legend className="text-sm font-semibold text-lofi-text">Tempo</legend>
              <label htmlFor="tempo" className="sr-only">
                Tempo (BPM)
              </label>
              <input
                id="tempo"
                type="range"
                className="w-full cursor-pointer accent-lofi-accent outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-lofi-accent"
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
              <output htmlFor="tempo" className="block text-sm text-stone-300">
                {params.tempo} BPM
              </output>
            </fieldset>

            <fieldset
              data-testid="style-control-card"
              className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3"
            >
              <legend className="text-sm font-semibold text-lofi-text">Style</legend>
              <label htmlFor="style" className="sr-only">
                Style
              </label>
              <select
                id="style"
                className="w-full rounded-md border border-stone-500 bg-stone-900 px-2 py-2 text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                value={params.style}
                onChange={(event) => setParams((prev) => ({ ...prev, style: event.target.value as Style }))}
                disabled={status === 'loading'}
              >
                <option value="jazz">jazz</option>
                <option value="hip-hop">hip-hop</option>
                <option value="ambient">ambient</option>
              </select>
            </fieldset>
          </div>
        </section>

        <section aria-label="Generation actions" className="space-y-3 rounded-lg bg-lofi-panel p-4">
          <button
            type="button"
            className="w-full rounded-md bg-lofi-accent px-6 py-3 text-lg font-semibold text-stone-950 outline-none transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-lofi-text disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            onClick={() => void handleGenerate()}
            disabled={status === 'loading'}
          >
            Generate
          </button>

          {status === 'loading' && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-3 rounded-md border border-lofi-accent/60 bg-stone-900/70 px-3 py-2 text-sm font-semibold text-lofi-text"
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-lofi-accent border-t-transparent"
              />
              <span>Generating track...</span>
            </div>
          )}

          {errorMessage && (
            <div className="space-y-2 rounded-md border border-red-400/60 bg-red-950/40 p-3">
              <p role="alert" className="text-sm font-semibold leading-relaxed text-red-100">
                {errorMessage}
              </p>
              <button
                type="button"
                className="rounded-md border border-red-300/80 px-3 py-1 text-red-100 outline-none transition hover:bg-red-900/40 focus-visible:ring-2 focus-visible:ring-red-200"
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
              className="rounded-md border border-emerald-300/80 bg-emerald-500/20 px-3 py-2 font-semibold text-emerald-100 outline-none transition hover:bg-emerald-500/30 focus-visible:ring-2 focus-visible:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handlePlay()}
              disabled={isPlaying}
              aria-pressed={isPlaying}
            >
              Play
            </button>
            <button
              type="button"
              className="rounded-md border border-amber-200/90 bg-amber-400/25 px-3 py-2 font-semibold text-amber-50 outline-none transition hover:bg-amber-400/40 focus-visible:ring-2 focus-visible:ring-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handlePause()}
              disabled={!isPlaying}
              aria-pressed={!isPlaying}
            >
              Pause
            </button>
            <label htmlFor="seek">Seek</label>
            <input
              id="seek"
              className="seek-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-lofi-accent"
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
