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
};

const visualSceneSpy = vi.fn((props: VisualSceneProps) => (
  <div
    data-testid="visual-scene"
    data-image-url={props.imageUrl ?? ''}
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

  it('renders the visualizer selector in the Visual prompt section with all visualizer options', () => {
    render(<App />);

    const visualPromptSection = screen.getByRole('region', {
      name: 'Visual prompt'
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

  it('defaults to glitch and updates the active visualizer immediately on selection change', () => {
    render(<App />);

    const selector = screen.getByLabelText(
      'Active visualizer'
    ) as HTMLSelectElement;
    expect(selector.value).toBe('glitch');
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-visualizer-type',
      'glitch'
    );

    fireEvent.change(selector, { target: { value: 'waveform' } });
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-visualizer-type',
      'waveform'
    );
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

describe('App effects toggles (US-002)', () => {
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

  it('lists all 7 effect types and defaults to colorDrift only', () => {
    render(<App />);

    const expectedEffects = [
      'zoom',
      'flicker',
      'vignette',
      'filmGrain',
      'chromaticAberration',
      'scanLines',
      'colorDrift'
    ];

    const effectSection = screen.getByRole('group', {
      name: 'Post-processing effects'
    });
    const checkboxes = within(effectSection).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(7);

    expectedEffects.forEach((effect) => {
      expect(within(effectSection).getByRole('checkbox', { name: effect })).toBeInTheDocument();
    });

    expect(screen.getByRole('checkbox', { name: 'colorDrift' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'zoom' })).not.toBeChecked();
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'colorDrift'
    );
  });

  it('adds and removes effects from the active array immediately when toggled', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'zoom' }));
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

    fireEvent.click(screen.getByRole('checkbox', { name: 'scanLines' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'chromaticAberration' })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'zoom' }));

    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'zoom,chromaticAberration,scanLines,colorDrift'
    );
  });
});

describe('App effect reorder (US-003)', () => {
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

  it('renders Up/Down buttons per effect row and disables first/last boundaries', () => {
    render(<App />);

    const rowZoom = screen.getByTestId('effect-row-zoom');
    const rowColorDrift = screen.getByTestId('effect-row-colorDrift');

    expect(within(rowZoom).getByRole('button', { name: 'Up' })).toBeDisabled();
    expect(within(rowZoom).getByRole('button', { name: 'Down' })).toBeEnabled();
    expect(within(rowColorDrift).getByRole('button', { name: 'Up' })).toBeEnabled();
    expect(within(rowColorDrift).getByRole('button', { name: 'Down' })).toBeDisabled();
  });

  it('moves effects up and down and updates VisualScene effects immediately', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'vignette' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'filmGrain' }));
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'vignette,filmGrain,colorDrift'
    );

    fireEvent.click(
      within(screen.getByTestId('effect-row-vignette')).getByRole('button', {
        name: 'Down'
      })
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'filmGrain,vignette,colorDrift'
    );

    fireEvent.click(
      within(screen.getByTestId('effect-row-vignette')).getByRole('button', {
        name: 'Up'
      })
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-effects',
      'vignette,filmGrain,colorDrift'
    );
  });

  it('keeps enabled effect UI order aligned with effects passed to VisualScene', () => {
    render(<App />);

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

describe('App shared prompt toggle (US-005)', () => {
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

  it('defaults to independent music and image prompts and shows the toggle', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('radio', { name: 'Text + Parameters' }));

    const musicPromptField = screen.getByLabelText('Music prompt');
    const imagePromptField = screen.getByLabelText('Image prompt');
    const samePromptToggle = screen.getByRole('checkbox', {
      name: 'Use same prompt for image'
    });

    expect(musicPromptField).toBeInTheDocument();
    expect(imagePromptField).toBeInTheDocument();
    expect(samePromptToggle).toBeVisible();
    expect(samePromptToggle).not.toBeChecked();

    fireEvent.change(musicPromptField, { target: { value: 'dusty jazz trio' } });
    expect(imagePromptField).toHaveValue('lofi cafe at night, cinematic lighting');
  });

  it('hides image prompt and uses music prompt for image generation in text mode when enabled', async () => {
    const fetchMock = mockPairedFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    fireEvent.change(screen.getByLabelText('Music prompt'), {
      target: { value: 'rainy midnight synthwave' }
    });
    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'old value that should be ignored' }
    });

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Use same prompt for image' })
    );

    expect(screen.queryByLabelText('Image prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/generate-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'rainy midnight synthwave',
          targetWidth: 1920,
          targetHeight: 1080
        })
      });
    });
  });

  it('restores previous image prompt value when toggle is turned off', () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'neon alley in tokyo rain' }
    });

    const samePromptToggle = screen.getByRole('checkbox', {
      name: 'Use same prompt for image'
    });
    fireEvent.click(samePromptToggle);
    expect(screen.queryByLabelText('Image prompt')).not.toBeInTheDocument();

    fireEvent.click(samePromptToggle);
    expect(screen.getByLabelText('Image prompt')).toHaveValue(
      'neon alley in tokyo rain'
    );
  });

  it('uses music prompt for image generation in text + parameters mode when enabled', async () => {
    const fetchMock = mockPairedFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('radio', { name: 'Text + Parameters' }));
    fireEvent.change(screen.getByLabelText('Music prompt'), {
      target: { value: 'nostalgic vinyl crackle piano' }
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Use same prompt for image' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/generate-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'nostalgic vinyl crackle piano',
          targetWidth: 1920,
          targetHeight: 1080
        })
      });
    });
  });
});

describe('App track-image pair binding (US-006)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();

    const mockAudio = createMockAudio();
    vi.spyOn(globalThis, 'Audio').mockImplementation(() => mockAudio);
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockPairedFetch());

    let imageUrlIndex = 0;
    let audioUrlIndex = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (obj: Blob | MediaSource) => {
        if ('type' in obj && obj.type === 'image/png') {
          imageUrlIndex += 1;
          return `blob:http://localhost/generated-image-url-${imageUrlIndex}`;
        }

        audioUrlIndex += 1;
        return `blob:http://localhost/generated-audio-url-${audioUrlIndex}`;
      }
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('binds numbered track-image pairs, preserves prior pairs, and switches image with active playback', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'first scene' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
    });

    expect(screen.getByText('Track 1')).toBeInTheDocument();
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-image-url',
      'blob:http://localhost/generated-image-url-1'
    );

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'second scene' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
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
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-image-url',
      'blob:http://localhost/generated-image-url-1'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play generation 2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-playing',
        'true'
      );
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-image-url',
        'blob:http://localhost/generated-image-url-2'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Play generation 1' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-playing',
        'true'
      );
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-image-url',
        'blob:http://localhost/generated-image-url-1'
      );
    });
  });
});
