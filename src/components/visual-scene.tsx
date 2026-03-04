/* eslint-disable react/no-unknown-property */
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { computeContainScale } from '../lib/visual-scene';
import { EffectComposer, type EffectType } from './effects';
import { VisualizerFactory, type VisualizerType } from './visualizers';

const FALLBACK_VISUAL_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3a2b24"/><stop offset="100%" stop-color="#12100f"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="950" cy="190" r="130" fill="#c08457" fill-opacity="0.2"/><circle cx="250" cy="650" r="190" fill="#8b5e3c" fill-opacity="0.25"/></svg>'
)}`;



type VisualSceneProps = {
  imageUrl: string | null;
  videoUrl?: string | null;
  videoElement?: HTMLVideoElement | null;
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
  videoUrl?: string | null;
  videoElement?: HTMLVideoElement | null;
  audioCurrentTime: number;
  audioDuration: number;
  isPlaying: boolean;
};

type SceneContentProps = SceneRenderProps & {
  visualizerType: VisualizerType;
  effects: EffectType[];
  onDerived: (
    planeWidth: number,
    planeHeight: number,
    textureSource: 'image' | 'video'
  ) => void;
};

function SceneContent({ imageUrl, videoUrl, videoElement, audioCurrentTime, audioDuration, isPlaying, visualizerType, effects, onDerived }: SceneContentProps) {
  const fallbackTexture = useLoader(THREE.TextureLoader, FALLBACK_VISUAL_DATA_URI);
  const [loadedImageTexture, setLoadedImageTexture] = useState<THREE.Texture | null>(null);
  const loadedImageUrlRef = useRef<string | null>(null);
  const loadedTextureRef = useRef<THREE.Texture | null>(null);
  loadedTextureRef.current = loadedImageTexture;

  // For rapidly changing data URLs (live mirror frames), reuse a single texture
  // and update its image in place to avoid constant texture recreation.
  const streamingTextureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    return () => {
      loadedTextureRef.current?.dispose();
      streamingTextureRef.current?.dispose();
      streamingTextureRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!imageUrl || imageUrl === FALLBACK_VISUAL_DATA_URI) {
      setLoadedImageTexture((prev) => {
        if (prev && prev !== streamingTextureRef.current) {
          prev.dispose();
        }
        return null;
      });
      loadedImageUrlRef.current = null;
      return;
    }

    const isDataUrl = imageUrl.startsWith('data:');

    if (isDataUrl) {
      const img = new Image();
      img.onload = () => {
        let tex = streamingTextureRef.current;
        if (!tex) {
          tex = new THREE.Texture(img);
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          streamingTextureRef.current = tex;
        } else {
          tex.image = img;
        }
        tex.needsUpdate = true;
        loadedImageUrlRef.current = imageUrl;
        setLoadedImageTexture(tex);
      };
      img.src = imageUrl;
      return;
    }

    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      imageUrl,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        setLoadedImageTexture((prev) => {
          loadedImageUrlRef.current = imageUrl;
          if (prev && prev !== streamingTextureRef.current) prev.dispose();
          return tex;
        });
      },
      undefined,
      () => {
        if (!cancelled) loadedImageUrlRef.current = null;
      }
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const imageTexture = imageUrl && imageUrl !== FALLBACK_VISUAL_DATA_URI
    ? (loadedImageTexture ?? fallbackTexture)
    : fallbackTexture;

  const videoTexture = useMemo(() => {
    if (!videoElement || !videoUrl) {
      return null;
    }

    const nextTexture = new THREE.VideoTexture(videoElement);
    nextTexture.minFilter = THREE.LinearFilter;
    nextTexture.magFilter = THREE.LinearFilter;
    nextTexture.generateMipmaps = false;
    return nextTexture;
  }, [videoElement, videoUrl]);
  const { viewport } = useThree();
  const texture = videoTexture ?? imageTexture;
  const textureSource: 'image' | 'video' = videoTexture ? 'video' : 'image';

  const [planeWidth, planeHeight] = useMemo(() => {
    const videoWidth = videoElement?.videoWidth ?? 0;
    const videoHeight = videoElement?.videoHeight ?? 0;
    if (videoTexture && videoWidth > 0 && videoHeight > 0) {
      return computeContainScale(viewport.width, viewport.height, videoWidth, videoHeight);
    }

    const image = imageTexture.image as { width?: number; height?: number } | undefined;
    return computeContainScale(viewport.width, viewport.height, image?.width ?? 1, image?.height ?? 1);
  }, [imageTexture.image, videoElement?.videoHeight, videoElement?.videoWidth, videoTexture, viewport.height, viewport.width]);

  useEffect(() => {
    return () => {
      videoTexture?.dispose();
    };
  }, [videoTexture]);

  // Report derived values to the DOM overlay so tests can query them
  // without placing data-* props on Three.js objects (which crashes R3F).
  useEffect(() => {
    onDerived(planeWidth, planeHeight, textureSource);
  }, [onDerived, planeWidth, planeHeight, textureSource]);

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
        key={visualizerType}
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
  videoUrl = null,
  videoElement = null,
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
    (
      planeWidth: number,
      planeHeight: number,
      textureSource: 'image' | 'video'
    ) => {
      const el = imagePlaneOverlayRef.current;
      if (!el) return;
      el.setAttribute('data-plane-width', planeWidth.toFixed(3));
      el.setAttribute('data-plane-height', planeHeight.toFixed(3));
      el.setAttribute('data-has-image', imageUrl ? 'true' : 'false');
      el.setAttribute('data-texture-source', textureSource);
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
        data-texture-source={videoElement && videoUrl ? 'video' : 'image'}
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
          videoUrl={videoUrl}
          videoElement={videoElement}
          audioCurrentTime={audioCurrentTime}
          audioDuration={audioDuration}
          isPlaying={isPlaying}
          visualizerType={visualizerType}
          effects={effects}
          onDerived={handleDerived}
        />
      </Canvas>

      {showPlaceholderCopy && !imageUrl && !videoUrl && (
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
