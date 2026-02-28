import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useLoaderMock = vi.fn();
const useThreeMock = vi.fn();
const useFrameMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="r3f-canvas">{children}</div>,
  useLoader: (...args: unknown[]) => useLoaderMock(...args),
  useThree: () => useThreeMock(),
  useFrame: (callback: (state: unknown, delta: number) => void) => useFrameMock(callback)
}));

import { VisualScene } from './visual-scene';

describe('VisualScene', () => {
  beforeEach(() => {
    useLoaderMock.mockReset();
    useThreeMock.mockReset();
    useFrameMock.mockReset();

    useLoaderMock.mockReturnValue({ image: { width: 1920, height: 1080 } });
    useThreeMock.mockReturnValue({ viewport: { width: 8, height: 4.5 } });
    useFrameMock.mockImplementation(() => {});
  });

  it('renders an R3F scene using uploaded image texture fit to canvas', () => {
    render(<VisualScene imageUrl="blob:http://localhost/my-upload" waveformProgress={0.25} isPlaying={false} />);

    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-has-image', 'true');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-width', '8.000');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-height', '4.500');
    expect(useLoaderMock).toHaveBeenCalledWith(expect.any(Function), 'blob:http://localhost/my-upload');
  });

  it('shows a visible waveform overlay in the scene and registers frame animation', () => {
    render(<VisualScene imageUrl="blob:http://localhost/my-upload" waveformProgress={0.5} isPlaying={true} />);

    expect(screen.getByTestId('waveform-overlay')).toBeInTheDocument();
    expect(useFrameMock).toHaveBeenCalledOnce();
  });

  it('renders fallback visual copy when no image was uploaded', () => {
    render(<VisualScene imageUrl={null} waveformProgress={0} isPlaying={false} />);

    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-has-image', 'false');
    expect(screen.getByTestId('visual-placeholder-copy')).toBeInTheDocument();
  });
});
