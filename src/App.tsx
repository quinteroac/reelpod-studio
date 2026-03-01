import { useCallback, useEffect, useRef, useState } from 'react';

type Mood = 'chill' | 'melancholic' | 'upbeat';
type Style = 'jazz' | 'hip-hop' | 'ambient';
type GenerationMode = 'text' | 'text-and-parameters' | 'parameters';
type SocialFormatId = 'youtube' | 'tiktok-reels' | 'instagram-square';

interface SocialFormatPreset {
  id: SocialFormatId;
  label: string;
  aspectRatio: number;
  width: number;
  height: number;
}

interface GenerationParams {
  mood: Mood;
  tempo: number;
  style: Style;
  duration: number;
  mode?: GenerationMode;
  prompt?: string;
}
import {
  GENERATE_ENDPOINT_PATH,
  GENERATE_IMAGE_ENDPOINT_PATH
} from './api/constants';
import { VisualScene } from './components/visual-scene';
import type { VisualizerType } from './components/visualizers';

type GenerationStatus = 'idle' | 'loading' | 'success' | 'error';
type QueueEntryStatus = 'queued' | 'generating' | 'completed' | 'failed';

interface QueueEntry {
  id: number;
  params: GenerationParams;
  imagePrompt: string;
  targetWidth: number;
  targetHeight: number;
  status: QueueEntryStatus;
  errorMessage: string | null;
  audioUrl: string | null;
  imageUrl: string | null;
}

const defaultParams: GenerationParams = {
  mood: 'chill',
  tempo: 80,
  style: 'jazz',
  duration: 40
};
const generationModeOptions: ReadonlyArray<{
  value: GenerationMode;
  label: string;
}> = [
  { value: 'text', label: 'Text' },
  { value: 'text-and-parameters', label: 'Text + Parameters' },
  { value: 'parameters', label: 'Parameters' }
];
const socialFormatOptions: ReadonlyArray<SocialFormatPreset> = [
  {
    id: 'youtube',
    label: 'YouTube (16:9 · 1920×1080)',
    aspectRatio: 16 / 9,
    width: 1920,
    height: 1080
  },
  {
    id: 'tiktok-reels',
    label: 'TikTok/Reels (9:16 · 1080×1920)',
    aspectRatio: 9 / 16,
    width: 1080,
    height: 1920
  },
  {
    id: 'instagram-square',
    label: 'Instagram Square (1:1 · 1080×1080)',
    aspectRatio: 1,
    width: 1080,
    height: 1080
  }
];
const defaultSocialFormatId: SocialFormatId = 'youtube';
const visualizerOptions: ReadonlyArray<{
  value: VisualizerType;
  label: string;
}> = [
  { value: 'waveform', label: 'waveform' },
  { value: 'rain', label: 'rain' },
  { value: 'scene-rain', label: 'scene-rain' },
  { value: 'starfield', label: 'starfield' },
  { value: 'aurora', label: 'aurora' },
  { value: 'circle-spectrum', label: 'circle-spectrum' },
  { value: 'glitch', label: 'glitch' },
  { value: 'smoke', label: 'smoke' },
  { value: 'contour', label: 'contour' },
  { value: 'none', label: 'none' }
];
const SEEK_MIN = 0;
const SEEK_MAX = 100;
const SEEK_POLL_INTERVAL_MS = 500;
const TEXT_PROMPT_MAX_SUMMARY_CHARS = 60;
const TEXT_MODE_DEFAULT_TEMPO = 80;
const DURATION_MIN_SECONDS = 40;
const DURATION_MAX_SECONDS = 300;
const MUSIC_PROMPT_REQUIRED_ERROR = 'Please enter a music prompt.';
const DURATION_RANGE_ERROR = `Duration must be between ${DURATION_MIN_SECONDS} and ${DURATION_MAX_SECONDS} seconds.`;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Could not generate track: Unknown error';
}

function clampSeekPosition(position: number): number {
  return Math.min(Math.max(position, SEEK_MIN), SEEK_MAX);
}

function truncatePromptSummary(prompt: string): string {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');
  if (normalizedPrompt.length <= TEXT_PROMPT_MAX_SUMMARY_CHARS) {
    return normalizedPrompt;
  }

  return `${normalizedPrompt.slice(0, TEXT_PROMPT_MAX_SUMMARY_CHARS - 3)}...`;
}

function buildQueueSummary(params: GenerationParams): string {
  const promptText = typeof params.prompt === 'string' ? params.prompt : null;
  const hasPrompt = promptText !== null && promptText.trim().length > 0;
  const hasTextMode = params.mode === 'text';
  const hasTextAndParamsMode = params.mode === 'text-and-parameters';

  if (hasPrompt && (hasTextMode || hasTextAndParamsMode)) {
    const truncatedPrompt = truncatePromptSummary(promptText);
    if (hasTextMode) {
      return truncatedPrompt;
    }

    return `${truncatedPrompt} · Mood: ${params.mood} · Tempo: ${params.tempo} BPM · Style: ${params.style}`;
  }

  return `Mood: ${params.mood} · Tempo: ${params.tempo} BPM · Style: ${params.style}`;
}

async function requestGeneratedAudio(
  params: GenerationParams
): Promise<string> {
  const response = await fetch(GENERATE_ENDPOINT_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    let errorText: string | null = null;
    try {
      const payload: unknown = await response.json();
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const candidate = record.error ?? record.detail;
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          errorText = candidate.trim();
        }
      }
    } catch {
      // ignore JSON parse errors for non-JSON error responses
    }

    throw new Error(
      errorText ??
        `Could not generate track: Request failed with status ${response.status}`
    );
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

async function requestGeneratedImage(
  prompt: string,
  targetWidth: number,
  targetHeight: number
): Promise<string> {
  const response = await fetch(GENERATE_IMAGE_ENDPOINT_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ prompt, targetWidth, targetHeight })
  });

  if (!response.ok) {
    let errorText: string | null = null;
    try {
      const payload: unknown = await response.json();
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const candidate = record.error ?? record.detail;
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          errorText = candidate.trim();
        }
      }
    } catch {
      // ignore JSON parse errors for non-JSON error responses
    }

    throw new Error(
      errorText ??
        `Could not generate image: Request failed with status ${response.status}`
    );
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generatedAudioUrlsRef = useRef<string[]>([]);
  const generatedImageUrlsRef = useRef<string[]>([]);
  const queueIdRef = useRef(1);
  const [params, setParams] = useState<GenerationParams>(defaultParams);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(
    'parameters'
  );
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicPromptErrorMessage, setMusicPromptErrorMessage] = useState<
    string | null
  >(null);
  const [durationInput, setDurationInput] = useState(
    String(defaultParams.duration)
  );
  const [durationErrorMessage, setDurationErrorMessage] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imagePromptErrorMessage, setImagePromptErrorMessage] = useState<
    string | null
  >(null);
  const [visualImageUrl, setVisualImageUrl] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState(
    'lofi cafe at night, cinematic lighting'
  );
  const [useSamePromptForImage, setUseSamePromptForImage] = useState(false);
  const [imagePromptBeforeSharedToggle, setImagePromptBeforeSharedToggle] =
    useState(imagePrompt);
  const [socialFormatId, setSocialFormatId] =
    useState<SocialFormatId>(defaultSocialFormatId);
  const [hasGeneratedTrack, setHasGeneratedTrack] = useState(false);
  const [seekPosition, setSeekPosition] = useState(SEEK_MIN);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playingEntryId, setPlayingEntryId] = useState<number | null>(null);
  const [activeVisualizerType, setActiveVisualizerType] =
    useState<VisualizerType>('glitch');
  const seekPollRef = useRef<number | null>(null);
  const queueEntriesRef = useRef<QueueEntry[]>([]);
  const selectedSocialFormat =
    socialFormatOptions.find((option) => option.id === socialFormatId) ??
    socialFormatOptions[0];

  const stopSeekPolling = useCallback((): void => {
    if (seekPollRef.current !== null) {
      window.clearInterval(seekPollRef.current);
      seekPollRef.current = null;
    }
  }, []);

  const startSeekPolling = useCallback((): void => {
    stopSeekPolling();
    seekPollRef.current = window.setInterval(() => {
      const audio = audioRef.current;
      if (audio && audio.duration && isFinite(audio.duration)) {
        setAudioCurrentTime(audio.currentTime);
        setAudioDuration(audio.duration);
        const pct = (audio.currentTime / audio.duration) * SEEK_MAX;
        setSeekPosition(clampSeekPosition(Math.round(pct)));
      }
    }, SEEK_POLL_INTERVAL_MS);
  }, [stopSeekPolling]);

  useEffect(() => {
    queueEntriesRef.current = queueEntries;
  }, [queueEntries]);

  useEffect(() => {
    return () => {
      generatedAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      generatedImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      generatedAudioUrlsRef.current = [];
      generatedImageUrlsRef.current = [];
      stopSeekPolling();
    };
  }, [stopSeekPolling]);

  const playAudioFromUrl = useCallback(
    async (
      audioUrl: string,
      options?: { entryId?: number; onEnded?: () => void }
    ): Promise<void> => {
      audioRef.current?.pause();
      stopSeekPolling();

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      setAudioDuration(0);
      if (audio.duration && isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
      setAudioCurrentTime(0);
      setSeekPosition(SEEK_MIN);

      audio.addEventListener('ended', () => {
        const endedDuration =
          audio.duration && isFinite(audio.duration) ? audio.duration : 0;
        setAudioDuration(endedDuration);
        setAudioCurrentTime(endedDuration);
        setSeekPosition(SEEK_MAX);
        setIsPlaying(false);
        stopSeekPolling();
        options?.onEnded?.();
      });

      await audio.play();

      setHasGeneratedTrack(true);
      setIsPlaying(true);
      setStatus('success');
      setErrorMessage(null);
      startSeekPolling();
    },
    [startSeekPolling, stopSeekPolling]
  );

  const createQueueOnEnded = useCallback(
    (entry: QueueEntry): (() => void) => {
      return () => {
        const entries = queueEntriesRef.current;
        const idx = entries.findIndex((e) => e.id === entry.id);
        const next = entries
          .slice(idx + 1)
          .find((e) => e.status === 'completed' && e.audioUrl);
        if (next?.audioUrl) {
          setPlayingEntryId(next.id);
          if (next.imageUrl) {
            setVisualImageUrl(next.imageUrl);
          }
          void playAudioFromUrl(next.audioUrl, {
            entryId: next.id,
            onEnded: createQueueOnEnded(next)
          });
        } else {
          setPlayingEntryId(null);
        }
      };
    },
    [playAudioFromUrl]
  );

  const processQueueEntry = useCallback(
    async (entry: QueueEntry): Promise<void> => {
      setStatus('loading');
      setQueueEntries((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? { ...item, status: 'generating', errorMessage: null }
            : item
        )
      );

      try {
        const [audioResult, imageResult] = await Promise.allSettled([
          requestGeneratedAudio(entry.params),
          requestGeneratedImage(
            entry.imagePrompt,
            entry.targetWidth,
            entry.targetHeight
          )
        ]);

        if (
          audioResult.status === 'fulfilled' &&
          imageResult.status === 'fulfilled'
        ) {
          const audioUrl = audioResult.value;
          const imageUrl = imageResult.value;
          generatedAudioUrlsRef.current.push(audioUrl);
          generatedImageUrlsRef.current.push(imageUrl);

          setQueueEntries((prev) =>
            prev.map((item) =>
              item.id === entry.id
                ? {
                    ...item,
                    status: 'completed',
                    errorMessage: null,
                    audioUrl,
                    imageUrl
                  }
                : item
            )
          );

          const isPlayingAudio = audioRef.current && !audioRef.current.paused;
          if (!isPlayingAudio) {
            setPlayingEntryId(entry.id);
            setVisualImageUrl(imageUrl);
            await playAudioFromUrl(audioUrl, {
              entryId: entry.id,
              onEnded: createQueueOnEnded(entry)
            });
          } else {
            setStatus('success');
          }
        } else {
          if (audioResult.status === 'fulfilled') {
            URL.revokeObjectURL(audioResult.value);
          }
          if (imageResult.status === 'fulfilled') {
            URL.revokeObjectURL(imageResult.value);
          }

          const audioError =
            audioResult.status === 'rejected'
              ? getErrorMessage(audioResult.reason)
              : null;
          const imageError =
            imageResult.status === 'rejected'
              ? getErrorMessage(imageResult.reason)
              : null;
          const message =
            audioError && imageError
              ? `Could not generate pair: audio failed (${audioError}); image failed (${imageError})`
              : audioError
                ? `Could not generate pair: audio failed (${audioError})`
                : imageError
                  ? `Could not generate pair: image failed (${imageError})`
                  : 'Could not generate pair: Unknown error';

          throw new Error(message);
        }
      } catch (error) {
        const message = getErrorMessage(error);
        setStatus('error');
        setErrorMessage(message);
        setQueueEntries((prev) =>
          prev.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  status: 'failed',
                  errorMessage: message,
                  audioUrl: null,
                  imageUrl: null
                }
              : item
          )
        );
      }
    },
    [playAudioFromUrl, createQueueOnEnded]
  );

  useEffect(() => {
    if (status === 'loading') {
      return;
    }

    const nextQueued = queueEntries.find((entry) => entry.status === 'queued');
    if (!nextQueued) {
      return;
    }

    void processQueueEntry(nextQueued);
  }, [queueEntries, status, processQueueEntry]);

  function handleGenerate(): void {
    setErrorMessage(null);
    setImagePromptErrorMessage(null);
    const parsedDuration = Number(durationInput);
    const hasValidDuration =
      Number.isInteger(parsedDuration) &&
      parsedDuration >= DURATION_MIN_SECONDS &&
      parsedDuration <= DURATION_MAX_SECONDS;

    if (!hasValidDuration) {
      setDurationErrorMessage(DURATION_RANGE_ERROR);
      return;
    }

    setDurationErrorMessage(null);
    const nextParams: GenerationParams = {
      ...params,
      duration: parsedDuration
    };

    const requiresPrompt =
      generationMode === 'text' || generationMode === 'text-and-parameters';
    const trimmedMusicPrompt = musicPrompt.trim();
    if (requiresPrompt) {
      if (!trimmedMusicPrompt) {
        setMusicPromptErrorMessage(MUSIC_PROMPT_REQUIRED_ERROR);
        return;
      }

      setMusicPromptErrorMessage(null);
    }

    const trimmedImagePrompt = useSamePromptForImage
      ? trimmedMusicPrompt
      : imagePrompt.trim();
    if (!trimmedImagePrompt) {
      setImagePromptErrorMessage('Please enter an image prompt.');
      return;
    }

    if (requiresPrompt && generationMode === 'text') {
      const nextEntry: QueueEntry = {
        id: queueIdRef.current++,
        params: {
          ...nextParams,
          mode: 'text',
          prompt: trimmedMusicPrompt,
          tempo: TEXT_MODE_DEFAULT_TEMPO
        },
        imagePrompt: trimmedImagePrompt,
        targetWidth: selectedSocialFormat.width,
        targetHeight: selectedSocialFormat.height,
        status: 'queued',
        errorMessage: null,
        audioUrl: null,
        imageUrl: null
      };
      setQueueEntries((prev) => [...prev, nextEntry]);
      return;
    }

    if (requiresPrompt && generationMode === 'text-and-parameters') {
      const nextEntry: QueueEntry = {
        id: queueIdRef.current++,
        params: {
          ...nextParams,
          mode: 'text-and-parameters',
          prompt: trimmedMusicPrompt
        },
        imagePrompt: trimmedImagePrompt,
        targetWidth: selectedSocialFormat.width,
        targetHeight: selectedSocialFormat.height,
        status: 'queued',
        errorMessage: null,
        audioUrl: null,
        imageUrl: null
      };
      setQueueEntries((prev) => [...prev, nextEntry]);
      return;
    }

    setMusicPromptErrorMessage(null);
    const nextEntry: QueueEntry = {
      id: queueIdRef.current++,
      params: nextParams,
      imagePrompt: trimmedImagePrompt,
      targetWidth: selectedSocialFormat.width,
      targetHeight: selectedSocialFormat.height,
      status: 'queued',
      errorMessage: null,
      audioUrl: null,
      imageUrl: null
    };
    setQueueEntries((prev) => [...prev, nextEntry]);
  }

  async function handlePlayQueueEntry(entry: QueueEntry): Promise<void> {
    if (entry.status !== 'completed' || !entry.audioUrl) {
      return;
    }

    setPlayingEntryId(entry.id);
    if (entry.imageUrl) {
      setVisualImageUrl(entry.imageUrl);
    }
    try {
      await playAudioFromUrl(entry.audioUrl, {
        entryId: entry.id,
        onEnded: createQueueOnEnded(entry)
      });
    } catch (error) {
      setPlayingEntryId(null);
      setStatus('error');
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handlePlay(): Promise<void> {
    try {
      await audioRef.current?.play();
      setIsPlaying(true);
      setErrorMessage(null);
      startSeekPolling();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function handlePause(): void {
    try {
      audioRef.current?.pause();
      setIsPlaying(false);
      setPlayingEntryId(null);
      setErrorMessage(null);
      stopSeekPolling();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function handleSeekChange(position: number): void {
    const nextPosition = clampSeekPosition(position);
    setSeekPosition(nextPosition);
    const audio = audioRef.current;
    if (audio && audio.duration && isFinite(audio.duration)) {
      audio.currentTime = (nextPosition / SEEK_MAX) * audio.duration;
      setAudioCurrentTime(audio.currentTime);
      setAudioDuration(audio.duration);
    }
  }

  return (
    <main className="min-h-screen bg-lofi-bg px-6 py-10 text-lofi-text">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="font-serif text-4xl font-bold text-lofi-text">
            ReelPod Studio
          </h1>
          <p className="text-sm text-lofi-accentMuted">
            Create music and visuals for YouTube, TikTok & Reels.
          </p>
        </header>

        <section
          aria-label="Generation parameters"
          className="space-y-4 rounded-lg bg-lofi-panel p-5"
        >
          <fieldset
            role="radiogroup"
            aria-label="Generation mode"
            className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3"
          >
            <legend className="text-sm font-semibold text-lofi-text">
              Generation mode
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {generationModeOptions.map((option) => {
                const isSelected = generationMode === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-lofi-accent ${
                      isSelected
                        ? 'border-lofi-accent bg-lofi-accent/20 text-lofi-text'
                        : 'border-stone-600 bg-stone-900/60 text-stone-200 hover:border-lofi-accent'
                    } ${status === 'loading' ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <input
                      type="radio"
                      name="generation-mode"
                      value={option.value}
                      checked={isSelected}
                      onChange={() => setGenerationMode(option.value)}
                      disabled={status === 'loading'}
                      className="sr-only"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {generationMode !== 'parameters' && (
            <div className="space-y-2">
              <label
                htmlFor="music-prompt"
                className="block text-sm font-semibold text-lofi-text"
              >
                Music prompt
              </label>
              <textarea
                id="music-prompt"
                rows={3}
                value={musicPrompt}
                onChange={(event) => {
                  setMusicPrompt(event.target.value);
                  if (musicPromptErrorMessage) {
                    setMusicPromptErrorMessage(null);
                  }
                }}
                disabled={status === 'loading'}
                className="w-full rounded-md border border-stone-500 bg-stone-900 px-3 py-2 text-sm text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                placeholder="Describe the music you want..."
              />
            </div>
          )}

          {generationMode !== 'text' && (
            <div className="grid gap-4 md:grid-cols-3">
              <fieldset
                data-testid="mood-control-card"
                className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3"
              >
                <legend className="text-sm font-semibold text-lofi-text">
                  Mood
                </legend>
                <label htmlFor="mood" className="sr-only">
                  Mood
                </label>
                <select
                  id="mood"
                  className="w-full rounded-md border border-stone-500 bg-stone-900 px-2 py-2 text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                  value={params.mood}
                  onChange={(event) =>
                    setParams((prev) => ({
                      ...prev,
                      mood: event.target.value as Mood
                    }))
                  }
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
                <legend className="text-sm font-semibold text-lofi-text">
                  Tempo
                </legend>
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
                <output
                  htmlFor="tempo"
                  className="block text-sm text-stone-300"
                >
                  {params.tempo} BPM
                </output>
              </fieldset>

              <fieldset
                data-testid="style-control-card"
                className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3"
              >
                <legend className="text-sm font-semibold text-lofi-text">
                  Style
                </legend>
                <label htmlFor="style" className="sr-only">
                  Style
                </label>
                <select
                  id="style"
                  className="w-full rounded-md border border-stone-500 bg-stone-900 px-2 py-2 text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                  value={params.style}
                  onChange={(event) =>
                    setParams((prev) => ({
                      ...prev,
                      style: event.target.value as Style
                    }))
                  }
                  disabled={status === 'loading'}
                >
                  <option value="jazz">jazz</option>
                  <option value="hip-hop">hip-hop</option>
                  <option value="ambient">ambient</option>
                </select>
              </fieldset>
            </div>
          )}

          <div className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3">
            <label
              htmlFor="duration"
              className="block text-sm font-semibold text-lofi-text"
            >
              Duration (s)
            </label>
            <input
              id="duration"
              type="number"
              min={DURATION_MIN_SECONDS}
              max={DURATION_MAX_SECONDS}
              step={1}
              value={durationInput}
              onChange={(event) => {
                setDurationInput(event.target.value);
                if (durationErrorMessage) {
                  setDurationErrorMessage(null);
                }
              }}
              disabled={status === 'loading'}
              className="w-full rounded-md border border-stone-500 bg-stone-900 px-3 py-2 text-sm text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
            />
          </div>

          <fieldset
            role="radiogroup"
            aria-label="Social format"
            className="space-y-2 rounded-md border border-stone-600 bg-stone-900/40 p-3"
          >
            <legend className="text-sm font-semibold text-lofi-text">
              Format
            </legend>
            <div className="grid gap-2">
              {socialFormatOptions.map((option) => {
                const isSelected = socialFormatId === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-lofi-accent ${
                      isSelected
                        ? 'border-lofi-accent bg-lofi-accent/20 text-lofi-text'
                        : 'border-stone-600 bg-stone-900/60 text-stone-200 hover:border-lofi-accent'
                    } ${status === 'loading' ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <input
                      type="radio"
                      name="social-format"
                      value={option.id}
                      checked={isSelected}
                      onChange={() => setSocialFormatId(option.id)}
                      disabled={status === 'loading'}
                      className="sr-only"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </section>

        <section
          aria-label="Generation actions"
          className="space-y-3 rounded-lg bg-lofi-panel p-4"
        >
          <button
            type="button"
            className="w-full rounded-md bg-lofi-accent px-6 py-3 text-lg font-semibold text-stone-950 outline-none transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-lofi-text disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            onClick={() => void handleGenerate()}
          >
            Generate
          </button>
          {musicPromptErrorMessage && (
            <p role="alert" className="text-sm font-semibold text-red-100">
              {musicPromptErrorMessage}
            </p>
          )}
          {durationErrorMessage && (
            <p role="alert" className="text-sm font-semibold text-red-100">
              {durationErrorMessage}
            </p>
          )}

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
              <p
                role="alert"
                className="text-sm font-semibold leading-relaxed text-red-100"
              >
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

        <section
          aria-label="Generation queue"
          className="space-y-3 rounded-lg bg-lofi-panel p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-lofi-accentMuted">
              Queue
            </h2>
            {playingEntryId !== null &&
              (() => {
                const idx = queueEntries.findIndex(
                  (e) => e.id === playingEntryId
                );
                const position = idx >= 0 ? idx + 1 : 0;
                const total = queueEntries.length;
                return (
                  <span
                    aria-live="polite"
                    className="rounded-full bg-lofi-accent/20 px-2.5 py-1 text-xs font-semibold text-lofi-accent"
                  >
                    Track {position} of {total}
                  </span>
                );
              })()}
          </div>
          {queueEntries.length === 0 ? (
            <p className="text-sm text-stone-300">No generations yet.</p>
          ) : (
            <ul className="space-y-2">
              {queueEntries.map((entry, index) => {
                const statusLabel =
                  entry.status[0].toUpperCase() + entry.status.slice(1);
                const isGenerating = entry.status === 'generating';
                const isCompleted = entry.status === 'completed';
                const isFailed = entry.status === 'failed';
                const isCurrentlyPlaying = entry.id === playingEntryId;
                const trackNumber = index + 1;

                return (
                  <li
                    key={entry.id}
                    data-testid={`queue-entry-${entry.id}`}
                    data-status={entry.status}
                    data-playing={isCurrentlyPlaying ? 'true' : undefined}
                    className={`rounded-md border p-3 text-sm ${
                      isCurrentlyPlaying
                        ? 'ring-2 ring-lofi-accent ring-offset-2 ring-offset-stone-900'
                        : ''
                    } ${
                      isGenerating
                        ? 'border-lofi-accent/70 bg-stone-900/80'
                        : isCompleted
                          ? 'border-emerald-300/60 bg-emerald-500/10'
                          : isFailed
                            ? 'border-red-400/60 bg-red-950/30'
                            : 'border-stone-600 bg-stone-900/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-lofi-accentMuted">
                          Track {trackNumber}
                        </p>
                        <p className="text-lofi-text">
                          {isCurrentlyPlaying && (
                            <span
                              className="mr-2 inline-flex items-center gap-1 text-lofi-accent"
                              aria-hidden="true"
                            >
                              ▶ Now playing
                            </span>
                          )}
                          {buildQueueSummary(entry.params)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                          isGenerating
                            ? 'bg-lofi-accent/20 text-lofi-accent'
                            : isCompleted
                              ? 'bg-emerald-500/20 text-emerald-100'
                              : isFailed
                                ? 'bg-red-500/20 text-red-100'
                                : 'bg-stone-700 text-stone-200'
                        }`}
                      >
                        {isGenerating && (
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 animate-spin rounded-full border border-lofi-accent border-t-transparent"
                          />
                        )}
                        {isCompleted && <span aria-hidden="true">✓</span>}
                        {isFailed && <span aria-hidden="true">!</span>}
                        {statusLabel}
                      </span>
                    </div>
                    {isCompleted && entry.audioUrl && (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          aria-label={`Play generation ${entry.id}`}
                          className="rounded-md border border-emerald-300/80 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 outline-none transition hover:bg-emerald-500/30 focus-visible:ring-2 focus-visible:ring-emerald-200"
                          onClick={() => void handlePlayQueueEntry(entry)}
                        >
                          Play
                        </button>
                      </div>
                    )}
                    {entry.errorMessage && (
                      <p className="mt-2 text-xs text-red-100">
                        {entry.errorMessage}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-label="Visual prompt"
          className="space-y-3 rounded-lg bg-lofi-panel p-4"
        >
          <div className="space-y-2">
            <label
              htmlFor="visual-prompt"
              className="block text-sm font-semibold text-lofi-text"
            >
              Image prompt
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-stone-200">
              <input
                type="checkbox"
                checked={useSamePromptForImage}
                onChange={(event) => {
                  const nextChecked = event.target.checked;
                  setUseSamePromptForImage(nextChecked);

                  if (nextChecked) {
                    setImagePromptBeforeSharedToggle(imagePrompt);
                    setImagePrompt(musicPrompt);
                  } else {
                    setImagePrompt(imagePromptBeforeSharedToggle);
                  }

                  if (imagePromptErrorMessage) {
                    setImagePromptErrorMessage(null);
                  }
                }}
                className="h-4 w-4 rounded border-stone-500 bg-stone-900 accent-lofi-accent"
              />
              <span>Use same prompt for image</span>
            </label>
          </div>

          {!useSamePromptForImage && (
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                id="visual-prompt"
                type="text"
                value={imagePrompt}
                onChange={(event) => {
                  setImagePrompt(event.target.value);
                  if (imagePromptErrorMessage) {
                    setImagePromptErrorMessage(null);
                  }
                }}
                className="w-full rounded-md border border-stone-500 bg-stone-900 px-3 py-2 text-sm text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                placeholder="Describe your lofi scene..."
              />
            </div>
          )}

          {useSamePromptForImage && (
            <p className="text-sm text-stone-300">
              Image prompt will use the current music prompt.
            </p>
          )}

          <div data-testid="visual-prompt-feedback" className="space-y-2">
            {imagePromptErrorMessage && (
              <p role="alert" className="text-sm font-semibold text-red-100">
                {imagePromptErrorMessage}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="active-visualizer"
              className="block text-sm font-semibold text-lofi-text"
            >
              Active visualizer
            </label>
            <select
              id="active-visualizer"
              value={activeVisualizerType}
              onChange={(event) =>
                setActiveVisualizerType(event.target.value as VisualizerType)
              }
              className="w-full rounded-md border border-stone-500 bg-stone-900 px-3 py-2 text-sm text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
            >
              {visualizerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div
            data-testid="visual-canvas"
            className="mx-auto flex w-full max-w-[760px] items-center justify-center overflow-hidden rounded-md border border-stone-600 bg-stone-900/40"
          >
            <VisualScene
              imageUrl={visualImageUrl}
              audioCurrentTime={audioCurrentTime}
              audioDuration={audioDuration}
              isPlaying={isPlaying}
              aspectRatio={selectedSocialFormat.aspectRatio}
              visualizerType={activeVisualizerType}
            />
          </div>
        </section>

        {hasGeneratedTrack && (
          <section
            aria-label="Playback controls"
            className="grid gap-3 rounded-lg bg-lofi-panel p-4"
          >
            <button
              type="button"
              className="rounded-md border border-emerald-300/80 bg-emerald-500/20 px-3 py-2 font-semibold text-emerald-100 outline-none transition hover:bg-emerald-500/30 focus-visible:ring-2 focus-visible:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handlePlay()}
              disabled={isPlaying}
            >
              Play
            </button>
            <button
              type="button"
              className="rounded-md border border-amber-200/90 bg-amber-400/25 px-3 py-2 font-semibold text-amber-50 outline-none transition hover:bg-amber-400/40 focus-visible:ring-2 focus-visible:ring-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handlePause()}
              disabled={!isPlaying}
            >
              Pause
            </button>
            <label
              htmlFor="seek"
              className="text-sm font-semibold text-lofi-accentMuted"
            >
              Seek
            </label>
            <input
              id="seek"
              className="seek-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-lofi-accent"
              type="range"
              min={SEEK_MIN}
              max={SEEK_MAX}
              value={seekPosition}
              onChange={(event) =>
                void handleSeekChange(Number(event.target.value))
              }
            />
          </section>
        )}
      </div>
    </main>
  );
}
