import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useLoaderMock = vi.fn();
const useThreeMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="r3f-canvas">{children}</div>,
  useLoader: (...args: unknown[]) => useLoaderMock(...args),
  useThree: () => useThreeMock()
}));

import { VisualScene } from './visual-scene';

describe('VisualScene', () => {
  beforeEach(() => {
    useLoaderMock.mockReset();
    useThreeMock.mockReset();

    useLoaderMock.mockReturnValue({ image: { width: 1920, height: 1080 } });
    useThreeMock.mockReturnValue({ viewport: { width: 8, height: 4.5 } });
  });

  it('renders an R3F scene using uploaded image texture fit to canvas', () => {
    render(
      <VisualScene imageUrl="blob:http://localhost/my-upload" audioCurrentTime={8} audioDuration={32} isPlaying={false} />
    );

    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-has-image', 'true');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-width', '8.000');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-height', '4.500');
    expect(useLoaderMock).toHaveBeenCalledWith(expect.any(Function), 'blob:http://localhost/my-upload');
  });

  it('shows a visible waveform overlay in the scene', () => {
    render(
      <VisualScene imageUrl="blob:http://localhost/my-upload" audioCurrentTime={16} audioDuration={32} isPlaying={true} />
    );

    expect(screen.getByTestId('waveform-overlay')).toBeInTheDocument();
  });

  it('renders fallback visual copy when no image was uploaded', () => {
    render(<VisualScene imageUrl={null} audioCurrentTime={0} audioDuration={0} isPlaying={false} />);

    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-has-image', 'false');
    expect(screen.getByTestId('visual-placeholder-copy')).toBeInTheDocument();
  });
});
