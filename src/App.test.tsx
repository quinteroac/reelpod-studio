import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AudioBlockedError, AudioSupportError, SilentOutputError, type StrudelController } from './lib/strudel';

function createController(overrides: Partial<StrudelController> = {}): StrudelController {
  return {
    generate: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('App generation flow', () => {
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

  it('generates a pattern and executes through controller when Generate is clicked', async () => {
    const controller = createController();
    render(<App controller={controller} />);

    fireEvent.change(screen.getByLabelText('Mood'), { target: { value: 'upbeat' } });
    fireEvent.change(screen.getByLabelText('Tempo (BPM)'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'hip-hop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(controller.generate).toHaveBeenCalledTimes(1);
    });

    const pattern = vi.mocked(controller.generate).mock.calls[0][0];
    expect(pattern).toContain('bd bd sd ~');
    expect(pattern).toContain('cp hh*2');
    expect(pattern).toContain('cpm(110)');
  });

  it('shows loading while generation is in progress and ignores duplicate Generate clicks', async () => {
    let resolveGeneration: (() => void) | undefined;
    const controller = createController({
      generate: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveGeneration = resolve;
          })
      )
    });

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
    expect(controller.generate).toHaveBeenCalledTimes(1);

    resolveGeneration?.();

    await waitFor(() => {
      expect(screen.queryByText('Generating track...')).not.toBeInTheDocument();
    });
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

  it('on generic failure shows clear error and allows retry', async () => {
    const controller = createController({
      generate: vi
        .fn()
        .mockRejectedValueOnce(new Error('REPL init failed'))
        .mockResolvedValueOnce(undefined)
    });

    render(<App controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Could not generate track: REPL init failed');
      expect(alert.className).toContain('text-red-100');
      expect(alert.parentElement?.className).toContain('bg-red-950/40');
      expect(alert.parentElement?.className).toContain('border-red-400/60');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(controller.generate).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows explicit audio limitation messages for blocked audio and unsupported Web Audio', async () => {
    const blockedController = createController({ generate: vi.fn().mockRejectedValue(new AudioBlockedError()) });
    const unsupportedController = createController({ generate: vi.fn().mockRejectedValue(new AudioSupportError()) });

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
    const controller = createController({ generate: vi.fn().mockRejectedValue(new SilentOutputError()) });
    render(<App controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('no audible output');
    });

    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });
});
