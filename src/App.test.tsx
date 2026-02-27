import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import * as patternGenerator from './lib/pattern-generator';
import type { StrudelController } from './lib/strudel';

function createController(overrides: Partial<StrudelController> = {}): StrudelController {
  return {
    generate: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function createGenerateResponse(pattern: string, status = 200): Response {
  const payload = status >= 200 && status < 300 ? { pattern } : { error: pattern };
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

function mockGenerateFetch(pattern = 'remote-pattern'): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async () => createGenerateResponse(pattern));
}

describe('App generation flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockGenerateFetch());
  });

  it('renders mood, tempo, and style inside clearly labelled control cards with consistent layout spacing', () => {
    render(<App controller={createController()} />);

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
    render(<App controller={createController()} />);

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
    const controller = createController();
    render(<App controller={controller} />);

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

  it('posts params to /api/generate and executes returned backend pattern through controller when Generate is clicked', async () => {
    const backendPattern = 'stack(s("bd*2"), s("hh*4")).cpm(110)';
    const fetchMock = mockGenerateFetch(backendPattern);
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    const generatePatternSpy = vi.spyOn(patternGenerator, 'generatePattern');
    const controller = createController();
    render(<App controller={controller} />);

    fireEvent.change(screen.getByLabelText('Mood'), { target: { value: 'upbeat' } });
    fireEvent.change(screen.getByLabelText('Tempo (BPM)'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'hip-hop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(controller.generate).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ mood: 'upbeat', tempo: 110, style: 'hip-hop' })
    });
    expect(controller.generate).toHaveBeenCalledWith(backendPattern);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(generatePatternSpy).not.toHaveBeenCalled();
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
    const controller = createController();

    render(<App controller={controller} />);

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
    expect(controller.generate).not.toHaveBeenCalled();

    resolveFetch?.(createGenerateResponse('remote-pattern'));

    await waitFor(() => {
      expect(screen.queryByText('Generating track...')).not.toBeInTheDocument();
    });
    expect(controller.generate).toHaveBeenCalledTimes(1);
  });

  it('on success tracks playback state and wires controlled seek to the Strudel controller', async () => {
    const controller = createController();
    render(<App controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seek')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const playButton = screen.getByRole('button', { name: 'Play' });
    const pauseButton = screen.getByRole('button', { name: 'Pause' });
    const seek = screen.getByLabelText('Seek') as HTMLInputElement;

    expect(playButton).not.toHaveAttribute('aria-pressed');
    expect(pauseButton).not.toHaveAttribute('aria-pressed');

    expect(playButton.className).toContain('border-emerald-300/80');
    expect(playButton.className).toContain('bg-emerald-500/20');
    expect(pauseButton.className).toContain('border-amber-200/90');
    expect(pauseButton.className).toContain('bg-amber-400/25');
    expect(seek.className).toContain('seek-slider');
    expect(seek.className).toContain('appearance-none');

    expect(playButton).toBeDisabled();
    expect(pauseButton).toBeEnabled();
    expect(seek.value).toBe('0');

    fireEvent.click(playButton);
    expect(controller.play).not.toHaveBeenCalled();

    fireEvent.click(pauseButton);
    await waitFor(() => {
      expect(playButton).toBeEnabled();
      expect(pauseButton).toBeDisabled();
    });

    fireEvent.click(playButton);
    await waitFor(() => {
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(playButton).toBeDisabled();
      expect(pauseButton).toBeEnabled();
    });

    fireEvent.change(seek, { target: { value: '42' } });
    expect(seek.value).toBe('42');
    expect(controller.pause).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenCalledWith(42);
  });

  it('clamps manual seek values to the supported range', async () => {
    const controller = createController();
    render(<App controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    const seek = screen.getByLabelText('Seek') as HTMLInputElement;

    fireEvent.change(seek, { target: { value: '999' } });
    expect(seek.value).toBe('100');
    expect(controller.seek).toHaveBeenCalledWith(100);
  });

  it('on backend failure shows backend error and allows retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createGenerateResponse('OpenAI Chat Completions API returned an error', 500))
      .mockResolvedValueOnce(createGenerateResponse('remote-pattern', 200));
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    const controller = createController();

    render(<App controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('OpenAI Chat Completions API returned an error');
      expect(alert.className).toContain('text-red-100');
      expect(alert.parentElement?.className).toContain('bg-red-950/40');
      expect(alert.parentElement?.className).toContain('border-red-400/60');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(controller.generate).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('on network failure shows error message from fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to reach backend'));
    const controller = createController();

    render(<App controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to reach backend');
    });
    expect(controller.generate).not.toHaveBeenCalled();
  });

  it('shows explicit audio limitation messages for blocked audio and unsupported Web Audio', async () => {
    const blockedController = createController({
      generate: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Audio is blocked by autoplay policy. Click Generate after interacting with the page, and allow sound if prompted.'
          )
        )
    });
    const unsupportedController = createController({
      generate: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'This browser does not support Web Audio. Try a modern browser such as Chrome, Edge, or Firefox.'
          )
        )
    });

    const { rerender } = render(<App controller={blockedController} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('autoplay policy');
    });

    rerender(<App controller={unsupportedController} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('does not support Web Audio');
    });
  });

  it('shows an unplayable warning when REPL succeeds with silent output', async () => {
    const controller = createController({
      generate: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Track generation completed, but no audible output was produced. Please retry with different settings.'
          )
        )
    });
    render(<App controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('no audible output');
    });

    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });
});
