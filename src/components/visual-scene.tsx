/* eslint-disable react/no-unknown-property */
import { Line } from '@react-three/drei';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { buildWaveformPositions, computeContainScale, computeWaveformPhase } from '../lib/visual-scene';

const FALLBACK_VISUAL_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3a2b24"/><stop offset="100%" stop-color="#12100f"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="950" cy="190" r="130" fill="#c08457" fill-opacity="0.2"/><circle cx="250" cy="650" r="190" fill="#8b5e3c" fill-opacity="0.25"/></svg>'
)}`;

const WAVEFORM_SAMPLE_COUNT = 192;

type WaveformConfig = {
  color: string;
  /** Vertical offset as a fraction of planeHeight (can be negative). */
  yFactor: number;
  /** Scales the base amplitude for this layer. */
  amplitudeScale: number;
  /** Phase advance per second — gives each waveform an independent tempo. */
  speed: number;
  opacity: number;
  /** Primary sine frequency multiplier. Irrational values → never-repeating shapes. */
  freqA: number;
  /** Secondary sine frequency multiplier. */
  freqB: number;
  /** Starting phase offset so the layers begin at different shapes. */
  phaseOffset: number;
};

/**
 * Four waveform layers with a warm lofi palette.
 * Irrational freq pairs (7.3, 12.9 …) mean no two layers ever align.
 * Different speeds ensure the motion stays visually unpredictable.
 */
const WAVEFORM_CONFIGS: WaveformConfig[] = [
  // Amber gold — main layer, centered
  { color: '#ffd580', yFactor: 0, amplitudeScale: 1.00, speed: 0.80, opacity: 0.95, freqA: 10.0, freqB: 24.0, phaseOffset: 0 },
  // Sky blue — slightly above, different tempo
  { color: '#7dd3fc', yFactor: 0, amplitudeScale: 0.65, speed: 1.37, opacity: 0.75, freqA: 7.3, freqB: 18.7, phaseOffset: Math.PI * 0.7 },
  // Lavender — below center, slower drift
  { color: '#c4b5fd', yFactor: 0, amplitudeScale: 0.55, speed: 1.03, opacity: 0.70, freqA: 12.9, freqB: 31.1, phaseOffset: Math.PI * 1.5 },
  // Mint green — subtle accent, fastest
  { color: '#86efac', yFactor: 0, amplitudeScale: 0.42, speed: 1.91, opacity: 0.55, freqA: 5.7, freqB: 22.3, phaseOffset: Math.PI * 0.35 },
];

type VisualSceneProps = {
  imageUrl: string | null;
  audioCurrentTime: number;
  audioDuration: number;
  isPlaying: boolean;
};

type SceneContentProps = VisualSceneProps & {
  onDerived: (planeWidth: number, planeHeight: number) => void;
};

function SceneContent({ imageUrl, audioCurrentTime, audioDuration, isPlaying, onDerived }: SceneContentProps) {
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

  // We use Drei's Line component which creates thick ribbons using three-stdlib's Line2.

  // Keep audio values in refs so useFrame never captures a stale closure.
  const audioCurrentTimeRef = useRef(audioCurrentTime);
  const audioDurationRef = useRef(audioDuration);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { audioCurrentTimeRef.current = audioCurrentTime; }, [audioCurrentTime]);
  useEffect(() => { audioDurationRef.current = audioDuration; }, [audioDuration]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const elapsedRef = useRef(0);
  const amplitudeMultiplierRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linesRef = useRef<any[]>([]);

  useFrame((_state, delta) => {
    const isPlaying = isPlayingRef.current;
    // When paused, don't move the waves forward in time much
    const speedMul = isPlaying ? 1.0 : 0.05;
    elapsedRef.current += delta * speedMul;

    // Smoothly lerp amplitude to 1 when playing, 0 when paused
    amplitudeMultiplierRef.current = THREE.MathUtils.lerp(
      amplitudeMultiplierRef.current,
      isPlaying ? 1.0 : 0.0,
      delta * 5.0
    );

    const audioPhase = computeWaveformPhase(audioCurrentTimeRef.current, audioDurationRef.current);
    const baseAmplitude = Math.max(planeHeight * 0.28, 0.08) * amplitudeMultiplierRef.current;
    const waveWidth = Math.max(planeWidth * 0.92, 0.5);

    for (let i = 0; i < WAVEFORM_CONFIGS.length; i++) {
      const cfg = WAVEFORM_CONFIGS[i];

      // Each layer's phase = audio progress + independent time drift + fixed offset.
      const phase = audioPhase + elapsedRef.current * cfg.speed + cfg.phaseOffset;
      const amplitude = baseAmplitude * cfg.amplitudeScale;

      const positions = buildWaveformPositions(
        WAVEFORM_SAMPLE_COUNT,
        waveWidth,
        amplitude,
        phase,
        cfg.freqA,
        cfg.freqB
      );

      const lineNode = linesRef.current[i];
      if (lineNode && lineNode.geometry) {
        lineNode.geometry.setPositions(positions);
        lineNode.geometry.computeBoundingSphere();
        // Spread layers at different z depths so Three.js draws them in order.
        lineNode.position.set(0, cfg.yFactor * planeHeight, 0.1 + i * 0.01);
      }
    }
  });

  return (
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

      {/* Four independently animated waveform layers rendered as thick Drei Lines */}
      {WAVEFORM_CONFIGS.map((cfg, i) => (
        <Line
          key={i}
          ref={(el) => {
            linesRef.current[i] = el;
          }}
          points={[0, 0, 0, 1, 1, 1]} // Dummy points to bootstrap geometry
          color={cfg.color}
          lineWidth={4} // Render thick ribbons!
          transparent
          opacity={cfg.opacity}
        />
      ))}
    </>
  );
}

export function VisualScene({ imageUrl, audioCurrentTime, audioDuration, isPlaying }: VisualSceneProps) {
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
    <div data-testid="visual-scene" className="relative h-full w-full">
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

      <Canvas orthographic camera={{ position: [0, 0, 4], zoom: 120 }}>
        <color attach="background" args={['#18120f']} />
        <SceneContent
          imageUrl={imageUrl}
          audioCurrentTime={audioCurrentTime}
          audioDuration={audioDuration}
          isPlaying={isPlaying}
          onDerived={handleDerived}
        />
        <EffectComposer>
          <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
        </EffectComposer>
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
