import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_MIRROR_CHANNEL_NAME } from './lib/live-sync';

type VisualSceneProps = Record<string, unknown>;

const visualSceneSpy = vi.fn((_: VisualSceneProps) => (
  <div data-testid="visual-scene" />
));

type MessageListener = (event: MessageEvent<unknown>) => void;

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  readonly name: string;
  private readonly listeners = new Set<MessageListener>();

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
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

vi.mock('./components/visual-scene', () => ({
  VisualScene: (props: VisualSceneProps) => visualSceneSpy(props)
}));

import { LivePage } from './live-page';

describe('LivePage', () => {
  beforeEach(() => {
    visualSceneSpy.mockClear();
    MockBroadcastChannel.instances = [];
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: MockBroadcastChannel
    });
  });

  it('renders only the canvas shell on a black background', () => {
    render(<LivePage />);

    expect(screen.getByTestId('live-page')).toHaveClass('bg-black');
    expect(screen.getByTestId('visual-scene')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Generate' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('ReelPod Studio')).not.toBeInTheDocument();
  });

  it('configures VisualScene for live full-bleed black rendering', () => {
    render(<LivePage />);

    expect(visualSceneSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: null,
        audioCurrentTime: 0,
        audioDuration: 0,
        isPlaying: false,
        aspectRatio: 16 / 9,
        visualizerType: 'none',
        effects: ['none'],
        backgroundColor: '#000000',
        showPlaceholderCopy: false,
        fullBleed: true
      })
    );
  });

  it('applies mirrored state updates received over BroadcastChannel', async () => {
    render(<LivePage />);

    await waitFor(() => {
      expect(MockBroadcastChannel.instances.length).toBeGreaterThan(0);
    });

    const broadcaster = new MockBroadcastChannel(LIVE_MIRROR_CHANNEL_NAME);
    broadcaster.postMessage({
      imageUrl: 'blob:http://localhost/live-image',
      audioCurrentTime: 12.34,
      audioDuration: 60,
      isPlaying: true,
      aspectRatio: 9 / 16,
      visualizerType: 'glitch',
      effects: ['zoom', 'colorDrift'],
      backgroundColor: '#000000',
      showPlaceholderCopy: false,
      fullBleed: true,
      sentAt: Date.now()
    });

    await waitFor(() => {
      expect(visualSceneSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          imageUrl: 'blob:http://localhost/live-image',
          audioCurrentTime: 12.34,
          audioDuration: 60,
          isPlaying: true,
          aspectRatio: 9 / 16,
          visualizerType: 'glitch',
          effects: ['zoom', 'colorDrift'],
          backgroundColor: '#000000',
          showPlaceholderCopy: false,
          fullBleed: true
        })
      );
    });
  });
});
