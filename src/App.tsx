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
    <main>
      <h1>Lofi Maker</h1>

      <section aria-label="Generation parameters">
        <label htmlFor="mood">Mood</label>
        <select
          id="mood"
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
          value={params.style}
          onChange={(event) => setParams((prev) => ({ ...prev, style: event.target.value as Style }))}
          disabled={status === 'loading'}
        >
          <option value="jazz">jazz</option>
          <option value="hip-hop">hip-hop</option>
          <option value="ambient">ambient</option>
        </select>
      </section>

      <section aria-label="Generation actions">
        <button type="button" onClick={() => void handleGenerate()} disabled={status === 'loading'}>
          Generate
        </button>

        {status === 'loading' && <p role="status">Generating track...</p>}

        {errorMessage && (
          <div>
            <p role="alert">{errorMessage}</p>
            <button type="button" onClick={() => void handleGenerate()}>
              Retry
            </button>
          </div>
        )}
      </section>

      {hasGeneratedTrack && (
        <section aria-label="Playback controls">
          <button type="button" onClick={() => void handlePlay()} disabled={isPlaying} aria-pressed={isPlaying}>
            Play
          </button>
          <button type="button" onClick={() => void handlePause()} disabled={!isPlaying} aria-pressed={!isPlaying}>
            Pause
          </button>
          <label htmlFor="seek">Seek</label>
          <input
            id="seek"
            type="range"
            min={SEEK_MIN}
            max={SEEK_MAX}
            value={seekPosition}
            onChange={(event) => handleSeekChange(Number(event.target.value))}
          />
        </section>
      )}
    </main>
  );
}
