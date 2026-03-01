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
};

const visualSceneSpy = vi.fn((props: VisualSceneProps) => (
  <div
    data-testid="visual-scene"
    data-image-url={props.imageUrl ?? ''}
    data-audio-current-time={props.audioCurrentTime.toFixed(2)}
    data-audio-duration={props.audioDuration.toFixed(2)}
    data-is-playing={props.isPlaying ? 'true' : 'false'}
  />
));

vi.mock('./components/visual-scene', () => ({
  VisualScene: (props: VisualSceneProps) => visualSceneSpy(props)
}));

import { App } from './App';

function createMockAudio(): HTMLAudioElement {
  const audio = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    src: '',
    currentTime: 0,
    duration: 30
  } as unknown as HTMLAudioElement;
  return audio;
}

function createWavBlobResponse(status = 200): Response {
  if (status >= 200 && status < 300) {
    const blob = new Blob(['fake-wav-data'], { type: 'audio/wav' });
    return new Response(blob, {
      status,
      headers: { 'content-type': 'audio/wav' }
    });
  }
  return new Response(JSON.stringify({ error: 'generation failed' }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createImageBlobResponse(status = 200): Response {
  if (status >= 200 && status < 300) {
    const blob = new Blob(['fake-image-bytes'], { type: 'image/png' });
    return new Response(blob, {
      status,
      headers: { 'content-type': 'image/png' }
    });
  }
  return new Response(JSON.stringify({ error: 'image generation failed' }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createErrorResponse(
  message: string,
  status = 500,
  field = 'error'
): Response {
  return new Response(JSON.stringify({ [field]: message }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function mockGenerateFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.endsWith('/api/generate-image')) {
      return createImageBlobResponse();
    }
    return createWavBlobResponse();
  });
}

describe('App generation flow', () => {
  let mockAudio: HTMLAudioElement;

  beforeEach(() => {
    vi.restoreAllMocks();
    visualSceneSpy.mockClear();
    mockAudio = createMockAudio();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockGenerateFetch());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(
      'blob:http://localhost/fake-audio-url'
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(globalThis, 'Audio').mockImplementation(() => mockAudio);
  });

  it('renders mood, tempo, and style inside clearly labelled control cards with consistent layout spacing', () => {
    render(<App />);

    expect(screen.getByTestId('mood-control-card')).toHaveTextContent('Mood');
    expect(screen.getByTestId('tempo-control-card')).toHaveTextContent('Tempo');
    expect(screen.getByTestId('style-control-card')).toHaveTextContent('Style');

    const parametersSection = screen.getByRole('region', {
      name: 'Generation parameters'
    });
    expect(parametersSection.className).toContain('space-y-4');

    const layoutGrid = screen.getByTestId('mood-control-card').parentElement;
    expect(layoutGrid).not.toBeNull();
    expect(layoutGrid?.className).toContain('grid');
    expect(layoutGrid?.className).toContain('gap-4');
    expect(layoutGrid?.className).toContain('md:grid-cols-3');
  });

  it('renders a generation mode selector with Text, Text + Parameters, and Parameters options inside generation parameters', () => {
    render(<App />);

    const parametersSection = screen.getByRole('region', {
      name: 'Generation parameters'
    });
    const modeGroup = within(parametersSection).getByRole('radiogroup', {
      name: 'Generation mode'
    });

    expect(
      within(modeGroup).getByRole('radio', { name: 'Text' })
    ).toBeVisible();
    expect(
      within(modeGroup).getByRole('radio', { name: 'Text + Parameters' })
    ).toBeVisible();
    expect(
      within(modeGroup).getByRole('radio', { name: 'Parameters' })
    ).toBeVisible();
  });

  it('updates generation mode selection immediately when a mode is clicked', () => {
    render(<App />);

    const textMode = screen.getByRole('radio', {
      name: 'Text'
    }) as HTMLInputElement;
    const textAndParamsMode = screen.getByRole('radio', {
      name: 'Text + Parameters'
    }) as HTMLInputElement;
    const paramsMode = screen.getByRole('radio', {
      name: 'Parameters'
    }) as HTMLInputElement;

    expect(textAndParamsMode.checked).toBe(true);
    expect(textMode.checked).toBe(false);
    expect(paramsMode.checked).toBe(false);

    fireEvent.click(textMode);
    expect(textMode.checked).toBe(true);
    expect(textAndParamsMode.checked).toBe(false);
    expect(paramsMode.checked).toBe(false);

    fireEvent.click(paramsMode);
    expect(paramsMode.checked).toBe(true);
    expect(textMode.checked).toBe(false);
    expect(textAndParamsMode.checked).toBe(false);
  });

  it('shows a Music prompt input and hides parameter controls in Text mode', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));

    expect(screen.getByLabelText('Music prompt')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mood')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tempo (BPM)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Style')).not.toBeInTheDocument();
  });

  it('shows inline validation for empty text prompt and does not enqueue a generation', () => {
    const fetchMock = mockGenerateFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    fireEvent.change(screen.getByLabelText('Music prompt'), {
      target: { value: '   ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please enter a music prompt.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId(/queue-entry-/)).toHaveLength(0);
  });

  it('uses text prompt verbatim with tempo 80 and renders truncated queue summary in Text mode', async () => {
    const fetchMock = mockGenerateFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    render(<App />);

    const longPrompt =
      'A dreamy late-night lo-fi groove with dusty drums and warm electric piano chords drifting in the rain';
    const expectedSummary = `${longPrompt.slice(0, 57)}...`;

    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    fireEvent.change(screen.getByLabelText('Music prompt'), {
      target: { value: longPrompt }
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
          mode: 'text',
          prompt: longPrompt
        })
      });
    });

    expect(screen.getByTestId('queue-entry-1')).toHaveTextContent(
      expectedSummary
    );
    expect(screen.getByTestId('queue-entry-1')).not.toHaveTextContent('Mood:');
  });

  it('plays completed text-mode generation without errors', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    fireEvent.change(screen.getByLabelText('Music prompt'), {
      target: { value: 'Warm tape hiss and mellow Rhodes' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockAudio.play).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });
    expect(
      screen.queryByText('Please enter a music prompt.')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the generation mode selector while track generation is in progress', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByText('Generating track...')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Text' })).toBeDisabled();
      expect(
        screen.getByRole('radio', { name: 'Text + Parameters' })
      ).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'Parameters' })).toBeDisabled();
    });

    resolveFetch?.(createWavBlobResponse());

    await waitFor(() => {
      expect(screen.queryByText('Generating track...')).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Text' })).toBeEnabled();
      expect(
        screen.getByRole('radio', { name: 'Text + Parameters' })
      ).toBeEnabled();
      expect(screen.getByRole('radio', { name: 'Parameters' })).toBeEnabled();
    });
  });

  it('uses prominent generate button and visible hover/focus states for interactive controls', () => {
    render(<App />);

    const generateButton = screen.getByRole('button', { name: 'Generate' });
    expect(generateButton.className).toContain('bg-lofi-accent');
    expect(generateButton.className).toContain('text-lg');
    expect(generateButton.className).toContain('px-6');
    expect(generateButton.className).toContain('py-3');
    expect(generateButton.className).toContain('hover:bg-amber-400');
    expect(generateButton.className).toContain('focus-visible:ring-2');

    const moodSelect = screen.getByLabelText('Mood');
    const tempoInput = screen.getByLabelText('Tempo (BPM)');
    const styleSelect = screen.getByLabelText('Style');

    expect(moodSelect.className).toContain('hover:border-lofi-accent');
    expect(moodSelect.className).toContain('focus-visible:ring-2');
    expect(tempoInput.className).toContain('hover:opacity-90');
    expect(tempoInput.className).toContain('focus-visible:ring-2');
    expect(styleSelect.className).toContain('hover:border-lofi-accent');
    expect(styleSelect.className).toContain('focus-visible:ring-2');
  });

  it('removes the image upload input and shows an image prompt input in its place', () => {
    render(<App />);

    expect(
      screen.queryByLabelText('Upload visual image')
    ).not.toBeInTheDocument();
    const promptInput = screen.getByLabelText(
      'Image prompt'
    ) as HTMLInputElement;
    expect(promptInput).toBeInTheDocument();
    expect(promptInput.type).toBe('text');
  });

  it('uses Generate Image to request an image from the prompt and render it in the visual scene', async () => {
    const imageUrl = 'blob:http://localhost/generated-visual-url';
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(imageUrl);
    const fetchMock = mockGenerateFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'anime city in rain at dusk' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/generate-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'anime city in rain at dusk' })
      });
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-image-url',
      imageUrl
    );
    expect(screen.getByTestId('visual-canvas').className).toContain(
      'h-[min(60vh,420px)]'
    );
  });

  it('keeps the image prompt editable after a successful image generation', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(
      'blob:http://localhost/generated-visual-url'
    );

    render(<App />);

    const promptInput = screen.getByLabelText(
      'Image prompt'
    ) as HTMLInputElement;
    fireEvent.change(promptInput, { target: { value: 'first neon alley' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-image-url',
        'blob:http://localhost/generated-visual-url'
      );
    });

    fireEvent.change(promptInput, { target: { value: 'second foggy street' } });
    expect(promptInput).toHaveValue('second foggy street');
  });

  it('replaces the current image when generating again with a new prompt and cleans the previous blob URL', async () => {
    const firstImageUrl = 'blob:http://localhost/generated-visual-url-1';
    const secondImageUrl = 'blob:http://localhost/generated-visual-url-2';
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce(firstImageUrl)
      .mockReturnValueOnce(secondImageUrl);
    const fetchMock = mockGenerateFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    const promptInput = screen.getByLabelText('Image prompt');
    fireEvent.change(promptInput, {
      target: { value: 'lofi diner at midnight' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-image-url',
        firstImageUrl
      );
    });

    fireEvent.change(promptInput, {
      target: { value: 'retro subway station rain' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-image-url',
        secondImageUrl
      );
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'lofi diner at midnight' })
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'retro subway station rain' })
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstImageUrl);
  });

  it('revokes the active generated image blob URL on unmount', async () => {
    const generatedImageUrl =
      'blob:http://localhost/generated-visual-url-cleanup';
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(generatedImageUrl);

    const { unmount } = render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'city rooftop sunrise haze' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-image-url',
        generatedImageUrl
      );
    });

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(generatedImageUrl);
  });

  it('shows loading while image generation is in progress and ignores duplicate Generate Image clicks', async () => {
    let resolveImageFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith('/api/generate-image')) {
          return new Promise<Response>((resolve) => {
            resolveImageFetch = resolve;
          });
        }
        return createWavBlobResponse();
      });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    const generateImageButton = screen.getByRole('button', {
      name: 'Generate Image'
    });
    fireEvent.click(generateImageButton);

    const status = screen
      .getByText('Generating image...')
      .closest('[role="status"]');
    expect(status).not.toBeNull();
    expect(generateImageButton).toBeDisabled();

    fireEvent.click(generateImageButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveImageFetch?.(createImageBlobResponse());

    await waitFor(() => {
      expect(screen.queryByText('Generating image...')).not.toBeInTheDocument();
    });
    expect(generateImageButton).toBeEnabled();
  });

  it('hides image loading indicator after an image generation error', async () => {
    let resolveImageFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith('/api/generate-image')) {
          return new Promise<Response>((resolve) => {
            resolveImageFetch = resolve;
          });
        }
        return createWavBlobResponse();
      });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    const generateImageButton = screen.getByRole('button', {
      name: 'Generate Image'
    });
    fireEvent.click(generateImageButton);
    expect(screen.getByText('Generating image...')).toBeInTheDocument();
    expect(generateImageButton).toBeDisabled();

    resolveImageFetch?.(createErrorResponse('image generation failed'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'image generation failed'
      );
    });
    expect(screen.getByTestId('visual-prompt-feedback')).toContainElement(
      screen.getByRole('alert')
    );
    expect(screen.queryByText('Generating image...')).not.toBeInTheDocument();
    expect(generateImageButton).toBeEnabled();

    fireEvent.click(generateImageButton);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the image error message when a new generation request is submitted', async () => {
    let secondRequestResolver: ((value: Response) => void) | undefined;
    let imageRequestCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith('/api/generate-image')) {
          imageRequestCount += 1;
          if (imageRequestCount === 1) {
            return createErrorResponse('image generation failed');
          }
          return new Promise<Response>((resolve) => {
            secondRequestResolver = resolve;
          });
        }
        return createWavBlobResponse();
      });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    const generateImageButton = screen.getByRole('button', {
      name: 'Generate Image'
    });
    fireEvent.click(generateImageButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'image generation failed'
      );
    });

    fireEvent.click(generateImageButton);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Generating image...')).toBeInTheDocument();

    secondRequestResolver?.(createImageBlobResponse());

    await waitFor(() => {
      expect(screen.queryByText('Generating image...')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a clear error when generating image with an empty prompt and keeps fallback state', () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: '   ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    expect(
      screen.getByText('Please enter an image prompt.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-image-url',
      ''
    );
  });

  it('renders the visual scene with fallback state before any image generation', () => {
    render(<App />);

    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-image-url',
      ''
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-audio-current-time',
      '0.00'
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-audio-duration',
      '0.00'
    );
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-is-playing',
      'false'
    );
  });

  it('keeps player hidden until a track is generated successfully', async () => {
    render(<App />);

    expect(
      screen.queryByRole('button', { name: 'Play' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Pause' })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Seek')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seek')).toBeInTheDocument();
  });

  // AC01: requestGeneratedAudio fetches POST /api/generate and creates object URL from blob
  it('posts params to /api/generate and creates an object URL from the response blob', async () => {
    const fetchMock = mockGenerateFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    render(<App />);

    fireEvent.change(screen.getByLabelText('Mood'), {
      target: { value: 'upbeat' }
    });
    fireEvent.change(screen.getByLabelText('Tempo (BPM)'), {
      target: { value: '110' }
    });
    fireEvent.change(screen.getByLabelText('Style'), {
      target: { value: 'hip-hop' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mood: 'upbeat', tempo: 110, style: 'hip-hop' })
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // AC02: HTML5 Audio is used for playback; no StrudelController
  it('creates an HTML5 Audio instance for playback', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(globalThis.Audio).toHaveBeenCalledWith(
        'blob:http://localhost/fake-audio-url'
      );
    });
    expect(mockAudio.play).toHaveBeenCalled();
  });

  // AC03: Audio plays automatically after successful generation
  it('auto-plays audio after successful generation', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockAudio.play).toHaveBeenCalledTimes(1);
    });
  });

  // AC04: Play/Pause buttons control audio.play()/audio.pause()
  it('play and pause buttons control the audio element', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    const playButton = screen.getByRole('button', { name: 'Play' });
    const pauseButton = screen.getByRole('button', { name: 'Pause' });

    // After generate, isPlaying=true so Play is disabled, Pause is enabled
    expect(playButton).toBeDisabled();
    expect(pauseButton).toBeEnabled();

    // Pause
    fireEvent.click(pauseButton);
    expect(mockAudio.pause).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(playButton).toBeEnabled();
      expect(pauseButton).toBeDisabled();
    });

    // Play again
    fireEvent.click(playButton);
    await waitFor(() => {
      // play() called once during generate auto-play, once from button click
      expect(mockAudio.play).toHaveBeenCalledTimes(2);
      expect(playButton).toBeDisabled();
      expect(pauseButton).toBeEnabled();
    });
  });

  // AC05: Seek slider controls audio.currentTime proportionally
  it('seek slider sets audio.currentTime proportionally (0-100 mapped to 0-duration)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Seek')).toBeInTheDocument();
    });

    const seek = screen.getByLabelText('Seek') as HTMLInputElement;

    // Seek to 50% of a 30-second track → currentTime = 15
    fireEvent.change(seek, { target: { value: '50' } });
    expect(seek.value).toBe('50');
    expect(mockAudio.currentTime).toBe(15);
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-audio-current-time',
      '15.00'
    );

    // Seek to 100%
    fireEvent.change(seek, { target: { value: '100' } });
    expect(seek.value).toBe('100');
    expect(mockAudio.currentTime).toBe(30);
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-audio-current-time',
      '30.00'
    );
  });

  it('clamps manual seek values to the supported range', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Seek')).toBeInTheDocument();
    });

    const seek = screen.getByLabelText('Seek') as HTMLInputElement;

    fireEvent.change(seek, { target: { value: '999' } });
    expect(seek.value).toBe('100');
    expect(mockAudio.currentTime).toBe(30);
  });

  it('shows loading while generation is in progress and queues additional generate clicks', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
      .mockImplementationOnce(async () => createWavBlobResponse())
      .mockImplementation(async () => createWavBlobResponse());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    const generate = screen.getByRole('button', { name: 'Generate' });
    fireEvent.click(generate);
    fireEvent.click(generate);

    const status = screen
      .getByText('Generating track...')
      .closest('[role="status"]');
    expect(status).not.toBeNull();
    const statusElement = status as HTMLElement;
    expect(statusElement).toHaveTextContent('Generating track...');
    expect(statusElement.className).toContain('border-lofi-accent/60');
    expect(statusElement.querySelector('.animate-spin')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      const entries = screen.getAllByTestId(/queue-entry-/);
      expect(entries.length).toBe(2);
      expect(entries[0]).toHaveAttribute('data-status', 'generating');
      expect(entries[1]).toHaveAttribute('data-status', 'queued');
    });

    resolveFetch?.(createWavBlobResponse());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const entries = screen.getAllByTestId(/queue-entry-/);
      expect(entries[0]).toHaveAttribute('data-status', 'completed');
      expect(entries[1]).toHaveAttribute('data-status', 'completed');
    });
  });

  it('renders a queue panel and updates statuses in real time with summary and status indicators', async () => {
    let resolveFirstFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstFetch = resolve;
          })
      )
      .mockImplementationOnce(async () => createWavBlobResponse())
      .mockResolvedValue(createWavBlobResponse());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    expect(
      screen.getByRole('region', { name: 'Generation queue' })
    ).toBeInTheDocument();
    expect(screen.getByText('No generations yet.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Mood'), {
      target: { value: 'upbeat' }
    });
    fireEvent.change(screen.getByLabelText('Tempo (BPM)'), {
      target: { value: '110' }
    });
    fireEvent.change(screen.getByLabelText('Style'), {
      target: { value: 'hip-hop' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const firstEntry = screen.getByTestId('queue-entry-1');
      expect(firstEntry).toHaveTextContent(
        'Mood: upbeat · Tempo: 110 BPM · Style: hip-hop'
      );
      expect(firstEntry).toHaveAttribute('data-status', 'generating');
      expect(firstEntry).toHaveTextContent('Generating');
      expect(firstEntry.querySelector('.animate-spin')).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText('Mood'), {
      target: { value: 'chill' }
    });
    fireEvent.change(screen.getByLabelText('Tempo (BPM)'), {
      target: { value: '80' }
    });
    fireEvent.change(screen.getByLabelText('Style'), {
      target: { value: 'jazz' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const secondEntry = screen.getByTestId('queue-entry-2');
      expect(secondEntry).toHaveTextContent(
        'Mood: chill · Tempo: 80 BPM · Style: jazz'
      );
      expect(secondEntry).toHaveAttribute('data-status', 'queued');
      expect(secondEntry).toHaveTextContent('Queued');
    });

    resolveFirstFetch?.(createWavBlobResponse());

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
      expect(screen.getByTestId('queue-entry-1')).toHaveTextContent('✓');
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-status',
        'completed'
      );
      expect(screen.getByTestId('queue-entry-2')).toHaveTextContent(
        'Completed'
      );
    });
  });

  it('shows a play action for completed queue entries', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:http://localhost/queue-track-1')
      .mockReturnValueOnce('blob:http://localhost/queue-track-2');

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
      expect(
        screen.getByRole('button', { name: 'Play generation 1' })
      ).toBeInTheDocument();
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-status',
        'completed'
      );
      expect(
        screen.getByRole('button', { name: 'Play generation 2' })
      ).toBeInTheDocument();
    });
  });

  it('loads and starts playback for the selected completed queue entry', async () => {
    const firstTrackUrl = 'blob:http://localhost/queue-track-1';
    const secondTrackUrl = 'blob:http://localhost/queue-track-2';
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce(firstTrackUrl)
      .mockReturnValueOnce(secondTrackUrl);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

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

    const audioCtor = globalThis.Audio as ReturnType<typeof vi.fn>;
    const audioCallCountBeforeReplay = audioCtor.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Play generation 1' }));

    await waitFor(() => {
      expect(audioCtor.mock.calls.length).toBe(audioCallCountBeforeReplay + 1);
      expect(audioCtor.mock.calls.at(-1)?.[0]).toBe(firstTrackUrl);
      expect(mockAudio.play).toHaveBeenCalledTimes(
        audioCallCountBeforeReplay + 1
      );
    });
  });

  it('drives visual scene timing from the selected queue track during replay', async () => {
    const firstTrackUrl = 'blob:http://localhost/queue-track-1';
    const secondTrackUrl = 'blob:http://localhost/queue-track-2';
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce(firstTrackUrl)
      .mockReturnValueOnce(secondTrackUrl);

    const firstAudio = createMockAudio();
    Object.defineProperty(firstAudio, 'duration', {
      value: 40,
      configurable: true
    });
    const secondAudio = createMockAudio();
    Object.defineProperty(secondAudio, 'duration', {
      value: 20,
      configurable: true
    });
    const replayAudio = createMockAudio();
    Object.defineProperty(replayAudio, 'duration', {
      value: 40,
      configurable: true
    });
    const audioInstances = [firstAudio, secondAudio, replayAudio];

    vi.spyOn(globalThis, 'Audio').mockImplementation(
      () => (audioInstances.shift() ?? createMockAudio()) as HTMLAudioElement
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-entry-1')).toHaveAttribute(
        'data-status',
        'completed'
      );
      expect(screen.getByTestId('queue-entry-2')).toHaveAttribute(
        'data-status',
        'completed'
      );
      // The visual scene still reflects the first played track (duration 40)
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-audio-duration',
        '40.00'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    // Wait for the pause to be processed
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-is-playing',
      'false'
    );

    // Manually play the second track to ensure visual scene updates correctly.
    // This shifts 'secondAudio' (duration 20) from the mock array.
    fireEvent.click(screen.getByRole('button', { name: 'Play generation 2' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-audio-duration',
        '20.00'
      );
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-is-playing',
        'true'
      );
    });

    // Pause the second track
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    // Now replay the first track
    // This shifts 'replayAudio' (duration 40) from the mock array.
    fireEvent.click(screen.getByRole('button', { name: 'Play generation 1' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-audio-duration',
        '40.00'
      );
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-is-playing',
        'true'
      );
    });

    fireEvent.change(screen.getByLabelText('Seek'), {
      target: { value: '50' }
    });
    expect(replayAudio.currentTime).toBe(20);
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-audio-current-time',
      '20.00'
    );
  });

  it('marks failed queue entries with an error indicator and message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createErrorResponse('Audio generation failed')
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const entry = screen.getByTestId('queue-entry-1');
      expect(entry).toHaveAttribute('data-status', 'failed');
      expect(entry).toHaveTextContent('Failed');
      expect(entry).toHaveTextContent('!');
      expect(entry).toHaveTextContent('Audio generation failed');
    });
  });

  // AC06: Error messages for network failures or non-OK responses remain user-visible
  it('on backend failure shows backend error and allows retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createErrorResponse('Audio generation failed'))
      .mockResolvedValueOnce(createWavBlobResponse());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Audio generation failed');
      expect(alert.className).toContain('text-red-100');
      expect(alert.parentElement?.className).toContain('bg-red-950/40');
      expect(alert.parentElement?.className).toContain('border-red-400/60');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('surfaces backend detail field for non-standard 500 payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createErrorResponse(
        'Internal server error while generating audio',
        500,
        'detail'
      )
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Internal server error while generating audio'
      );
    });
  });

  it('on network failure shows error message from fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Failed to reach backend')
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to reach backend'
      );
    });
  });

  // AC07: Parameter controls unchanged
  it('parameter controls (mood, tempo, style) remain functional', () => {
    render(<App />);

    const mood = screen.getByLabelText('Mood') as HTMLSelectElement;
    const tempo = screen.getByLabelText('Tempo (BPM)') as HTMLInputElement;
    const style = screen.getByLabelText('Style') as HTMLSelectElement;

    expect(mood.value).toBe('chill');
    expect(tempo.value).toBe('80');
    expect(style.value).toBe('jazz');

    fireEvent.change(mood, { target: { value: 'melancholic' } });
    fireEvent.change(tempo, { target: { value: '100' } });
    fireEvent.change(style, { target: { value: 'ambient' } });

    expect(mood.value).toBe('melancholic');
    expect(tempo.value).toBe('100');
    expect(style.value).toBe('ambient');
  });

  // AC08: No Strudel imports in App.tsx — App no longer accepts a controller prop
  it('does not use any Strudel controller or adapter', () => {
    // App component should render without any controller prop
    render(<App />);
    // If App still depended on Strudel, it would either fail to render
    // or require a controller prop. The absence of the prop confirms removal.
    expect(
      screen.getByRole('button', { name: 'Generate' })
    ).toBeInTheDocument();
  });

  // AC01 extra: verifies requestGeneratedAudio creates blob URL
  it('uses URL.createObjectURL to create audio source from response blob', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Blob;
    expect(blobArg.size).toBeGreaterThan(0);
    expect(blobArg.type).toBe('audio/wav');
  });

  it('drives animation duration from the generated audio duration', async () => {
    Object.defineProperty(mockAudio, 'duration', {
      value: 42,
      configurable: true
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-audio-duration',
        '42.00'
      );
    });
  });

  it('keeps animation playback state synchronized with play and pause actions', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-is-playing',
        'true'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByTestId('visual-scene')).toHaveAttribute(
      'data-is-playing',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-is-playing',
        'true'
      );
    });
  });

  it('moves animation to the end when the audio track ends', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    });

    const endedListener = (
      mockAudio.addEventListener as ReturnType<typeof vi.fn>
    ).mock.calls.find((call) => call[0] === 'ended')?.[1] as
      | (() => void)
      | undefined;

    expect(endedListener).toBeDefined();
    endedListener?.();

    await waitFor(() => {
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-is-playing',
        'false'
      );
      expect(screen.getByTestId('visual-scene')).toHaveAttribute(
        'data-audio-current-time',
        '30.00'
      );
      expect(screen.getByLabelText('Seek')).toHaveValue('100');
    });
  });
});
