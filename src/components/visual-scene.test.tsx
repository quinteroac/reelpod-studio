import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-three/drei', () => ({
  Line: ({ children }: { children?: ReactNode }) => (
    <div data-testid="drei-line">{children}</div>
  )
}));

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="effect-composer">{children}</div>
  ),
  Bloom: () => <div data-testid="bloom" />
}));

const useLoaderMock = vi.fn();
const useThreeMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="r3f-canvas">{children}</div>,
  useLoader: (...args: unknown[]) => useLoaderMock(...args),
  useThree: () => useThreeMock(),
  // useFrame runs inside the R3F renderer loop which doesn't exist in JSDOM — no-op is correct.
  useFrame: () => { }
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
      <VisualScene
        imageUrl="blob:http://localhost/my-upload"
        videoUrl={null}
        videoElement={null}
        audioCurrentTime={8}
        audioDuration={32}
        isPlaying={false}
        aspectRatio={16 / 9}
        visualizerType="glitch"
        effects={['colorDrift']}
      />
    );

    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-has-image', 'true');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-width', '8.000');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-height', '4.500');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-texture-source', 'image');
    // useLoader loads the fallback SVG; the blob image is loaded in useEffect via TextureLoader
    expect(useLoaderMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringMatching(/^data:image\/svg\+xml,/)
    );
  });

  it('renders MP4 video texture on the image plane when playback video element is provided', () => {
    const videoElement = document.createElement('video');
    Object.defineProperty(videoElement, 'videoWidth', {
      configurable: true,
      value: 1280
    });
    Object.defineProperty(videoElement, 'videoHeight', {
      configurable: true,
      value: 720
    });

    render(
      <VisualScene
        imageUrl={null}
        videoUrl="blob:http://localhost/generated-video"
        videoElement={videoElement}
        audioCurrentTime={2}
        audioDuration={30}
        isPlaying={true}
        aspectRatio={16 / 9}
        visualizerType="waveform"
        effects={['colorDrift']}
      />
    );

    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-texture-source', 'video');
  });

  it.each([
    {
      label: '16:9',
      viewport: { width: 8, height: 4.5 },
      video: { width: 1920, height: 1080 }
    },
    {
      label: '9:16',
      viewport: { width: 4.5, height: 8 },
      video: { width: 1080, height: 1920 }
    },
    {
      label: '1:1',
      viewport: { width: 6, height: 6 },
      video: { width: 1080, height: 1080 }
    }
  ])(
    'fills the viewport without letterboxing when video and container share $label aspect ratio',
    ({ viewport, video }) => {
      useThreeMock.mockReturnValue({ viewport });

      const videoElement = document.createElement('video');
      Object.defineProperty(videoElement, 'videoWidth', {
        configurable: true,
        value: video.width
      });
      Object.defineProperty(videoElement, 'videoHeight', {
        configurable: true,
        value: video.height
      });

      render(
        <VisualScene
          imageUrl={null}
          videoUrl="blob:http://localhost/generated-video"
          videoElement={videoElement}
          audioCurrentTime={3}
          audioDuration={40}
          isPlaying={true}
          aspectRatio={video.width / video.height}
          visualizerType="none"
          effects={['none']}
        />
      );

      expect(screen.getByTestId('visual-image-plane')).toHaveAttribute(
        'data-plane-width',
        viewport.width.toFixed(3)
      );
      expect(screen.getByTestId('visual-image-plane')).toHaveAttribute(
        'data-plane-height',
        viewport.height.toFixed(3)
      );
      expect(screen.getByTestId('visual-image-plane')).toHaveAttribute(
        'data-texture-source',
        'video'
      );
    }
  );

  it('shows a visible waveform overlay in the scene', () => {
    render(
      <VisualScene
        imageUrl="blob:http://localhost/my-upload"
        videoUrl={null}
        videoElement={null}
        audioCurrentTime={16}
        audioDuration={32}
        isPlaying={true}
        aspectRatio={16 / 9}
        visualizerType="glitch"
        effects={['colorDrift']}
      />
    );

    expect(screen.getByTestId('waveform-overlay')).toBeInTheDocument();
  });

  it('renders fallback visual copy when no image was uploaded', () => {
    render(
      <VisualScene
        imageUrl={null}
        videoUrl={null}
        videoElement={null}
        audioCurrentTime={0}
        audioDuration={0}
        isPlaying={false}
        aspectRatio={1}
        visualizerType="glitch"
        effects={['colorDrift']}
      />
    );

    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-has-image', 'false');
    expect(screen.getByTestId('visual-placeholder-copy')).toBeInTheDocument();
  });

  it('applies the requested aspect ratio to the viewport container', () => {
    render(
      <VisualScene
        imageUrl={null}
        videoUrl={null}
        videoElement={null}
        audioCurrentTime={0}
        audioDuration={0}
        isPlaying={false}
        aspectRatio={9 / 16}
        visualizerType="glitch"
        effects={['colorDrift']}
      />
    );

    expect(screen.getByTestId('visual-scene')).toHaveStyle({
      aspectRatio: `${9 / 16}`
    });
  });

  it('fills the full container when fullBleed is enabled', () => {
    render(
      <VisualScene
        imageUrl={null}
        videoUrl={null}
        videoElement={null}
        audioCurrentTime={0}
        audioDuration={0}
        isPlaying={false}
        aspectRatio={16 / 9}
        visualizerType="none"
        effects={['none']}
        fullBleed={true}
      />
    );

    expect(screen.getByTestId('visual-scene')).toHaveClass('h-full', 'w-full', 'overflow-hidden');
    expect(screen.getByTestId('visual-scene')).toHaveStyle({
      width: '100%',
      height: '100%'
    });
  });

  it('recomputes image plane contain scale when viewport dimensions change', () => {
    useLoaderMock.mockReturnValue({ image: { width: 1600, height: 800 } });
    useThreeMock.mockReturnValue({ viewport: { width: 8, height: 4.5 } });

    const { rerender } = render(
      <VisualScene
        imageUrl="blob:http://localhost/my-upload"
        videoUrl={null}
        videoElement={null}
        audioCurrentTime={0}
        audioDuration={30}
        isPlaying={true}
        aspectRatio={16 / 9}
        visualizerType="waveform"
        effects={['none']}
      />
    );

    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-width', '8.000');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-height', '4.000');

    useThreeMock.mockReturnValue({ viewport: { width: 4, height: 8 } });
    rerender(
      <VisualScene
        imageUrl="blob:http://localhost/my-upload"
        videoUrl={null}
        videoElement={null}
        audioCurrentTime={0}
        audioDuration={30}
        isPlaying={true}
        aspectRatio={16 / 9}
        visualizerType="waveform"
        effects={['none']}
      />
    );

    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-width', '4.000');
    expect(screen.getByTestId('visual-image-plane')).toHaveAttribute('data-plane-height', '2.000');
  });
});
