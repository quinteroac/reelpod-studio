import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_MIRROR_CHANNEL_NAME,
  LIVE_MIRROR_INTERVAL_MS
} from './lib/live-sync';

type VisualSceneProps = Record<string, unknown>;
type MessageListener = (event: MessageEvent<unknown>) => void;

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  readonly name: string;
  readonly postedMessages: unknown[] = [];
  private readonly listeners = new Set<MessageListener>();

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    this.postedMessages.push(data);
    MockBroadcastChannel.instances
      .filter((channel) => channel.name === this.name)
      .forEach((channel) => {
        channel.listeners.forEach((listener) => {
          listener({ data } as MessageEvent<unknown>);
        });
      });
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') {
      return;
    }

    this.listeners.add(listener as MessageListener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') {
      return;
    }

    this.listeners.delete(listener as MessageListener);
  }

  close(): void {
    this.listeners.clear();
  }
}

const visualSceneSpy = vi.fn((_: VisualSceneProps) => (
  <div data-testid="visual-scene" />
));

vi.mock('./components/visual-scene', () => ({
  VisualScene: (props: VisualSceneProps) => visualSceneSpy(props)
}));

import { App } from './App';

function createMockAudio() {
  const listeners = new Map<string, EventListener>();

  const audio = {
    src: '',
    paused: true,
    currentTime: 0,
    duration: 30,
    play: vi.fn(async () => {
      audio.paused = false;
      return undefined;
    }),
    pause: vi.fn(() => {
      audio.paused = true;
    }),
    addEventListener: vi.fn((eventName: string, listener: EventListener) => {
      listeners.set(eventName, listener);
    })
  };

  return audio as unknown as HTMLAudioElement;
}

function createAudioResponse(): Response {
  return new Response(new Blob(['fake-wav-data'], { type: 'audio/wav' }), {
    status: 200,
    headers: { 'content-type': 'audio/wav' }
  });
}

function createImageResponse(): Response {
  return new Response(new Blob(['fake-image-data'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });
}

function getLiveMirrorChannel(): MockBroadcastChannel {
  const channel = MockBroadcastChannel.instances.find(
    (instance) => instance.name === LIVE_MIRROR_CHANNEL_NAME
  );

  if (!channel) {
    throw new Error('Expected App to create a live mirror BroadcastChannel');
  }

  return channel;
}

function getLastMessage(channel: MockBroadcastChannel): Record<string, unknown> {
  const message = channel.postedMessages[channel.postedMessages.length - 1];
  if (typeof message !== 'object' || message === null) {
    throw new Error('Expected a structured live mirror message');
  }

  return message as Record<string, unknown>;
}

describe('App live mirror sync (US-002)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    MockBroadcastChannel.instances = [];

    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: MockBroadcastChannel
    });

    const mockAudio = createMockAudio();
    vi.spyOn(globalThis, 'Audio').mockImplementation(() => mockAudio);
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith('/api/generate-image')) {
          return createImageResponse();
        }

        return createAudioResponse();
      }
    );

    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (obj: Blob | MediaSource) => {
        if ('type' in obj && obj.type === 'image/png') {
          return 'blob:http://localhost/generated-image-url';
        }

        return 'blob:http://localhost/generated-audio-url';
      }
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('publishes visualizer and effects changes via BroadcastChannel', () => {
    render(<App />);

    const channel = getLiveMirrorChannel();
    expect(channel.postedMessages.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    fireEvent.change(screen.getByLabelText('Active visualizer'), {
      target: { value: 'waveform' }
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'zoom' }));

    const lastMessage = getLastMessage(channel);
    expect(lastMessage.visualizerType).toBe('waveform');
    expect(lastMessage.effects).toEqual(['zoom', 'colorDrift']);
    expect(typeof lastMessage.sentAt).toBe('number');
  });

  it('publishes playback timing and paused state updates', async () => {
    render(<App />);

    const channel = getLiveMirrorChannel();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Playback controls' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Seek'), {
      target: { value: '50' }
    });

    await waitFor(() => {
      const playingMessage = getLastMessage(channel);
      expect(playingMessage.audioCurrentTime).toBe(15);
      expect(playingMessage.audioDuration).toBe(30);
      expect(playingMessage.isPlaying).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => {
      const pausedMessage = getLastMessage(channel);
      expect(pausedMessage.isPlaying).toBe(false);
    });
  });

  it('uses a sub-100ms publish cadence constant for live mirroring', () => {
    expect(LIVE_MIRROR_INTERVAL_MS).toBeLessThan(100);
  });
});
