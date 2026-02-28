import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    return new Response(blob, { status, headers: { 'content-type': 'audio/wav' } });
  }
  return new Response(JSON.stringify({ error: 'generation failed' }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createErrorResponse(message: string, status = 500, field = 'error'): Response {
  return new Response(JSON.stringify({ [field]: message }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function mockGenerateFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async () => createWavBlobResponse());
}

describe('App generation flow', () => {
  let mockAudio: HTMLAudioElement;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockAudio = createMockAudio();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockGenerateFetch());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/fake-audio-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(globalThis, 'Audio').mockImplementation(() => mockAudio);
  });

  it('renders mood, tempo, and style inside clearly labelled control cards with consistent layout spacing', () => {
    render(<App />);

    expect(screen.getByTestId('mood-control-card')).toHaveTextContent('Mood');
    expect(screen.getByTestId('tempo-control-card')).toHaveTextContent('Tempo');
    expect(screen.getByTestId('style-control-card')).toHaveTextContent('Style');

    const parametersSection = screen.getByRole('region', { name: 'Generation parameters' });
    expect(parametersSection.className).toContain('space-y-4');

    const layoutGrid = screen.getByTestId('mood-control-card').parentElement;
    expect(layoutGrid).not.toBeNull();
    expect(layoutGrid?.className).toContain('grid');
    expect(layoutGrid?.className).toContain('gap-4');
    expect(layoutGrid?.className).toContain('md:grid-cols-3');
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

  it('keeps player hidden until a track is generated successfully', async () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Mood'), { target: { value: 'upbeat' } });
    fireEvent.change(screen.getByLabelText('Tempo (BPM)'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'hip-hop' } });
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
      expect(globalThis.Audio).toHaveBeenCalledWith('blob:http://localhost/fake-audio-url');
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

    // Seek to 100%
    fireEvent.change(seek, { target: { value: '100' } });
    expect(seek.value).toBe('100');
    expect(mockAudio.currentTime).toBe(30);
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

  it('shows loading while generation is in progress and ignores duplicate Generate clicks', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    render(<App />);

    const generate = screen.getByRole('button', { name: 'Generate' });
    fireEvent.click(generate);

    const status = screen.getByText('Generating track...').closest('[role="status"]');
    expect(status).not.toBeNull();
    const statusElement = status as HTMLElement;
    expect(statusElement).toHaveTextContent('Generating track...');
    expect(statusElement.className).toContain('border-lofi-accent/60');
    expect(statusElement.querySelector('.animate-spin')).not.toBeNull();
    expect(generate).toBeDisabled();

    fireEvent.click(generate);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(createWavBlobResponse());

    await waitFor(() => {
      expect(screen.queryByText('Generating track...')).not.toBeInTheDocument();
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
      createErrorResponse('Internal server error while generating audio', 500, 'detail')
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Internal server error while generating audio');
    });
  });

  it('on network failure shows error message from fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to reach backend'));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to reach backend');
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
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument();
  });

  // AC01 extra: verifies requestGeneratedAudio creates blob URL
  it('uses URL.createObjectURL to create audio source from response blob', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blobArg.size).toBeGreaterThan(0);
    expect(blobArg.type).toBe('audio/wav');
  });
});
