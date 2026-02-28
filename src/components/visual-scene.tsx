/* eslint-disable react/no-unknown-property */
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { buildWaveformPositions, computeContainScale, computeWaveformPhase } from '../lib/visual-scene';

const FALLBACK_VISUAL_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3a2b24"/><stop offset="100%" stop-color="#12100f"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="950" cy="190" r="130" fill="#c08457" fill-opacity="0.2"/><circle cx="250" cy="650" r="190" fill="#8b5e3c" fill-opacity="0.25"/></svg>'
)}`;
const WAVEFORM_SAMPLE_COUNT = 96;

type VisualSceneProps = {
  imageUrl: string | null;
  waveformProgress: number;
  isPlaying: boolean;
};

function SceneContent({ imageUrl, waveformProgress, isPlaying }: VisualSceneProps) {
  const texture = useLoader(THREE.TextureLoader, imageUrl ?? FALLBACK_VISUAL_DATA_URI);
  const { viewport } = useThree();
  const waveformRef = useRef<THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null>(null);
  const animationSecondsRef = useRef(0);

  const [planeWidth, planeHeight] = useMemo(() => {
    const image = texture.image as { width?: number; height?: number } | undefined;
    return computeContainScale(viewport.width, viewport.height, image?.width ?? 1, image?.height ?? 1);
  }, [texture.image, viewport.height, viewport.width]);

  const updateWaveformGeometry = useCallback(
    (phase: number): void => {
      const waveform = waveformRef.current;
      if (!waveform || !waveform.geometry) {
        return;
      }

      const amplitude = Math.max(planeHeight * 0.18, 0.06);
      const width = Math.max(planeWidth * 0.88, 0.5);
      const positions = buildWaveformPositions(WAVEFORM_SAMPLE_COUNT, width, amplitude, phase);

      waveform.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      waveform.geometry.computeBoundingSphere();
    },
    [planeHeight, planeWidth]
  );

  useEffect(() => {
    if (!isPlaying) {
      animationSecondsRef.current = 0;
    }

    const phase = computeWaveformPhase(waveformProgress, animationSecondsRef.current);
    updateWaveformGeometry(phase);
  }, [isPlaying, updateWaveformGeometry, waveformProgress]);

  useFrame((_state, delta) => {
    if (!isPlaying) {
      return;
    }

    animationSecondsRef.current += delta;
    const phase = computeWaveformPhase(waveformProgress, animationSecondsRef.current);
    updateWaveformGeometry(phase);
  });

  return (
    <>
      <mesh
        data-testid="visual-image-plane"
        data-has-image={imageUrl ? 'true' : 'false'}
        data-plane-width={planeWidth.toFixed(3)}
        data-plane-height={planeHeight.toFixed(3)}
        scale={[planeWidth, planeHeight, 1]}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>

      <lineSegments ref={waveformRef} data-testid="waveform-overlay" position={[0, 0, 0.1]}>
        <bufferGeometry />
        <lineBasicMaterial color={imageUrl ? '#f4d8b7' : '#d6c8bc'} />
      </lineSegments>
    </>
  );
}

export function VisualScene({ imageUrl, waveformProgress, isPlaying }: VisualSceneProps) {
  return (
    <div data-testid="visual-scene" className="relative h-full w-full">
      <Canvas orthographic camera={{ position: [0, 0, 4], zoom: 120 }}>
        <color attach="background" args={['#18120f']} />
        <SceneContent imageUrl={imageUrl} waveformProgress={waveformProgress} isPlaying={isPlaying} />
      </Canvas>

      {!imageUrl && (
        <p
          data-testid="visual-placeholder-copy"
          className="pointer-events-none absolute inset-x-0 bottom-4 px-4 text-center text-sm text-lofi-accentMuted"
        >
          Upload an image to personalize the scene.
        </p>
      )}
    </div>
  );
}
