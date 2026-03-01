import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type VisualSceneProps = {
  imageUrl: string | null;
  audioCurrentTime: number;
  audioDuration: number;
  isPlaying: boolean;
  aspectRatio: number;
};

const visualSceneSpy = vi.fn((props: VisualSceneProps) => (
  <div
    data-testid="visual-scene"
    data-image-url={props.imageUrl ?? ''}
    data-audio-current-time={props.audioCurrentTime.toFixed(2)}
    data-audio-duration={props.audioDuration.toFixed(2)}
    data-is-playing={props.isPlaying ? 'true' : 'false'}
    data-aspect-ratio={props.aspectRatio.toFixed(4)}
  />
));

vi.mock('./components/visual-scene', () => ({
  VisualScene: (props: VisualSceneProps) => visualSceneSpy(props)
}));

import { App } from './App';

function createMockAudio(): HTMLAudioElement {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    src: '',
    currentTime: 0,
    duration: 30
  } as unknown as HTMLAudioElement;
}

function createAudioResponse(status = 200): Response {
  if (status >= 200 && status < 300) {
    return new Response(new Blob(['fake-wav-data'], { type: 'audio/wav' }), {
      status,
      headers: { 'content-type': 'audio/wav' }
    });
  }

  return new Response(JSON.stringify({ error: 'audio generation failed' }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createImageResponse(status = 200): Response {
  if (status >= 200 && status < 300) {
    return new Response(new Blob(['fake-image-data'], { type: 'image/png' }), {
      status,
      headers: { 'content-type': 'image/png' }
    });
  }

  return new Response(JSON.stringify({ error: 'image generation failed' }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function mockPairedFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
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
  });
}

describe('App unified generate flow (US-003)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();

    const mockAudio = createMockAudio();
    vi.spyOn(globalThis, 'Audio').mockImplementation(() => mockAudio);
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockPairedFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      if ('type' in obj && obj.type === 'image/png') {
        return 'blob:http://localhost/generated-image-url';
      }

      return 'blob:http://localhost/generated-audio-url';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('triggers both audio and image generation from one Generate click', async () => {
    const fetchMock = mockPairedFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'neon city street at night' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mood: 'chill',
          tempo: 80,
          style: 'jazz',
          duration: 40
        })
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/generate-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'neon city street at night',
          targetWidth: 1920,
          targetHeight: 1080
        })
      });
    });
  });

  it('keeps Generate enabled while processing and transitions queue from Queued -> Generating -> Completed', async () => {
    let resolveAudio: ((value: Response) => void) | undefined;

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveAudio = resolve;
          })
      )
      .mockImplementationOnce(async () => createImageResponse())
      .mockImplementation(async () => createAudioResponse());

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    const generateButton = screen.getByRole('button', { name: 'Generate' });
    fireEvent.click(generateButton);
    fireEvent.click(generateButton);

    expect(generateButton).toBeEnabled();

    await waitFor(() => {
      const first = screen.getByTestId('queue-entry-1');
      const second = screen.getByTestId('queue-entry-2');
      expect(first).toHaveAttribute('data-status', 'generating');
      expect(first).toHaveTextContent('Generating');
      expect(first.querySelector('.animate-spin')).not.toBeNull();
      expect(second).toHaveAttribute('data-status', 'queued');
      expect(second).toHaveTextContent('Queued');
    });

    resolveAudio?.(createAudioResponse());

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });
  });

  it('marks queue entry as failed and shows descriptive error when audio generation fails', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.endsWith('/api/generate-image')) {
        return createImageResponse();
      }

      return createAudioResponse(500);
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const entry = screen.getByTestId('queue-entry-1');
      expect(entry).toHaveAttribute('data-status', 'failed');
      expect(entry).toHaveTextContent('Failed');
      expect(entry).toHaveTextContent('audio generation failed');
    });
  });

  it('shows completed pair with image rendered and audio playback controls ready', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'sunset highway with grainy film look' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-image-url',
      'blob:http://localhost/generated-image-url'
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('does not commit pair when image generation fails', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.endsWith('/api/generate-image')) {
        return createImageResponse(500);
      }

      return createAudioResponse();
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const entry = screen.getByTestId('queue-entry-1');
      expect(entry).toHaveAttribute('data-status', 'failed');
      expect(entry).toHaveTextContent('image generation failed');
    });

    expect(screen.getByTestId('visual-scene')).toHaveAttribute('data-image-url', '');
    expect(screen.queryByRole('button', { name: 'Play generation 1' })).not.toBeInTheDocument();
  });

  it('validates image prompt before enqueueing a unified generation request', () => {
    const fetchMock = mockPairedFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: '   ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    const visualFeedback = screen.getByTestId('visual-prompt-feedback');
    expect(within(visualFeedback).getByRole('alert')).toHaveTextContent(
      'Please enter an image prompt.'
    );
    expect(screen.queryAllByTestId(/queue-entry-/)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
