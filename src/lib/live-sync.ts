import type { EffectType } from '../components/effects';
import type { VisualizerType } from '../components/visualizers';

export const LIVE_MIRROR_CHANNEL_NAME = 'reelpod-live-mirror';
export const LIVE_MIRROR_INTERVAL_MS = 50;

export interface LiveMirrorState {
  imageUrl: string | null;
  audioCurrentTime: number;
  audioDuration: number;
  isPlaying: boolean;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  visualizerType: VisualizerType;
  effects: EffectType[];
  backgroundColor: string;
  showPlaceholderCopy: boolean;
  fullBleed: boolean;
}

export interface LiveMirrorMessage extends LiveMirrorState {
  sentAt: number;
}

export const DEFAULT_LIVE_MIRROR_STATE: LiveMirrorState = {
  imageUrl: null,
  audioCurrentTime: 0,
  audioDuration: 0,
  isPlaying: false,
  aspectRatio: 16 / 9,
  outputWidth: 1920,
  outputHeight: 1080,
  visualizerType: 'none',
  effects: ['none'],
  backgroundColor: '#000000',
  showPlaceholderCopy: false,
  fullBleed: false
};

export function createLiveMirrorChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }

  return new BroadcastChannel(LIVE_MIRROR_CHANNEL_NAME);
}

export function isLiveMirrorMessage(value: unknown): value is LiveMirrorMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<LiveMirrorMessage>;
  return (
    (candidate.imageUrl === null || typeof candidate.imageUrl === 'string') &&
    typeof candidate.audioCurrentTime === 'number' &&
    typeof candidate.audioDuration === 'number' &&
    typeof candidate.isPlaying === 'boolean' &&
    typeof candidate.aspectRatio === 'number' &&
    typeof candidate.outputWidth === 'number' &&
    typeof candidate.outputHeight === 'number' &&
    typeof candidate.visualizerType === 'string' &&
    Array.isArray(candidate.effects) &&
    typeof candidate.backgroundColor === 'string' &&
    typeof candidate.showPlaceholderCopy === 'boolean' &&
    typeof candidate.fullBleed === 'boolean' &&
    typeof candidate.sentAt === 'number'
  );
}
