import { useMemo, useState } from 'react';
import { generatePattern, type GenerationParams, type Mood, type Style } from './lib/pattern-generator';
import { createStrudelController, getUserFriendlyError, type StrudelController } from './lib/strudel';

type GenerationStatus = 'idle' | 'loading' | 'success' | 'error';

const defaultParams: GenerationParams = {
  mood: 'chill',
  tempo: 80,
  style: 'jazz'
};

interface AppProps {
  controller?: StrudelController;
}

export function App({ controller }: AppProps) {
  const strudelController = useMemo(() => controller ?? createStrudelController(), [controller]);
  const [params, setParams] = useState<GenerationParams>(defaultParams);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canUsePlayer = status === 'success';

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
      setErrorMessage(null);
    } catch (error) {
      setStatus('error');
      setErrorMessage(getUserFriendlyError(error));
    }
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

      <section aria-label="Playback controls">
        <button type="button" disabled={!canUsePlayer} onClick={() => void strudelController.play()}>
          Play
        </button>
        <button type="button" disabled={!canUsePlayer} onClick={() => void strudelController.pause()}>
          Pause
        </button>
        <label htmlFor="seek">Seek</label>
        <input
          id="seek"
          type="range"
          min={0}
          max={100}
          defaultValue={0}
          disabled={!canUsePlayer}
          onChange={(event) => void strudelController.seek(Number(event.target.value))}
        />
      </section>
    </main>
  );
}
