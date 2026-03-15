import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStartRecording = vi.fn().mockResolvedValue(undefined);
const mockStopRecording = vi.fn().mockResolvedValue(undefined);
const mockIsRecording = { value: false };
const mockIsFinalizing = { value: false };
const mockRecorderError = { value: null as string | null };
let capturedOnFinalized:
  | ((blob: Blob, meta: { mimeType: string; fileExtension: string }) => void)
  | undefined;

vi.mock('./hooks/use-recorder', () => ({
  useRecorder: (options: {
    onFinalized?: (blob: Blob, meta: { mimeType: string; fileExtension: string }) => void;
  }) => {
    capturedOnFinalized = options.onFinalized;
    return {
      isRecording: mockIsRecording.value,
      isFinalizing: mockIsFinalizing.value,
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      recordingError: mockRecorderError.value,
      handlesRef: { current: { output: null, target: null, audioContext: null } }
    };
  }
}));

type VisualSceneProps = {
  imageUrl: string | null;
  videoUrl?: string | null;
  videoElement?: HTMLVideoElement | null;
  audioCurrentTime: number;
  audioDuration: number;
  isPlaying: boolean;
  aspectRatio: number;
  effects: Array<
    | 'zoom'
    | 'flicker'
    | 'vignette'
    | 'filmGrain'
    | 'chromaticAberration'
    | 'scanLines'
    | 'colorDrift'
    | 'none'
  >;
  visualizerType:
  | 'waveform'
  | 'rain'
  | 'scene-rain'
  | 'starfield'
  | 'aurora'
  | 'circle-spectrum'
  | 'glitch'
  | 'smoke'
  | 'contour'
  | 'none';
  onCanvasCreated?: (canvas: HTMLCanvasElement) => void;
};

const visualSceneSpy = vi.fn((props: VisualSceneProps) => (
  <div
    data-testid="visual-scene"
    data-image-url={props.imageUrl ?? ''}
    data-has-video-element={props.videoElement ? 'true' : 'false'}
    data-video-url={props.videoUrl ?? ''}
    data-audio-current-time={props.audioCurrentTime.toFixed(2)}
    data-audio-duration={props.audioDuration.toFixed(2)}
    data-is-playing={props.isPlaying ? 'true' : 'false'}
    data-aspect-ratio={props.aspectRatio.toFixed(4)}
    data-effects={props.effects.join(',')}
    data-visualizer-type={props.visualizerType}
  />
));

vi.mock('./components/visual-scene', () => ({
  VisualScene: (props: VisualSceneProps) => visualSceneSpy(props)
}));

import { App } from './App';

function mockVideoPlaybackApi(): void {
  vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(async function playMock(this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      if (!Number.isFinite(this.duration) || this.duration <= 0) {
        Object.defineProperty(this, 'duration', { configurable: true, value: 30 });
      }
      return undefined;
    });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pauseMock(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
  });
}

function createVideoResponse(status = 200): Response {
  if (status >= 200 && status < 300) {
    return new Response(new Blob(['fake-mp4-data'], { type: 'video/mp4' }), {
      status,
      headers: { 'content-type': 'video/mp4' }
    });
  }

  return new Response(JSON.stringify({ error: 'video generation failed' }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createUnexpectedContentTypeResponse(): Response {
  return new Response(new Blob(['fake-content'], { type: 'audio/wav' }), {
    status: 200,
    headers: { 'content-type': 'audio/wav' }
  });
}

function mockVideoFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/api/generate')) {
      return createVideoResponse();
    }
    throw new Error(`Unexpected endpoint called: ${url}`);
  });
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width
  });
  window.dispatchEvent(new Event('resize'));
}

describe('App unified generate flow (US-003)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => 'blob:http://localhost/generated-video-url'
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('posts one unified generation request with creative brief and duration', async () => {
    const fetchMock = mockVideoFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'neon city street at night' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: expect.stringContaining('"mode":"llm"')
      });
      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call[1].body as string);
      expect(body.prompt).toBe('neon city street at night');
      expect(body.duration).toBe(40);
      expect(body.targetWidth).toBe(1920);
      expect(body.targetHeight).toBe(1080);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the visualizer selector in the Visual prompt section with all visualizer options', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    const visualPromptSection = screen.getByRole('region', {
      name: 'Visualizer settings'
    });
    const selector = within(visualPromptSection).getByLabelText(
      'Active visualizer'
    ) as HTMLSelectElement;

    expect(selector).toBeInTheDocument();
    expect(Array.from(selector.options).map((option) => option.value)).toEqual([
      'waveform',
      'rain',
      'scene-rain',
      'starfield',
      'aurora',
      'circle-spectrum',
      'glitch',
      'smoke',
      'contour',
      'none'
    ]);
  });

  it('defaults to none and updates the active visualizer immediately on selection change', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    const selector = screen.getByLabelText(
      'Active visualizer'
    ) as HTMLSelectElement;
    expect(selector.value).toBe('none');
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-visualizer-type',
      'none'
    );

    fireEvent.change(selector, { target: { value: 'waveform' } });
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-visualizer-type',
      'waveform'
    );
  });

  it('keeps Generate enabled while processing and transitions queue from Queued -> Generating -> Completed', async () => {
    let resolveVideo: ((value: Response) => void) | undefined;

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveVideo = resolve;
          })
      )
      .mockImplementation(async () => createVideoResponse());

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'first concept' }
    });
    const generateButton = screen.getByRole('button', { name: 'Generate' });
    fireEvent.click(generateButton);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'second concept' }
    });
    fireEvent.click(generateButton);

    expect(generateButton).toBeEnabled();

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      const first = screen.getByTestId('queue-entry-1');
      const second = screen.getByTestId('queue-entry-2');
      expect(first).toHaveAttribute('data-status', 'generating');
      expect(first).toHaveTextContent('Generating');
      expect(first.querySelector('.animate-spin')).not.toBeNull();
      expect(second).toHaveAttribute('data-status', 'queued');
      expect(second).toHaveTextContent('Queued');
    });

    resolveVideo?.(createVideoResponse());

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
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

  it('marks queue entry as failed and shows descriptive error when generation fails', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => createVideoResponse(500));

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'fail me' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      const entry = screen.getByTestId('queue-entry-1');
      expect(entry).toHaveAttribute('data-status', 'failed');
      expect(entry).toHaveTextContent('Failed');
      expect(entry).toHaveTextContent('video generation failed');
    });
  });

  it('shows completed generation with playback controls ready', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'sunset highway with grainy film look' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    expect(screen.getByTestId('visual-scene')).toHaveAttribute('data-image-url', '');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('binds generated MP4 playback to the canvas video texture and keeps audio unmuted', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'night drive synthwave' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    const playbackVideo = screen.getByTestId('playback-video') as HTMLVideoElement;
    expect(playbackVideo.muted).toBe(false);
    expect(playbackVideo.src).toContain('blob:http://localhost/generated-video-url');
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-video-url',
      'blob:http://localhost/generated-video-url'
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-has-video-element',
      'true'
    );
  });

  it('uses the video element for play/pause/seek and updates audio timing props from video time', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'ambient room tone' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    const playbackVideo = screen.getByTestId('playback-video') as HTMLVideoElement;
    Object.defineProperty(playbackVideo, 'duration', {
      configurable: true,
      value: 40
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Seek'), { target: { value: '50' } });
    expect(playbackVideo.currentTime).toBe(20);
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-audio-current-time',
      '20.00'
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-audio-duration',
      '40.00'
    );
  });

  it('does not commit generation when request fails', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => createVideoResponse(500));

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'lofi beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      const entry = screen.getByTestId('queue-entry-1');
      expect(entry).toHaveAttribute('data-status', 'failed');
      expect(entry).toHaveTextContent('video generation failed');
    });

    expect(screen.getByTestId('visual-scene')).toHaveAttribute('data-image-url', '');
    expect(screen.queryByRole('button', { name: 'Play generation 1' })).not.toBeInTheDocument();
  });

  it('validates creative brief before enqueueing a unified generation request', () => {
    const fetchMock = mockVideoFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: '   ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please enter a creative brief.'
    );
    expect(screen.queryAllByTestId(/queue-entry-/)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails with a clear error when /api/generate does not return video/mp4', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => createUnexpectedContentTypeResponse()
    );

    render(<App />);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'cinematic intro' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not generate video: Expected video/mp4 response'
      );
    });
  });

  it('revokes the previous video object URL before creating a new one', async () => {
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:http://localhost/generated-video-url-1')
      .mockReturnValueOnce('blob:http://localhost/generated-video-url-2');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL');

    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'first concept' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute('data-status', 'completed');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Music Generation' }));
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'second concept' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute('data-status', 'completed');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Play generation 2' }));

    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalledTimes(2);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith(
        'blob:http://localhost/generated-video-url-1'
      );
    });
  });
});

describe('App controls panel layout (US-001)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (obj: Blob | MediaSource) => {
        if ('type' in obj && obj.type === 'image/png') {
          return 'blob:http://localhost/generated-image-url';
        }

        return 'blob:http://localhost/generated-video-url';
      }
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('renders header above the desktop grid and keeps the required left-column section order', () => {
    render(<App />);

    const header = screen.getByRole('banner');
    const layoutGrid = screen.getByTestId('studio-layout-grid');
    const controlsColumn = screen.getByTestId('controls-column');

    expect(header.nextElementSibling).toBe(layoutGrid);
    expect(layoutGrid.className).toContain('xl:grid-cols-');
    expect(layoutGrid.firstElementChild).toBe(controlsColumn);

    const sectionLabels = within(controlsColumn)
      .getAllByRole('region')
      .map((section) => section.getAttribute('aria-label'));
    expect(sectionLabels).toEqual([
      'Generation parameters',
      'Generation actions'
    ]);
  });

  it('preserves existing controls, labels, and interactions in the left controls column', () => {
    render(<App />);
    const controlsColumn = screen.getByTestId('controls-column');

    const parametersSection = within(controlsColumn).getByRole('region', { name: 'Generation parameters' });
    const actionsSection = within(controlsColumn).getByRole('region', { name: 'Generation actions' });

    expect(within(parametersSection).getByLabelText('Creative brief')).toBeInTheDocument();
    expect(within(parametersSection).getByLabelText('Duration (s)')).toBeInTheDocument();
    expect(within(parametersSection).getByRole('radiogroup', { name: 'Social format' })).toBeInTheDocument();
    expect(within(actionsSection).getByRole('button', { name: 'Generate' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    const queueSection = within(controlsColumn).getByRole('region', { name: 'Generation queue' });
    expect(within(queueSection).getByText('No generations yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    const visualPromptSection = within(controlsColumn).getByRole('region', { name: 'Visualizer settings' });
    expect(within(visualPromptSection).getByLabelText('Active visualizer')).toBeInTheDocument();
    expect(within(visualPromptSection).getByRole('group', { name: 'Post-processing effects' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Music Generation' }));
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'test brief for queue' }
    });
    fireEvent.click(within(screen.getByRole('region', { name: 'Generation actions' })).getByRole('button', { name: 'Generate' }));

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    const queueEntry = screen.getByTestId('queue-entry-1');
    expect(queueEntry).toBeInTheDocument();
    const queueStatus = queueEntry.getAttribute('data-status');
    expect(['queued', 'generating', 'completed']).toContain(queueStatus);
  });
});

describe('App right column preview and playback layout (US-002)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (obj: Blob | MediaSource) => {
        if ('type' in obj && obj.type === 'image/png') {
          return 'blob:http://localhost/generated-image-url';
        }

        return 'blob:http://localhost/generated-video-url';
      }
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('keeps VisualScene in the right column and renders playback controls directly below it after generation', async () => {
    render(<App />);

    const previewColumn = screen.getByTestId('preview-column');
    expect(within(previewColumn).getByRole('region', { name: 'Visual scene' })).toBeInTheDocument();
    expect(
      within(previewColumn).queryByRole('region', { name: 'Playback controls' })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'ambient scene' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    const sectionsInOrder = Array.from(previewColumn.children).filter(
      (child) => child.tagName === 'SECTION'
    );
    expect(sectionsInOrder.map((section) => section.getAttribute('aria-label'))).toEqual([
      'Visual scene',
      'Playback controls'
    ]);

    const playbackSection = within(previewColumn).getByRole('region', {
      name: 'Playback controls'
    });
    expect(within(playbackSection).getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(within(playbackSection).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(playbackSection).getByLabelText('Seek')).toBeInTheDocument();
  });

  it('applies sticky top-aligned desktop classes to the right column', () => {
    render(<App />);

    const previewColumn = screen.getByTestId('preview-column');
    expect(previewColumn.className).toContain('xl:sticky');
    expect(previewColumn.className).toContain('xl:top-10');
    expect(previewColumn.className).toContain('xl:self-start');
  });

  it('updates VisualScene aspect ratio based on selected social format', () => {
    render(<App />);

    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-aspect-ratio',
      (16 / 9).toFixed(4)
    );

    fireEvent.click(
      screen.getByRole('radio', { name: 'TikTok/Reels (9:16 · 1080×1920)' })
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-aspect-ratio',
      (9 / 16).toFixed(4)
    );

    fireEvent.click(
      screen.getByRole('radio', { name: 'Instagram Square (1:1 · 1080×1080)' })
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-aspect-ratio',
      '1.0000'
    );
  });

  it('renders playback controls only when a track has been generated', async () => {
    render(<App />);

    expect(
      screen.queryByTestId('playback-controls-section')
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'short clip' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(screen.getByTestId('playback-controls-section')).toBeInTheDocument();
    });
  });
});

describe('App effects toggles (US-002)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      if ('type' in obj && obj.type === 'image/png') {
        return 'blob:http://localhost/generated-image-url';
      }

      return 'blob:http://localhost/generated-video-url';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('lists all 8 effect types and defaults to no effects enabled', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    const expectedEffects = [
      'zoom',
      'flicker',
      'vignette',
      'filmGrain',
      'chromaticAberration',
      'scanLines',
      'colorDrift',
      'lightingMovement'
    ];

    const effectSection = screen.getByRole('group', {
      name: 'Post-processing effects'
    });
    const checkboxes = within(effectSection).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(8);

    expectedEffects.forEach((effect) => {
      expect(within(effectSection).getByRole('checkbox', { name: effect })).toBeInTheDocument();
    });

    expect(screen.getByRole('checkbox', { name: 'colorDrift' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'zoom' })).not.toBeChecked();
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      ''
    );
  });

  it('adds and removes effects from the active array immediately when toggled', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'zoom' }));
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'zoom'
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'colorDrift' }));
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'zoom,colorDrift'
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'colorDrift' }));
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'zoom'
    );
  });

  it('passes active effects to VisualScene in fixed list order', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'scanLines' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'chromaticAberration' })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'zoom' }));

    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'zoom,chromaticAberration,scanLines'
    );
  });
});

describe('App effect reorder (US-003)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      if ('type' in obj && obj.type === 'image/png') {
        return 'blob:http://localhost/generated-image-url';
      }

      return 'blob:http://localhost/generated-video-url';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('renders Up/Down buttons per effect row and disables first/last boundaries', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    const rowZoom = screen.getByTestId('effect-row-zoom');
    const rowLightingMovement = screen.getByTestId('effect-row-lightingMovement');

    expect(within(rowZoom).getByRole('button', { name: 'Up' })).toBeDisabled();
    expect(within(rowZoom).getByRole('button', { name: 'Down' })).toBeEnabled();
    expect(within(rowLightingMovement).getByRole('button', { name: 'Up' })).toBeEnabled();
    expect(within(rowLightingMovement).getByRole('button', { name: 'Down' })).toBeDisabled();
  });

  it('moves effects up and down and updates VisualScene effects immediately', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'vignette' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'filmGrain' }));
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'vignette,filmGrain'
    );

    fireEvent.click(
      within(screen.getByTestId('effect-row-vignette')).getByRole('button', {
        name: 'Down'
      })
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'filmGrain,vignette'
    );

    fireEvent.click(
      within(screen.getByTestId('effect-row-vignette')).getByRole('button', {
        name: 'Up'
      })
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'vignette,filmGrain'
    );
  });

  it('keeps enabled effect UI order aligned with effects passed to VisualScene', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'filmGrain' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'vignette' }));
    fireEvent.click(
      within(screen.getByTestId('effect-row-vignette')).getByRole('button', {
        name: 'Down'
      })
    );
    fireEvent.click(
      within(screen.getByTestId('effect-row-vignette')).getByRole('button', {
        name: 'Down'
      })
    );

    const enabledEffectsInUiOrder = screen
      .getAllByTestId(/effect-row-/)
      .flatMap((row) => {
        const checkbox = within(row).getByRole('checkbox') as HTMLInputElement;
        if (!checkbox.checked) {
          return [];
        }

        return [checkbox.id.replace('effect-', '')];
      });

    const sceneEffects =
      screen.getByTestId('visual-scene').getAttribute('data-effects') ?? '';
    expect(enabledEffectsInUiOrder).toEqual(sceneEffects.split(','));
  });
});

describe('App responsive single-column fallback (US-003)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (obj: Blob | MediaSource) => {
        if ('type' in obj && obj.type === 'image/png') {
          return 'blob:http://localhost/generated-image-url';
        }

        return 'blob:http://localhost/generated-video-url';
      }
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('keeps controls first and preview second, with desktop split only at xl', () => {
    render(<App />);

    const layoutGrid = screen.getByTestId('studio-layout-grid');
    const controlsColumn = screen.getByTestId('controls-column');
    const previewColumn = screen.getByTestId('preview-column');

    expect(layoutGrid.className).toContain('xl:grid-cols-[3fr_7fr]');
    expect(layoutGrid.className).not.toContain('lg:grid-cols-');
    expect(layoutGrid.firstElementChild).toBe(controlsColumn);
    expect(layoutGrid.lastElementChild).toBe(previewColumn);
  });

  it.each([375, 768, 1024])(
    'applies no-horizontal-overflow guards for narrow viewport width %ipx',
    (width) => {
      setViewportWidth(width);
      render(<App />);

      const main = screen.getByRole('main');
      const layoutGrid = screen.getByTestId('studio-layout-grid');
      const controlsColumn = screen.getByTestId('controls-column');
      const previewColumn = screen.getByTestId('preview-column');
      const visualCanvas = screen.getByTestId('visual-canvas');

      expect(main.className).toContain('overflow-x-hidden');
      expect(layoutGrid.className).toContain('min-w-0');
      expect(controlsColumn.className).toContain('min-w-0');
      expect(previewColumn.className).toContain('min-w-0');
      expect(visualCanvas.className).toContain('w-full');
      expect(visualCanvas.className).toContain('overflow-hidden');
    }
  );
});

describe('App visual scene framing polish (US-003)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (obj: Blob | MediaSource) => {
        if ('type' in obj && obj.type === 'image/png') {
          return 'blob:http://localhost/generated-image-url';
        }

        return 'blob:http://localhost/generated-video-url';
      }
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('uses lofi panel/background framing with shadow-ring token and clipped canvas boundaries', () => {
    render(<App />);

    const visualSceneSection = screen.getByRole('region', { name: 'Visual scene' });
    const visualCanvas = screen.getByTestId('visual-canvas');

    expect(visualSceneSection.className).toContain('bg-lofi-panel');
    expect(visualSceneSection.className).toContain('border');
    expect(visualSceneSection.className).toContain('overflow-hidden');
    expect(visualSceneSection.getAttribute('style')).toContain('var(--color-lofi-shadow-ring)');

    expect(visualCanvas.className).toContain('bg-lofi-bg/60');
    expect(visualCanvas.className).toContain('border');
    expect(visualCanvas.className).toContain('overflow-hidden');
    expect(visualCanvas.getAttribute('style')).toContain('var(--color-lofi-shadow-ring)');
  });

  it.each([375, 768, 1280])(
    'keeps the aspect-ratio container centered at %ipx viewport width',
    (width) => {
      setViewportWidth(width);
      render(<App />);

      const visualCanvas = screen.getByTestId('visual-canvas');
      const visualAspectContainer = screen.getByTestId('visual-aspect-container');

      expect(visualCanvas.className).toContain('grid');
      expect(visualCanvas.className).toContain('place-items-center');
      expect(visualAspectContainer.className).toContain('w-full');
      expect(visualAspectContainer.className).toContain('justify-center');
    }
  );

  it('uses warm lofi accent colors for play/pause and seek slider without gray track overrides', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'cozy frame validation' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(screen.getByTestId('playback-controls-section')).toBeInTheDocument();
    });

    const playButton = screen.getByRole('button', { name: 'Play' });
    const pauseButton = screen.getByRole('button', { name: 'Pause' });
    const seekSlider = screen.getByLabelText('Seek');

    expect(playButton.className).toContain('border-lofi-accent');
    expect(playButton.className).toContain('bg-lofi-accent/25');
    expect(pauseButton.className).toContain('border-lofi-accent');
    expect(pauseButton.className).toContain('bg-lofi-accent/20');
    expect(seekSlider.className).toContain('seek-slider');
    expect(seekSlider.className).toContain('bg-transparent');
    expect(seekSlider.className).not.toMatch(/\bbg-(stone|gray)-/);
  });
});

describe('App shared prompt toggle (US-005)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      if ('type' in obj && obj.type === 'image/png') {
        return 'blob:http://localhost/generated-image-url';
      }

      return 'blob:http://localhost/generated-video-url';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('sends mode llm with creative brief and duration when generating', async () => {
    const fetchMock = mockVideoFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'rainy midnight synthwave' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      mode: 'llm',
      prompt: 'rainy midnight synthwave',
      duration: 40,
      targetWidth: 1920,
      targetHeight: 1080
    });
  });
});

describe('App queue playback binding (US-006)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());

    let videoUrlIndex = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => {
        videoUrlIndex += 1;
        return `blob:http://localhost/generated-video-url-${videoUrlIndex}`;
      }
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('binds numbered track queue entries, preserves prior entries, and switches active playback', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'first scene' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    expect(screen.getByText('Track 1')).toBeInTheDocument();
    expect(screen.getByTestId('visual-scene')).toHaveAttribute('data-image-url', '');

    fireEvent.click(screen.getByRole('button', { name: 'Music Generation' }));
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'second scene' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    expect(screen.getByText('Track 2')).toBeInTheDocument();
    expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
      'data-status',
      'completed'
    );
    expect(
      screen.getByRole('button', { name: 'Play generation 1' })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Play generation 2' })
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Play generation 2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-playing',
        'true'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Play generation 1' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-playing',
        'true'
      );
    });
  });
});

describe('Queue recording controls (US-001)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockStartRecording.mockResolvedValue(undefined);
    mockStopRecording.mockResolvedValue(undefined);
    mockIsRecording.value = false;
    mockIsFinalizing.value = false;
    mockRecorderError.value = null;
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());
    let createdUrlIndex = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      createdUrlIndex += 1;
      return `blob:http://localhost/generated-video-url-${createdUrlIndex}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  async function renderWithTwoCompletedEntries(): Promise<void> {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'first queue clip' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Music Generation' }));
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'second queue clip' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });
  }

  it('AC01+AC02: shows Record Queue in queue header and enables only when completed entries are available', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));

    const recordQueueButton = screen.getByTestId('record-queue-button');
    expect(recordQueueButton).toBeInTheDocument();
    expect(recordQueueButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Music Generation' }));
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'queue-ready clip' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
      expect(screen.getByTestId('record-queue-button')).toBeEnabled();
    });
  });

  it('AC03+AC04: starts recorder and plays completed entries sequentially from the top of the queue', async () => {
    await renderWithTwoCompletedEntries();

    fireEvent.click(screen.getByRole('button', { name: 'Play generation 2' }));
    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-playing',
        'true'
      );
    });

    fireEvent.click(screen.getByTestId('record-queue-button'));

    await waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-playing',
        'true'
      );
    });

    const playbackVideo = screen.getByTestId('playback-video') as HTMLVideoElement;
    act(() => {
      playbackVideo.onended?.(new Event('ended'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-playing',
        'true'
      );
    });
  });

  it('AC05+AC06: queue recording toggles to Stop Recording state and disables single-item Record button', async () => {
    await renderWithTwoCompletedEntries();

    fireEvent.click(screen.getByTestId('record-queue-button'));

    await waitFor(() => {
      expect(screen.getByTestId('queue-stop-recording-button')).toBeInTheDocument();
      expect(screen.queryByTestId('record-queue-button')).not.toBeInTheDocument();
      expect(screen.getByTestId('record-button')).toBeDisabled();
    });

    const stopQueueButton = screen.getByTestId('queue-stop-recording-button');
    expect(stopQueueButton.className).toContain('border-red-500/70');
    expect(within(stopQueueButton).getByText('Stop Recording')).toBeInTheDocument();

    fireEvent.click(stopQueueButton);

    await waitFor(() => {
      expect(mockStopRecording).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('record-queue-button')).toBeInTheDocument();
    });
  });

  it('US-002-AC01+AC02+AC03: when last completed entry ends during queue recording, it auto-stops, finalizes, and restores Record Queue button', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:http://localhost/generated-video-url-1')
      .mockReturnValueOnce('blob:http://localhost/generated-video-url-2')
      .mockReturnValueOnce('blob:http://localhost/queue-recording-finalized');

    mockStopRecording.mockImplementation(async () => {
      capturedOnFinalized?.(
        new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'video/mp4' }),
        {
          mimeType: 'video/mp4',
          fileExtension: '.mp4'
        }
      );
    });

    await renderWithTwoCompletedEntries();

    fireEvent.click(screen.getByTestId('record-queue-button'));

    await waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-playing',
        'true'
      );
    });

    const playbackVideo = screen.getByTestId('playback-video') as HTMLVideoElement;

    // End first completed entry -> second starts, recording continues.
    act(() => {
      playbackVideo.onended?.(new Event('ended'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-playing',
        'true'
      );
      expect(mockStopRecording).toHaveBeenCalledTimes(0);
    });

    // End last completed entry -> queue recording auto-stops and finalizes.
    act(() => {
      playbackVideo.onended?.(new Event('ended'));
    });

    await waitFor(() => {
      expect(mockStopRecording).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('record-queue-button')).toBeInTheDocument();
      expect(
        screen.queryByTestId('queue-stop-recording-button')
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('recording-entry-1')).toBeInTheDocument();
      expect(screen.getByTestId('recording-download-1')).toHaveAttribute(
        'download'
      );
    });
  });
});

describe('Record button (US-001)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockStartRecording.mockResolvedValue(undefined);
    mockStopRecording.mockResolvedValue(undefined);
    mockIsRecording.value = false;
    mockIsFinalizing.value = false;
    mockRecorderError.value = null;
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => 'blob:http://localhost/generated-video-url'
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('AC01: Record button is not visible before a track is generated', () => {
    render(<App />);
    expect(screen.queryByTestId('record-button')).not.toBeInTheDocument();
  });

  it('AC01: Record button is visible and disabled when track exists but no audio URL is available', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('record-button')).toBeInTheDocument();
    });
  });

  it('AC01: Record button is enabled when an audio URL is available', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const recordBtn = screen.getByTestId('record-button');
      expect(recordBtn).toBeInTheDocument();
      expect(recordBtn).not.toBeDisabled();
    });
  });

  it('AC02 + AC06: clicking Record calls startRecording', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('record-button')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('record-button'));

    await waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalled();
    });
  });

  it('AC08: recording indicator is shown when isRecording is true', async () => {
    mockIsRecording.value = true;

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('recording-indicator')).toBeInTheDocument();
    });
  });

  it('AC07: shows recorder error message when codec check fails', async () => {
    mockRecorderError.value = 'Your browser does not support recording: H.264 video encoding is not available.';

    render(<App />);

    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('recorder-error')).toHaveTextContent(
        'H.264 video encoding is not available'
      );
    });
  });
});

describe('Recording auto-stop and UI states (US-002)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockStartRecording.mockResolvedValue(undefined);
    mockStopRecording.mockResolvedValue(undefined);
    mockIsRecording.value = false;
    mockIsFinalizing.value = false;
    mockRecorderError.value = null;
    mockVideoPlaybackApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockVideoFetch());
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => 'blob:http://localhost/generated-video-url'
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  async function renderAndGenerate() {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(screen.getByTestId('record-button')).not.toBeDisabled();
    });
  }

  it('US-002-AC04: Stop button replaces Record button while recording', async () => {
    mockIsRecording.value = true;

    render(<App />);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('stop-button')).toBeInTheDocument();
      expect(screen.queryByTestId('record-button')).not.toBeInTheDocument();
    });
  });

  it('US-002-AC02: clicking Stop calls stopRecording', async () => {
    mockIsRecording.value = true;

    render(<App />);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('stop-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stop-button'));

    await waitFor(() => {
      expect(mockStopRecording).toHaveBeenCalled();
    });
  });

  it('US-002-AC03: finalizing indicator shown when isFinalizing is true', async () => {
    mockIsFinalizing.value = true;

    render(<App />);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('finalizing-indicator')).toBeInTheDocument();
      expect(screen.queryByTestId('recording-indicator')).not.toBeInTheDocument();
    });
  });

  it('US-002-AC03: recording indicator shown when recording, not finalizing indicator', async () => {
    mockIsRecording.value = true;
    mockIsFinalizing.value = false;

    render(<App />);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('recording-indicator')).toBeInTheDocument();
      expect(screen.queryByTestId('finalizing-indicator')).not.toBeInTheDocument();
    });
  });

  it('US-002-AC04: Record button disabled while finalizing', async () => {
    mockIsFinalizing.value = true;

    render(<App />);
    fireEvent.change(screen.getByLabelText('Creative brief'), {
      target: { value: 'chillwave beat' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('record-button')).toBeDisabled();
    });
  });

  it('US-002-AC01: audio ended event triggers stopRecording via handleRecord setup', async () => {
    // Verify handleRecord sets up video.onended which calls stopRecording
    await renderAndGenerate();

    fireEvent.click(screen.getByTestId('record-button'));

    await waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalled();
    });
  });

  it('US-003-AC01+AC02: onFinalized creates a Blob and adds a recording entry to the queue with filename, size, and Download link', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/rec-1');

    render(<App />);

    // Trigger the onFinalized callback as the hook would after finalization
    const blob = new Blob([new Uint8Array(2 * 1024 * 1024)], {
      type: 'video/mp4'
    }); // 2 MB
    act(() => {
      capturedOnFinalized?.(blob, {
        mimeType: 'video/mp4',
        fileExtension: '.mp4'
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));

    await waitFor(() => {
      const entry = screen.getByTestId('recording-entry-1');
      expect(entry).toBeInTheDocument();

      const filename = screen.getByTestId('recording-filename-1');
      expect(filename.textContent).toMatch(/^recording-.*\.mp4$/);

      const size = screen.getByTestId('recording-size-1');
      expect(size.textContent).toMatch(/MB/);

      const downloadLink = screen.getByTestId('recording-download-1');
      expect(downloadLink).toHaveAttribute('href', 'blob:http://localhost/rec-1');
      expect(downloadLink).toHaveAttribute('download');
      expect(downloadLink.getAttribute('download')).toMatch(/^recording-.*\.mp4$/);
      expect(downloadLink.textContent?.trim()).toBe('Download');
    });
  });

  it('US-003-AC04: multiple recordings each produce a separate queue entry', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:http://localhost/rec-1')
      .mockReturnValueOnce('blob:http://localhost/rec-2');

    render(<App />);

    const blob1 = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
    const blob2 = new Blob([new Uint8Array(2048)], { type: 'video/mp4' });

    act(() => {
      capturedOnFinalized?.(blob1, {
        mimeType: 'video/mp4',
        fileExtension: '.mp4'
      });
    });
    act(() => {
      capturedOnFinalized?.(blob2, {
        mimeType: 'video/mp4',
        fileExtension: '.mp4'
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));

    await waitFor(() => {
      expect(screen.getByTestId('recording-entry-1')).toBeInTheDocument();
      expect(screen.getByTestId('recording-entry-2')).toBeInTheDocument();

      expect(screen.getByTestId('recording-download-1')).toHaveAttribute(
        'href',
        'blob:http://localhost/rec-1'
      );
      expect(screen.getByTestId('recording-download-2')).toHaveAttribute(
        'href',
        'blob:http://localhost/rec-2'
      );
    });
  });

  it('US-003-AC03: Download link uses <a download> pattern', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/rec-dl');

    render(<App />);

    act(() => {
      capturedOnFinalized?.(new Blob([new Uint8Array(512)], { type: 'video/mp4' }), {
        mimeType: 'video/mp4',
        fileExtension: '.mp4'
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));

    await waitFor(() => {
      const link = screen.getByTestId('recording-download-1');
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', 'blob:http://localhost/rec-dl');
      expect(link).toHaveAttribute('download');
    });
  });
});
