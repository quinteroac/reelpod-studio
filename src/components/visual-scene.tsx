/* eslint-disable react/no-unknown-property */
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeContainScale } from '../lib/visual-scene';
import { EffectComposer, type EffectType } from './effects';
import { VisualizerFactory, type VisualizerType } from './visualizers';

const FALLBACK_VISUAL_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3a2b24"/><stop offset="100%" stop-color="#12100f"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="950" cy="190" r="130" fill="#c08457" fill-opacity="0.2"/><circle cx="250" cy="650" r="190" fill="#8b5e3c" fill-opacity="0.25"/></svg>'
)}`;



type VisualSceneProps = {
  imageUrl: string | null;
  audioCurrentTime: number;
  audioDuration: number;
  isPlaying: boolean;
  aspectRatio: number;
  visualizerType: VisualizerType;
  effects: EffectType[];
  backgroundColor?: string;
  showPlaceholderCopy?: boolean;
  fullBleed?: boolean;
};

type SceneRenderProps = {
  imageUrl: string | null;
  audioCurrentTime: number;
  audioDuration: number;
  isPlaying: boolean;
};

type SceneContentProps = SceneRenderProps & {
  visualizerType: VisualizerType;
  effects: EffectType[];
  onDerived: (planeWidth: number, planeHeight: number) => void;
};

function SceneContent({ imageUrl, audioCurrentTime, audioDuration, isPlaying, visualizerType, effects, onDerived }: SceneContentProps) {
  const texture = useLoader(THREE.TextureLoader, imageUrl ?? FALLBACK_VISUAL_DATA_URI);
  const { viewport } = useThree();

  const [planeWidth, planeHeight] = useMemo(() => {
    const image = texture.image as { width?: number; height?: number } | undefined;
    return computeContainScale(viewport.width, viewport.height, image?.width ?? 1, image?.height ?? 1);
  }, [texture.image, viewport.height, viewport.width]);

  // Report derived values to the DOM overlay so tests can query them
  // without placing data-* props on Three.js objects (which crashes R3F).
  useEffect(() => {
    onDerived(planeWidth, planeHeight);
  }, [onDerived, planeWidth, planeHeight]);

  return (
    <>
      <EffectComposer
        effects={effects}
        audioCurrentTime={audioCurrentTime}
        audioDuration={audioDuration}
        isPlaying={isPlaying}
        texture={texture}
      />
      {/* Conditionally hide the default image plane if a visualizer handles its own background (like rain) */}
      {visualizerType !== 'rain' && visualizerType !== 'scene-rain' && visualizerType !== 'glitch' && (
        <>
          {/* Image plane — no data-* props allowed here (Three.js object, not DOM) */}
          <mesh scale={[planeWidth, planeHeight, 1]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>

          {/* Dark overlay dims the image so the waveforms read clearly */}
          <mesh scale={[planeWidth, planeHeight, 1]} position={[0, 0, 0.05]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.45} />
          </mesh>
        </>
      )}

      <VisualizerFactory
        key={imageUrl ?? 'fallback-texture'}
        type={visualizerType}
        audioCurrentTime={audioCurrentTime}
        audioDuration={audioDuration}
        isPlaying={isPlaying}
        planeWidth={planeWidth}
        planeHeight={planeHeight}
        texture={texture}
      />
    </>
  );
}

export function VisualScene({
  imageUrl,
  audioCurrentTime,
  audioDuration,
  isPlaying,
  aspectRatio,
  visualizerType,
  effects,
  backgroundColor = '#18120f',
  showPlaceholderCopy = true,
  fullBleed = false
}: VisualSceneProps) {
  // DOM overlay elements carry test-query attributes but are invisible on screen.
  const imagePlaneOverlayRef = useRef<HTMLDivElement | null>(null);

  const handleDerived = useCallback(
    (planeWidth: number, planeHeight: number) => {
      const el = imagePlaneOverlayRef.current;
      if (!el) return;
      el.setAttribute('data-plane-width', planeWidth.toFixed(3));
      el.setAttribute('data-plane-height', planeHeight.toFixed(3));
      el.setAttribute('data-has-image', imageUrl ? 'true' : 'false');
    },
    [imageUrl]
  );

  return (
    <div
      data-testid="visual-scene"
      className={fullBleed ? 'relative h-full w-full overflow-hidden' : 'relative w-full'}
      style={{
        aspectRatio: fullBleed ? undefined : `${aspectRatio}`,
        width: fullBleed ? '100%' : `min(100%, 70vh * ${aspectRatio})`,
        height: fullBleed ? '100%' : undefined
      }}
    >
      {/* Invisible DOM overlay elements for test queries — no visual impact */}
      <div
        ref={imagePlaneOverlayRef}
        data-testid="visual-image-plane"
        data-has-image={imageUrl ? 'true' : 'false'}
        aria-hidden="true"
        className="pointer-events-none absolute hidden"
      />
      <div
        data-testid="waveform-overlay"
        aria-hidden="true"
        className="pointer-events-none absolute hidden"
      />

      <Canvas orthographic camera={{ position: [0, 0, 4], zoom: 120 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={[backgroundColor]} />
        <SceneContent
          imageUrl={imageUrl}
          audioCurrentTime={audioCurrentTime}
          audioDuration={audioDuration}
          isPlaying={isPlaying}
          visualizerType={visualizerType}
          effects={effects}
          onDerived={handleDerived}
        />
      </Canvas>

      {showPlaceholderCopy && !imageUrl && (
        <p
          data-testid="visual-placeholder-copy"
          className="pointer-events-none absolute inset-x-0 bottom-4 px-4 text-center text-sm text-lofi-accentMuted"
        >
          Generate an image to personalize the scene.
        </p>
      )}
    </div>
  );
}
