import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeWaveformPhase } from '../../lib/visual-scene';
import type { VisualizerProps } from './types';

const STAR_COUNT = 200;

type StarData = {
    x: number;
    y: number;
    z: number;
    baseOpacity: number;
    speed: number;
    size: number;
    phaseOffset: number;
};

function generateStars(planeWidth: number, planeHeight: number): StarData[] {
    const stars: StarData[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
            x: (Math.random() - 0.5) * planeWidth * 1.1,
            y: (Math.random() - 0.5) * planeHeight * 1.1,
            z: 0.12 + Math.random() * 0.05,
            baseOpacity: 0.3 + Math.random() * 0.7,
            speed: 0.02 + Math.random() * 0.06,
            size: 0.008 + Math.random() * 0.015,
            phaseOffset: Math.random() * Math.PI * 2,
        });
    }
    return stars;
}

/**
 * StarfieldVisualizer — floating particles/stars that drift slowly and pulse
 * in brightness with the audio.
 *
 * Uses THREE.InstancedMesh for efficient rendering of many small circles.
 */
export function StarfieldVisualizer({
    audioCurrentTime,
    audioDuration,
    isPlaying,
    planeWidth,
    planeHeight,
}: VisualizerProps) {
    const audioCurrentTimeRef = useRef(audioCurrentTime);
    const audioDurationRef = useRef(audioDuration);
    const isPlayingRef = useRef(isPlaying);
    audioCurrentTimeRef.current = audioCurrentTime;
    audioDurationRef.current = audioDuration;
    isPlayingRef.current = isPlaying;

    const meshRef = useRef<THREE.InstancedMesh>(null);
    const elapsedRef = useRef(0);

    const stars = useMemo(() => generateStars(planeWidth, planeHeight), [planeWidth, planeHeight]);

    const dummy = useMemo(() => new THREE.Object3D(), []);
    const color = useMemo(() => new THREE.Color(), []);

    // Pre-create palette colors
    const palette = useMemo(
        () => [
            new THREE.Color('#ffd580'), // warm gold
            new THREE.Color('#7dd3fc'), // sky blue
            new THREE.Color('#c4b5fd'), // lavender
            new THREE.Color('#fca5a5'), // soft red
            new THREE.Color('#86efac'), // mint green
        ],
        []
    );

    useFrame((_state, delta) => {
        const mesh = meshRef.current;
        if (!mesh) return;

        const playing = isPlayingRef.current;
        const speedMul = playing ? 1.0 : 0.08;
        elapsedRef.current += delta * speedMul;
        const t = elapsedRef.current;

        const audioPhase = computeWaveformPhase(audioCurrentTimeRef.current, audioDurationRef.current);
        const amplitudeMul = playing ? 1.0 : 0.2;

        for (let i = 0; i < stars.length; i++) {
            const star = stars[i];

            // Gentle drift: slowly move downward and wrap around
            let driftY = star.y - t * star.speed * 0.3;
            const halfH = planeHeight * 0.55;
            if (driftY < -halfH) {
                driftY += planeHeight * 1.1;
            }

            // Slight horizontal sway
            const swayX = star.x + Math.sin(t * 0.5 + star.phaseOffset) * 0.02;

            // Pulsing size with audio
            const pulse = Math.sin(audioPhase * 2 + star.phaseOffset + t * 1.5) * 0.5 + 0.5;
            const scale = star.size * (0.7 + pulse * 0.6 * amplitudeMul);

            dummy.position.set(swayX, driftY, star.z);
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);

            // Color from palette with brightness modulation
            const paletteColor = palette[i % palette.length];
            const brightness = star.baseOpacity * (0.5 + pulse * 0.5 * amplitudeMul);
            color.copy(paletteColor).multiplyScalar(brightness);
            mesh.setColorAt(i, color);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, STAR_COUNT]}>
            <circleGeometry args={[1, 16]} />
            <meshBasicMaterial transparent opacity={0.9} toneMapped={false} />
        </instancedMesh>
    );
}
