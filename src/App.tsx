import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecorder } from './hooks/use-recorder';
import type { SongParameters } from './mcp/parameter-store';
import { useAgentParameters } from './hooks/use-agent-parameters';
import { useAgentGeneration, type GenerationCommand } from './hooks/use-agent-generation';

type SocialFormatId = 'youtube' | 'tiktok-reels' | 'instagram-square';

interface SocialFormatPreset {
  id: SocialFormatId;
  label: string;
  aspectRatio: number;
  width: number;
  height: number;
}

interface GenerationParams {
  duration: number;
  mode: 'llm';
  prompt?: string;
}
import {
  GENERATE_ENDPOINT_PATH
} from './api/constants';
import type { EffectType } from './components/effects';
import { VisualScene } from './components/visual-scene';
import type { VisualizerType } from './components/visualizers';
import {
  DEFAULT_LIVE_MIRROR_STATE,
  LIVE_MIRROR_INTERVAL_MS,
  type LiveMirrorState,
  createLiveMirrorChannel
} from './lib/live-sync';

type GenerationStatus = 'idle' | 'loading' | 'success' | 'error';
type QueueEntryStatus = 'queued' | 'generating' | 'completed' | 'failed';
type ToggleableEffectType = Exclude<EffectType, 'none'>;

interface RecordingEntry {
  id: number;
  filename: string;
  url: string;
  sizeInMb: number;
}

interface QueueEntry {
  id: number;
  params: GenerationParams;
  imagePrompt: string;
  targetWidth: number;
  targetHeight: number;
  status: QueueEntryStatus;
  errorMessage: string | null;
  videoBlob: Blob | null;
}

const defaultParams: GenerationParams = {
  mode: 'llm',
  duration: 40
};
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
const effectOptions: ReadonlyArray<ToggleableEffectType> = [
  'zoom',
  'flicker',
  'vignette',
  'filmGrain',
  'chromaticAberration',
  'scanLines',
  'colorDrift',
  'lightingMovement'
];
const defaultEffectOrder: ToggleableEffectType[] = [...effectOptions];
const defaultEnabledEffects: Record<ToggleableEffectType, boolean> = {
  zoom: false,
  flicker: false,
  vignette: false,
  filmGrain: false,
  chromaticAberration: false,
  scanLines: false,
  colorDrift: false,
  lightingMovement: false
};
const SEEK_MIN = 0;
const SEEK_MAX = 100;
const SEEK_POLL_INTERVAL_MS = 500;
const TEXT_PROMPT_MAX_SUMMARY_CHARS = 60;
const DURATION_MIN_SECONDS = 40;
const DURATION_MAX_SECONDS = 300;
const MUSIC_PROMPT_REQUIRED_ERROR = 'Please enter a creative brief.';
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
  const brief = hasPrompt ? truncatePromptSummary(promptText!) : 'No brief';
  return `${brief} · ${params.duration}s`;
}

async function requestGeneratedVideo(
  params: GenerationParams,
  imagePrompt: string,
  targetWidth: number,
  targetHeight: number
): Promise<Blob> {
  const payload = {
    ...params,
    imagePrompt,
    targetWidth,
    targetHeight
  };
  const response = await fetch(GENERATE_ENDPOINT_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
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
      `Could not generate video: Request failed with status ${response.status}`
    );
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('video/mp4')) {
    throw new Error('Could not generate video: Expected video/mp4 response');
  }

  return response.blob();
}

export function App() {
  const videoPlaybackRef = useRef<HTMLVideoElement | null>(null);
  const [videoPlaybackElement, setVideoPlaybackElement] =
    useState<HTMLVideoElement | null>(null);
  const activeVideoObjectUrlRef = useRef<string | null>(null);
  const queueIdRef = useRef(1);
  const recordingIdRef = useRef(1);
  const [recordingEntries, setRecordingEntries] = useState<RecordingEntry[]>([]);
  const [_params, setParams] = useState<GenerationParams>(defaultParams);
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
  const [visualImageUrl] = useState<string | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [socialFormatId, setSocialFormatId] =
    useState<SocialFormatId>(defaultSocialFormatId);
  const [hasGeneratedTrack, setHasGeneratedTrack] = useState(false);
  const [seekPosition, setSeekPosition] = useState(SEEK_MIN);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playingEntryId, setPlayingEntryId] = useState<number | null>(null);
  const [isQueueRecordingActive, setIsQueueRecordingActive] = useState(false);
  const [activeVisualizerType, setActiveVisualizerType] =
    useState<VisualizerType>('none');
  const [enabledEffects, setEnabledEffects] = useState<
    Record<ToggleableEffectType, boolean>
  >(defaultEnabledEffects);
  const [activeTab, setActiveTab] = useState<'music' | 'visuals' | 'queue'>('music');
  const [effectOrder, setEffectOrder] =
    useState<ToggleableEffectType[]>(defaultEffectOrder);
  const [fontSizePercent, setFontSizePercent] = useState(103);
  const seekPollRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${fontSizePercent}%`);
  }, [fontSizePercent]);
  const liveMirrorStateRef = useRef<LiveMirrorState>(DEFAULT_LIVE_MIRROR_STATE);
  const liveMirrorChannelRef = useRef<BroadcastChannel | null>(null);
  const activeEffects = useMemo(
    () => effectOrder.filter((effect) => enabledEffects[effect]),
    [effectOrder, enabledEffects]
  );
  const hasCompletedQueueEntry = useMemo(
    () =>
      queueEntries.some(
        (entry) => entry.status === 'completed' && entry.videoBlob !== null
      ),
    [queueEntries]
  );
  const selectedSocialFormat =
    socialFormatOptions.find((option) => option.id === socialFormatId) ??
    socialFormatOptions[0];

  const handleAgentParametersUpdate = useCallback((agentParams: SongParameters) => {
    setParams({
      mode: 'llm',
      duration: agentParams.duration,
    });
    setDurationInput(String(agentParams.duration));
    setDurationErrorMessage(null);
    if (agentParams.prompt !== undefined) {
      setMusicPrompt(agentParams.prompt);
      setMusicPromptErrorMessage(null);
    }
  }, []);

  useAgentParameters({ onParametersUpdate: handleAgentParametersUpdate });

  const handleAgentGenerationCommand = useCallback((command: GenerationCommand) => {
    const nextEntry: QueueEntry = {
      id: queueIdRef.current++,
      params: {
        mode: 'llm',
        prompt: command.parameters.prompt,
        duration: command.parameters.duration,
      },
      imagePrompt: command.imagePrompt,
      targetWidth: command.targetWidth,
      targetHeight: command.targetHeight,
      status: 'queued',
      errorMessage: null,
      videoBlob: null,
    };
    setQueueEntries((prev) => [...prev, nextEntry]);
  }, []);

  useAgentGeneration({ onGenerationCommand: handleAgentGenerationCommand });

  const stopSeekPolling = useCallback((): void => {
    if (seekPollRef.current !== null) {
      window.clearInterval(seekPollRef.current);
      seekPollRef.current = null;
    }
  }, []);

  const startSeekPolling = useCallback((): void => {
    stopSeekPolling();
    seekPollRef.current = window.setInterval(() => {
      const video = videoPlaybackRef.current;
      if (video && video.duration && isFinite(video.duration)) {
        setAudioCurrentTime(video.currentTime);
        setAudioDuration(video.duration);
        const pct = (video.currentTime / video.duration) * SEEK_MAX;
        setSeekPosition(clampSeekPosition(Math.round(pct)));
      }
    }, SEEK_POLL_INTERVAL_MS);
  }, [stopSeekPolling]);

  const handleCanvasCreated = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
  }, []);

  const { isRecording, isFinalizing, startRecording, stopRecording, recordingError: recorderError } = useRecorder({
    getCanvas: () => canvasRef.current,
    getVideoElement: () => videoPlaybackRef.current,
    onStarted: () => {
      void videoPlaybackRef.current?.play();
      setIsPlaying(true);
      startSeekPolling();
    },
    onFinalized: (blob: Blob, meta: { mimeType: string; fileExtension: string }) => {
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString();
      const filename = `recording-${timestamp}${meta.fileExtension}`;
      const sizeInMb = parseFloat((blob.size / (1024 * 1024)).toFixed(2));
      const entry: RecordingEntry = {
        id: recordingIdRef.current++,
        filename,
        url,
        sizeInMb
      };
      setRecordingEntries((prev) => [...prev, entry]);
    }
  });

  useEffect(() => {
    const channel = createLiveMirrorChannel();
    liveMirrorChannelRef.current = channel;
    if (!channel) {
      return;
    }

    channel.postMessage({
      ...liveMirrorStateRef.current,
      sentAt: Date.now()
    });

    return () => {
      channel.close();
      liveMirrorChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const nextState: LiveMirrorState = {
      imageUrl:
        activeVideoUrl != null
          ? liveMirrorStateRef.current.imageUrl
          : visualImageUrl,
      audioCurrentTime,
      audioDuration,
      isPlaying,
      aspectRatio: selectedSocialFormat.aspectRatio,
      outputWidth: selectedSocialFormat.width,
      outputHeight: selectedSocialFormat.height,
      visualizerType: activeVisualizerType,
      effects: activeEffects.length > 0 ? activeEffects : ['none'],
      backgroundColor: '#0c1120',
      showPlaceholderCopy: false,
      fullBleed: false
    };
    liveMirrorStateRef.current = nextState;

    if (liveMirrorChannelRef.current) {
      liveMirrorChannelRef.current.postMessage({
        ...nextState,
        sentAt: Date.now()
      });
    }
  }, [
    activeVideoUrl,
    visualImageUrl,
    audioCurrentTime,
    audioDuration,
    isPlaying,
    selectedSocialFormat.aspectRatio,
    selectedSocialFormat.width,
    selectedSocialFormat.height,
    activeVisualizerType,
    activeEffects
  ]);

  // When we have active video, capture current frame as data URL and send to live tab
  // (blob URLs don't work cross-tab, so /live can't use the video element directly)
  useEffect(() => {
    if (!activeVideoUrl || !liveMirrorChannelRef.current) {
      return;
    }

    const timer = window.setInterval(() => {
      const video = videoPlaybackRef.current;
      const channel = liveMirrorChannelRef.current;
      if (!video || !channel || video.readyState < 2) {
        return;
      }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w <= 0 || h <= 0) {
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const nextState: LiveMirrorState = {
        ...liveMirrorStateRef.current,
        imageUrl: dataUrl,
        audioCurrentTime: isFinite(video.currentTime) ? video.currentTime : liveMirrorStateRef.current.audioCurrentTime,
        audioDuration:
          video.duration != null && isFinite(video.duration)
            ? video.duration
            : liveMirrorStateRef.current.audioDuration,
        isPlaying: !video.paused
      };
      liveMirrorStateRef.current = nextState;
      channel.postMessage({
        ...nextState,
        sentAt: Date.now()
      });
    }, LIVE_MIRROR_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [activeVideoUrl]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

      const timer = window.setInterval(() => {
      const video = videoPlaybackRef.current;
      const channel = liveMirrorChannelRef.current;
      if (!video || !channel) {
        return;
      }

      const nextState = {
        ...liveMirrorStateRef.current,
        audioCurrentTime: isFinite(video.currentTime)
          ? video.currentTime
          : liveMirrorStateRef.current.audioCurrentTime,
        audioDuration:
          video.duration && isFinite(video.duration)
            ? video.duration
            : liveMirrorStateRef.current.audioDuration,
        isPlaying: true
      };
      liveMirrorStateRef.current = nextState;

      channel.postMessage({
        ...nextState,
        sentAt: Date.now()
      });
    }, LIVE_MIRROR_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (activeVideoObjectUrlRef.current) {
        URL.revokeObjectURL(activeVideoObjectUrlRef.current);
        activeVideoObjectUrlRef.current = null;
      }
      stopSeekPolling();
    };
  }, [stopSeekPolling]);

  const createVideoPlaybackUrl = useCallback((videoBlob: Blob): string => {
    if (activeVideoObjectUrlRef.current) {
      URL.revokeObjectURL(activeVideoObjectUrlRef.current);
    }

    const nextUrl = URL.createObjectURL(videoBlob);
    activeVideoObjectUrlRef.current = nextUrl;
    setActiveVideoUrl(nextUrl);
    return nextUrl;
  }, []);

  const playVideoFromUrl = useCallback(
    async (
      videoUrl: string,
      options?: { entryId?: number; onEnded?: () => void }
    ): Promise<void> => {
      const video = videoPlaybackRef.current;
      if (!video) {
        throw new Error('Could not play video: Playback element is not ready');
      }

      video.pause();
      stopSeekPolling();

      if (video.src !== videoUrl) {
        video.src = videoUrl;
      }
      video.currentTime = 0;

      setAudioDuration(0);
      if (video.duration && isFinite(video.duration)) {
        setAudioDuration(video.duration);
      }
      setAudioCurrentTime(0);
      setSeekPosition(SEEK_MIN);

      video.onended = () => {
        const endedDuration =
          video.duration && isFinite(video.duration) ? video.duration : 0;
        setAudioDuration(endedDuration);
        setAudioCurrentTime(endedDuration);
        setSeekPosition(SEEK_MAX);
        setIsPlaying(false);
        stopSeekPolling();
        options?.onEnded?.();
      };

      try {
        await video.play();
        setHasGeneratedTrack(true);
        setIsPlaying(true);
      } catch {
        // Browser blocked autoplay - set as ready but paused
        setHasGeneratedTrack(true);
        setIsPlaying(false);
      }

      setStatus('success');
      setErrorMessage(null);
      startSeekPolling();
    },
    [startSeekPolling, stopSeekPolling]
  );

  const playNextEntryRef = useRef<(currentEntryId: number) => void>(undefined);

  const createQueueOnEnded = useCallback(
    (entry: QueueEntry): (() => void) => {
      return () => {
        playNextEntryRef.current?.(entry.id);
      };
    },
    []
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
        const videoBlob = await requestGeneratedVideo(
          entry.params,
          entry.imagePrompt,
          entry.targetWidth,
          entry.targetHeight
        );

        setQueueEntries((prev) =>
          prev.map((item) =>
            item.id === entry.id
              ? {
                ...item,
                status: 'completed',
                errorMessage: null,
                videoBlob
              }
              : item
          )
        );

        const isPlayingVideo =
          videoPlaybackRef.current && !videoPlaybackRef.current.paused;
        if (!isPlayingVideo) {
          const playbackUrl = createVideoPlaybackUrl(videoBlob);
          setPlayingEntryId(entry.id);
          await playVideoFromUrl(playbackUrl, {
            entryId: entry.id,
            onEnded: createQueueOnEnded(entry)
          });
        } else {
          setStatus('success');
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
                videoBlob: null
              }
              : item
          )
        );
      }
    },
    [createQueueOnEnded, createVideoPlaybackUrl, playVideoFromUrl]
  );

  useEffect(() => {
    playNextEntryRef.current = (currentEntryId: number) => {
      const currentIndex = queueEntries.findIndex((e) => e.id === currentEntryId);
      const nextCompleted = queueEntries
        .slice(currentIndex + 1)
        .find((e) => e.status === 'completed' && e.videoBlob);

      if (nextCompleted) {
        const playbackUrl = createVideoPlaybackUrl(nextCompleted.videoBlob!);
        setPlayingEntryId(nextCompleted.id);
        void playVideoFromUrl(playbackUrl, {
          entryId: nextCompleted.id,
          onEnded: createQueueOnEnded(nextCompleted)
        });
      } else {
        setPlayingEntryId(null);
        if (isQueueRecordingActive) {
          void (async () => {
            try {
              await stopRecording();
            } catch (error) {
              setStatus('error');
              setErrorMessage(getErrorMessage(error));
            } finally {
              setIsQueueRecordingActive(false);
            }
          })();
        }
      }
    };
  }, [
    queueEntries,
    createVideoPlaybackUrl,
    playVideoFromUrl,
    createQueueOnEnded,
    isQueueRecordingActive,
    stopRecording
  ]);

  useEffect(() => {
    if (status === 'loading') {
      return;
    }

    const nextQueued = queueEntries.find((entry) => entry.status === 'queued');
    if (!nextQueued) {
      return;
    }

    const timer = window.setTimeout(() => {
      void processQueueEntry(nextQueued);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [queueEntries, status, processQueueEntry]);

  function handleGenerate(): void {
    setErrorMessage(null);

    const trimmedBrief = musicPrompt.trim();
    if (!trimmedBrief) {
      setMusicPromptErrorMessage(MUSIC_PROMPT_REQUIRED_ERROR);
      return;
    }

    const parsedDuration = Number(durationInput);
    const hasValidDuration =
      Number.isInteger(parsedDuration) &&
      parsedDuration >= DURATION_MIN_SECONDS &&
      parsedDuration <= DURATION_MAX_SECONDS;

    if (!hasValidDuration) {
      setDurationErrorMessage(DURATION_RANGE_ERROR);
      return;
    }

    setMusicPromptErrorMessage(null);
    setDurationErrorMessage(null);
    const nextEntry: QueueEntry = {
      id: queueIdRef.current++,
      params: {
        mode: 'llm',
        prompt: trimmedBrief,
        duration: parsedDuration,
      },
      imagePrompt: '',
      targetWidth: selectedSocialFormat.width,
      targetHeight: selectedSocialFormat.height,
      status: 'queued',
      errorMessage: null,
      videoBlob: null,
    };
    setQueueEntries((prev) => [...prev, nextEntry]);
  }

  async function handlePlayQueueEntry(entry: QueueEntry): Promise<void> {
    if (entry.status !== 'completed' || !entry.videoBlob) {
      return;
    }

    const playbackUrl = createVideoPlaybackUrl(entry.videoBlob);
    setPlayingEntryId(entry.id);
    try {
      await playVideoFromUrl(playbackUrl, {
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
      await videoPlaybackRef.current?.play();
      setIsPlaying(true);
      setErrorMessage(null);
      startSeekPolling();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleRecord(): Promise<void> {
    setErrorMessage(null);
    const video = videoPlaybackRef.current;
    if (video) {
      video.currentTime = 0;
      setAudioCurrentTime(0);
      setSeekPosition(SEEK_MIN);
      // AC01: auto-finalize when playback ends during recording
      video.onended = () => {
        const endedDuration = video.duration && isFinite(video.duration) ? video.duration : 0;
        setAudioDuration(endedDuration);
        setAudioCurrentTime(endedDuration);
        setSeekPosition(SEEK_MAX);
        setIsPlaying(false);
        stopSeekPolling();
        void stopRecording();
      };
    }
    await startRecording();
  }

  async function handleStop(): Promise<void> {
    // AC02: user-initiated stop
    videoPlaybackRef.current?.pause();
    setIsPlaying(false);
    stopSeekPolling();
    await stopRecording();
  }

  async function handleRecordQueue(): Promise<void> {
    if (isQueueRecordingActive || isRecording || isFinalizing) {
      return;
    }

    const firstCompletedEntry = queueEntries.find(
      (entry) => entry.status === 'completed' && entry.videoBlob !== null
    );
    if (!firstCompletedEntry || !firstCompletedEntry.videoBlob) {
      return;
    }

    setErrorMessage(null);
    setIsQueueRecordingActive(true);

    try {
      await startRecording();
      const playbackUrl = createVideoPlaybackUrl(firstCompletedEntry.videoBlob);
      setPlayingEntryId(firstCompletedEntry.id);
      await playVideoFromUrl(playbackUrl, {
        entryId: firstCompletedEntry.id,
        onEnded: createQueueOnEnded(firstCompletedEntry)
      });
    } catch (error) {
      setIsQueueRecordingActive(false);
      setStatus('error');
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleStopQueueRecording(): Promise<void> {
    try {
      await handleStop();
    } finally {
      setIsQueueRecordingActive(false);
      setPlayingEntryId(null);
    }
  }

  function handlePause(): void {
    try {
      videoPlaybackRef.current?.pause();
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
    const video = videoPlaybackRef.current;
    if (video && video.duration && isFinite(video.duration)) {
      video.currentTime = (nextPosition / SEEK_MAX) * video.duration;
      setAudioCurrentTime(video.currentTime);
      setAudioDuration(video.duration);
    }
  }

  const handlePlaybackVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoPlaybackRef.current = node;
    setVideoPlaybackElement((previous) => (previous === node ? previous : node));
  }, []);

  function handleMoveEffect(
    effect: ToggleableEffectType,
    direction: 'up' | 'down'
  ): void {
    setEffectOrder((prev) => {
      const currentIndex = prev.indexOf(effect);
      if (currentIndex === -1) {
        return prev;
      }

      const targetIndex =
        direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }

      const next = [...prev];
      const [movedEffect] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, movedEffect);
      return next;
    });
  }

  return (
    <main className="relative isolate min-h-screen overflow-x-hidden bg-transparent px-[clamp(0.6rem,1.3vw,1.2rem)] py-[clamp(0.75rem,1.6vw,1.35rem)] font-sans text-sm text-lofi-text">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-lofi-bg/90 to-transparent" />
      </div>
      <div
        className="fixed right-4 top-4 z-20 flex items-center gap-1 rounded-sm border border-lofi-accent/70 bg-lofi-bg/90 p-1.5 shadow-[0_16px_36px_-22px_var(--color-lofi-shadow-ring)]"
        role="toolbar"
        aria-label="Appearance controls"
      >
        {/* Tabler Icons: text-decrease, text-increase, palette — https://tabler.io/icons (MIT) */}
        <button
          type="button"
          onClick={() => setFontSizePercent((p) => Math.max(p - 3, 80))}
          className="interactive-lift min-h-11 min-w-11 rounded-sm p-2 text-lofi-text outline-none transition hover:bg-lofi-accent/25 focus-visible:ring-2 focus-visible:ring-lofi-accent"
          aria-label="Decrease text size"
          title="Decrease text size"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 19v-10.5a3.5 3.5 0 1 1 7 0v10.5" />
            <path d="M4 13h7" />
            <path d="M21 12h-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setFontSizePercent((p) => Math.min(p + 3, 120))}
          className="interactive-lift min-h-11 min-w-11 rounded-sm p-2 text-lofi-text outline-none transition hover:bg-lofi-accent/25 focus-visible:ring-2 focus-visible:ring-lofi-accent"
          aria-label="Increase text size"
          title="Increase text size"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 19v-10.5a3.5 3.5 0 1 1 7 0v10.5" />
            <path d="M4 13h7" />
            <path d="M18 9v6" />
            <path d="M21 12h-6" />
          </svg>
        </button>
        <button
          type="button"
          disabled
          className="min-h-11 min-w-11 cursor-not-allowed rounded-sm p-2 text-lofi-accentMuted/75 opacity-70 outline-none"
          aria-label="Change background unavailable"
          title="Change background unavailable"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25" />
            <path d="M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
            <path d="M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
            <path d="M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          </svg>
        </button>
      </div>
      <video
        ref={handlePlaybackVideoRef}
        data-testid="playback-video"
        playsInline
        preload="auto"
        muted={false}
        className="hidden"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.duration && isFinite(video.duration)) {
            setAudioDuration(video.duration);
          }
        }}
      />
      <div className="w-full min-w-0 space-y-[clamp(0.9rem,1.5vw,1.2rem)]">
        <header className="reveal-rise grid gap-3 border-b border-lofi-accent/35 pb-3 xl:grid-cols-[1fr_auto] xl:items-end" style={{ animationDelay: '40ms' }}>
          <div className="space-y-3">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-lofi-accent">
              Creator Broadcast Suite
            </p>
            <h1 className="font-serif text-[clamp(1.55rem,4vw,3rem)] font-bold uppercase leading-[0.97] tracking-tight text-lofi-text">
              ReelPod <span className="text-lofi-accent">Studio</span>
            </h1>
            <p className="max-w-2xl text-xs leading-relaxed text-lofi-accentMuted sm:text-sm">
              Generate cinematic music and live-ready visuals for YouTube, TikTok, and Reels from one creative brief.
            </p>
          </div>
          <p className="hidden border-l border-lofi-accent/40 pl-5 text-xs font-semibold uppercase tracking-[0.24em] text-lofi-accentMuted xl:block">
            Real-Time Queue<br />Visual Engine
          </p>
        </header>
        <div
          data-testid="studio-layout-grid"
          className="grid min-w-0 gap-[clamp(0.9rem,1.3vw,1.1rem)] xl:grid-cols-[3fr_7fr] xl:items-start 2xl:grid-cols-[2fr_8fr]"
        >
          <div data-testid="controls-column" className="reveal-rise min-w-0 space-y-6" style={{ animationDelay: '90ms' }}>
            <div className="inline-flex w-full flex-wrap gap-2 rounded-sm border border-lofi-accent/35 bg-lofi-bg/50 p-1">
              <button
                type="button"
                className={`interactive-lift min-h-11 rounded-sm px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lofi-accent ${activeTab === 'music'
                  ? 'rgb-active'
                  : 'text-lofi-accentMuted hover:bg-lofi-panel hover:text-lofi-text'
                  }`}
                onClick={() => setActiveTab('music')}
              >
                Music Generation
              </button>
              <button
                type="button"
                className={`interactive-lift min-h-11 rounded-sm px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lofi-accent ${activeTab === 'visuals'
                  ? 'rgb-active'
                  : 'text-lofi-accentMuted hover:bg-lofi-panel hover:text-lofi-text'
                  }`}
                onClick={() => setActiveTab('visuals')}
              >
                Visual Settings
              </button>
              <button
                type="button"
                className={`interactive-lift min-h-11 rounded-sm px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lofi-accent ${activeTab === 'queue'
                  ? 'rgb-active'
                  : 'text-lofi-accentMuted hover:bg-lofi-panel hover:text-lofi-text'
                  }`}
                onClick={() => setActiveTab('queue')}
              >
                Queue
              </button>
            </div>

            {activeTab === 'music' && (
              <>
                <section
                  id="music-panel"
                  aria-label="Generation parameters"
                  className="reveal-rise space-y-4 rounded-sm border border-lofi-accent/35 bg-lofi-panel/92 p-5 shadow-[0_18px_34px_-26px_var(--color-lofi-shadow-ring)]"
                  style={{ animationDelay: '130ms' }}
                >
                  <div className="space-y-2">
                    <label
                      htmlFor="music-prompt"
                      className="block text-sm font-semibold text-lofi-text"
                    >
                      Creative brief
                    </label>
                    <textarea
                      id="music-prompt"
                      rows={5}
                      value={musicPrompt}
                      onChange={(event) => {
                        setMusicPrompt(event.target.value);
                        if (musicPromptErrorMessage) {
                          setMusicPromptErrorMessage(null);
                        }
                      }}
                      className="w-full rounded-md border border-lofi-accentMuted bg-lofi-bg px-3 py-2 text-sm text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                      placeholder="Describe your concept — the AI creative director will choose the music style, mood, tempo, imagery, and scene automatically..."
                    />
                  </div>

                  <div className="space-y-2 rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg/45 p-3">
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
                      className="w-full rounded-md border border-lofi-accentMuted bg-lofi-bg px-3 py-2 text-sm text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                    />
                  </div>

                  <fieldset
                    role="radiogroup"
                    aria-label="Social format"
                    className="space-y-2 rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg/45 p-3"
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
                            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-sm border px-3 py-2 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-lofi-accent ${isSelected
                              ? 'border-lofi-accent bg-lofi-accent/20 text-lofi-text'
                              : 'border-lofi-accentMuted/70 bg-lofi-bg/60 text-lofi-accentMuted hover:border-lofi-accent hover:text-lofi-text'
                              }`}
                          >
                            <input
                              type="radio"
                              name="social-format"
                              value={option.id}
                              checked={isSelected}
                              onChange={() => setSocialFormatId(option.id)}
                              className="sr-only"
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </section>
              </>
            )}

            <section
              aria-label="Generation actions"
              className="reveal-rise space-y-3 rounded-sm border border-lofi-accent/35 bg-lofi-panel/92 p-4 shadow-[0_18px_34px_-26px_var(--color-lofi-shadow-ring)]"
              style={{ animationDelay: '160ms' }}
            >
              <button
                type="button"
                className="interactive-lift rgb-cta w-full min-h-11 rounded-sm px-6 py-3 text-base font-semibold uppercase tracking-[0.1em] outline-none transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-lofi-accent disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="status-pulse reveal-soft flex items-center gap-3 rounded-md border border-lofi-accent/60 bg-lofi-bg/70 px-3 py-2 text-sm font-semibold text-lofi-text"
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

            {activeTab === 'queue' && (
              <section
                id="queue-panel"
                aria-label="Generation queue"
                className="reveal-rise space-y-3 rounded-sm border border-lofi-accent/35 bg-lofi-panel/92 p-4 shadow-[0_18px_34px_-26px_var(--color-lofi-shadow-ring)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-lofi-accentMuted">
                      Queue
                    </h2>
                    <button
                      type="button"
                      onClick={() => window.open('/live', '_blank', 'noopener,noreferrer')}
                      className="interactive-lift rgb-cta min-h-11 rounded-sm px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] outline-none transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-lofi-accent"
                    >
                      Go Live
                    </button>
                    {isQueueRecordingActive ? (
                      <button
                        type="button"
                        data-testid="queue-stop-recording-button"
                        className="interactive-lift min-h-11 rounded-sm border border-red-500/70 bg-red-950/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] text-red-100 outline-none transition hover:bg-red-900/40 focus-visible:ring-2 focus-visible:ring-red-400"
                        onClick={() => void handleStopQueueRecording()}
                        aria-label="Stop queue recording"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 rounded-sm bg-red-500"
                          />
                          Stop Recording
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="record-queue-button"
                        className="interactive-lift min-h-11 rounded-sm border border-red-500/70 bg-red-950/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] text-red-100 outline-none transition hover:bg-red-900/40 focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void handleRecordQueue()}
                        disabled={
                          !hasCompletedQueueEntry || isRecording || isFinalizing
                        }
                        aria-label="Record queue"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 rounded-full bg-red-500"
                          />
                          Record Queue
                        </span>
                      </button>
                    )}
                  </div>
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
                          className="rounded-full bg-lofi-accent/20 px-2.5 py-1 text-sm font-semibold text-lofi-accent"
                        >
                          Track {position} of {total}
                        </span>
                      );
                    })()}
                </div>
                {recordingEntries.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-lofi-accentMuted">
                      Recordings
                    </h3>
                    <ul className="space-y-2">
                      {recordingEntries.map((rec) => (
                        <li
                          key={rec.id}
                          data-testid={`recording-entry-${rec.id}`}
                          className="rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg/40 p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 space-y-0.5">
                              <p
                                data-testid={`recording-filename-${rec.id}`}
                                className="truncate font-semibold text-lofi-text"
                              >
                                {rec.filename}
                              </p>
                              <p
                                data-testid={`recording-size-${rec.id}`}
                                className="text-lofi-accentMuted"
                              >
                                {rec.sizeInMb} MB
                              </p>
                            </div>
                            <a
                              data-testid={`recording-download-${rec.id}`}
                              href={rec.url}
                              download={rec.filename}
                              className="interactive-lift min-h-11 shrink-0 rounded-sm border border-lofi-accent bg-lofi-accent/25 px-3 py-2 text-sm font-semibold text-lofi-text outline-none transition hover:bg-lofi-accent/35 focus-visible:ring-2 focus-visible:ring-lofi-accent"
                            >
                              Download
                            </a>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {queueEntries.length === 0 ? (
                  <p className="text-sm text-lofi-accentMuted">No generations yet.</p>
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
                          className={`rounded-sm border p-3 text-sm ${isCurrentlyPlaying
                            ? 'queue-playing-glow'
                            : ''
                            } ${isCurrentlyPlaying
                            ? 'ring-2 ring-lofi-accent ring-offset-2 ring-offset-lofi-bg'
                            : ''
                            } ${isGenerating
                              ? 'border-lofi-accent/70 bg-lofi-bg/80'
                              : isCompleted
                                ? 'border-emerald-300/60 bg-emerald-500/10'
                                : isFailed
                                  ? 'border-red-400/60 bg-red-950/30'
                                  : 'border-lofi-accentMuted/70 bg-lofi-bg/40'
                            }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold uppercase tracking-wide text-lofi-accentMuted">
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
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold ${isGenerating
                                ? 'bg-lofi-accent/20 text-lofi-accent'
                                : isCompleted
                                  ? 'bg-emerald-500/20 text-emerald-100'
                                  : isFailed
                                    ? 'bg-red-500/20 text-red-100'
                                    : 'bg-lofi-accentMuted/30 text-lofi-text'
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
                          {isCompleted && entry.videoBlob && (
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                aria-label={`Play generation ${entry.id}`}
                                className="interactive-lift min-h-11 rounded-sm border border-lofi-accent bg-lofi-accent/25 px-3 py-2 text-sm font-semibold text-lofi-text outline-none transition hover:bg-lofi-accent/35 focus-visible:ring-2 focus-visible:ring-lofi-accent"
                                onClick={() => void handlePlayQueueEntry(entry)}
                              >
                                Play
                              </button>
                            </div>
                          )}
                          {entry.errorMessage && (
                            <p className="mt-2 text-sm text-red-100">
                              {entry.errorMessage}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {activeTab === 'visuals' && (
              <section
                id="visuals-panel"
                aria-label="Visualizer settings"
                className="reveal-rise space-y-3 rounded-sm border border-lofi-accent/35 bg-lofi-panel/92 p-4 shadow-[0_18px_34px_-26px_var(--color-lofi-shadow-ring)]"
              >

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
                    className="w-full rounded-md border border-lofi-accentMuted bg-lofi-bg px-3 py-2 text-sm text-lofi-text outline-none transition hover:border-lofi-accent focus-visible:ring-2 focus-visible:ring-lofi-accent"
                  >
                    {visualizerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset
                  aria-label="Post-processing effects"
                    className="space-y-2 rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg/45 p-3"
                >
                  <legend className="text-sm font-semibold text-lofi-text">
                    Effects
                  </legend>
                  <div className="space-y-2">
                    {effectOrder.map((effectType, index) => (
                      <div
                        key={effectType}
                        data-testid={`effect-row-${effectType}`}
                        className="flex items-center justify-between gap-2 rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg/60 px-3 py-2 text-sm text-lofi-text"
                      >
                        <span className="inline-flex items-center gap-2">
                          <input
                            id={`effect-${effectType}`}
                            type="checkbox"
                            checked={enabledEffects[effectType]}
                            onChange={(event) =>
                              setEnabledEffects((prev) => ({
                                ...prev,
                                [effectType]: event.target.checked
                              }))
                            }
                            className="h-4 w-4 rounded border-lofi-accentMuted bg-lofi-bg accent-lofi-accent"
                          />
                          <label htmlFor={`effect-${effectType}`}>
                            {effectType}
                          </label>
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleMoveEffect(effectType, 'up')}
                            disabled={index === 0}
                            className="interactive-lift min-h-11 rounded-sm border border-lofi-accentMuted px-3 py-2 text-sm font-semibold text-lofi-text outline-none transition enabled:hover:border-lofi-accent enabled:hover:text-lofi-accent enabled:focus-visible:ring-2 enabled:focus-visible:ring-lofi-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveEffect(effectType, 'down')}
                            disabled={index === effectOrder.length - 1}
                            className="interactive-lift min-h-11 rounded-sm border border-lofi-accentMuted px-3 py-2 text-sm font-semibold text-lofi-text outline-none transition enabled:hover:border-lofi-accent enabled:hover:text-lofi-accent enabled:focus-visible:ring-2 enabled:focus-visible:ring-lofi-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Down
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </fieldset>
              </section>
            )}
          </div>

          <div
            data-testid="preview-column"
            className="reveal-rise min-w-0 space-y-6 xl:sticky xl:top-10 xl:self-start"
            style={{ animationDelay: '120ms' }}
          >
            <section
              aria-label="Visual scene"
              className="overflow-hidden rounded-sm border border-lofi-accent/40 bg-lofi-panel/94 p-2 shadow-[0_24px_42px_-30px_var(--color-lofi-shadow-ring)] xl:h-[calc(100vh-11.8rem)] xl:min-h-[28rem]"
              style={{
                boxShadow:
                  'inset 0 0 0 1px var(--color-lofi-shadow-ring), 0 24px 42px -30px var(--color-lofi-shadow-ring)'
              }}
            >
              <div
                data-testid="visual-canvas"
                className="mx-auto grid h-full w-full place-items-center overflow-hidden rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg/60 p-1"
                style={{
                  boxShadow: 'inset 0 0 0 1px var(--color-lofi-shadow-ring)'
                }}
              >
                <div
                  data-testid="visual-aspect-container"
                  className="flex h-full w-full items-center justify-center"
                >
                  <VisualScene
                    imageUrl={visualImageUrl}
                    videoElement={videoPlaybackElement}
                    videoUrl={activeVideoUrl}
                    audioCurrentTime={audioCurrentTime}
                    audioDuration={audioDuration}
                    isPlaying={isPlaying}
                    aspectRatio={selectedSocialFormat.aspectRatio}
                    visualizerType={activeVisualizerType}
                    effects={activeEffects}
                    onCanvasCreated={handleCanvasCreated}
                  />
                </div>
              </div>
            </section>

            {hasGeneratedTrack && (
              <section
                data-testid="playback-controls-section"
                aria-label="Playback controls"
                className="grid gap-3 rounded-sm border border-lofi-accent/35 bg-lofi-panel/92 p-4 shadow-[0_18px_34px_-26px_var(--color-lofi-shadow-ring)]"
              >
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="interactive-lift min-h-11 flex-1 rounded-sm border border-lofi-accent bg-lofi-accent/25 px-3 py-2 text-sm font-bold uppercase tracking-[0.12em] text-lofi-text outline-none transition hover:bg-lofi-accent/35 focus-visible:ring-2 focus-visible:ring-lofi-accent disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handlePlay()}
                    disabled={isPlaying}
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    className="interactive-lift min-h-11 flex-1 rounded-sm border border-lofi-accent bg-lofi-accent/20 px-3 py-2 text-sm font-bold uppercase tracking-[0.12em] text-lofi-text outline-none transition hover:bg-lofi-accent/35 focus-visible:ring-2 focus-visible:ring-lofi-accent disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handlePause()}
                    disabled={!isPlaying}
                  >
                    Pause
                  </button>
                </div>

                {/* AC04: Stop button replaces Record while recording is active */}
                {isRecording ? (
                  <button
                    type="button"
                    data-testid="stop-button"
                    className="interactive-lift min-h-11 rounded-sm border border-red-500/70 bg-red-950/30 px-3 py-2 text-sm font-bold uppercase tracking-[0.12em] text-red-100 outline-none transition hover:bg-red-900/40 focus-visible:ring-2 focus-visible:ring-red-400"
                    onClick={() => void handleStop()}
                    aria-label="Stop recording"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 rounded-sm bg-red-500"
                      />
                      Stop
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="record-button"
                    className="interactive-lift min-h-11 rounded-sm border border-red-500/70 bg-red-950/30 px-3 py-2 text-sm font-bold uppercase tracking-[0.12em] text-red-100 outline-none transition hover:bg-red-900/40 focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleRecord()}
                    disabled={!activeVideoUrl || isFinalizing || isQueueRecordingActive}
                    aria-label="Record canvas and audio to MP4"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 rounded-full bg-red-500"
                      />
                      Record
                    </span>
                  </button>
                )}

                {/* AC03: spinner replaces recording dot while finalizing */}
                {isFinalizing ? (
                  <div
                    data-testid="finalizing-indicator"
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-sm border border-lofi-accent/50 bg-lofi-surface/40 px-3 py-2 text-sm font-semibold text-lofi-accentMuted"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-lofi-accentMuted border-t-transparent"
                    />
                    Finalizing&hellip;
                  </div>
                ) : isRecording && (
                  <div
                    data-testid="recording-indicator"
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-sm border border-red-400/50 bg-red-950/20 px-3 py-2 text-sm font-semibold text-red-100"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"
                    />
                    Recording&hellip;
                  </div>
                )}

                {/* Recorder codec/setup error message */}
                {recorderError && (
                  <p
                    data-testid="recorder-error"
                    role="alert"
                    className="rounded-sm border border-red-400/50 bg-red-950/20 px-3 py-2 text-sm text-red-100"
                  >
                    {recorderError}
                  </p>
                )}

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
        </div>
      </div>
    </main>
  );
}
