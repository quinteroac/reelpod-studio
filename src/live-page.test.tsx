import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type VisualSceneProps = Record<string, unknown>;

const visualSceneSpy = vi.fn((_: VisualSceneProps) => (
  <div data-testid="visual-scene" />
));

vi.mock('./components/visual-scene', () => ({
  VisualScene: (props: VisualSceneProps) => visualSceneSpy(props)
}));

import { LivePage } from './live-page';

describe('LivePage', () => {
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
});
