import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeWaveformPhase } from '../../lib/visual-scene';
import type { VisualizerProps } from './types';

const AURORA_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AURORA_FS = /* glsl */ `
uniform float uTime;
uniform float uAudioPhase;
uniform float uAmplitude;
varying vec2 vUv;

// Simple smooth noise
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    float a = hash(i);
    float b = hash(i + 1.0);
    return mix(a, b, f * f * (3.0 - 2.0 * f));
}

void main() {
    vec2 uv = vUv;

    // Aurora bands — layered sine waves creating flowing curtain shapes
    float t = uTime * 0.15;
    float audioInfluence = uAudioPhase * 0.3;

    // Multiple aurora bands at different heights
    float band1 = sin(uv.x * 4.0 + t * 1.2 + audioInfluence) * 0.15 + 0.65;
    float band2 = sin(uv.x * 6.5 - t * 0.8 + audioInfluence * 1.3) * 0.12 + 0.55;
    float band3 = sin(uv.x * 3.2 + t * 0.5 - audioInfluence * 0.7) * 0.18 + 0.45;

    // Add noise to make bands more organic
    float n1 = noise(uv.x * 8.0 + t * 2.0) * 0.06;
    float n2 = noise(uv.x * 12.0 - t * 1.5) * 0.04;

    band1 += n1;
    band2 += n2;
    band3 += n1 - n2;

    // Soft vertical falloff — each band is a gaussian-like shape
    float glow1 = exp(-pow((uv.y - band1) * 8.0, 2.0));
    float glow2 = exp(-pow((uv.y - band2) * 10.0, 2.0));
    float glow3 = exp(-pow((uv.y - band3) * 7.0, 2.0));

    // Aurora colors — green, teal, purple, pink
    vec3 col1 = vec3(0.2, 0.9, 0.4) * glow1;   // Green
    vec3 col2 = vec3(0.1, 0.6, 0.8) * glow2;    // Teal
    vec3 col3 = vec3(0.6, 0.2, 0.7) * glow3;    // Purple

    // Shift hues slowly with time
    float hueShift = sin(t * 0.3) * 0.2;
    col1.r += hueShift * 0.3;
    col2.b += hueShift * 0.2;
    col3.r += hueShift * 0.15;

    vec3 aurora = (col1 + col2 + col3) * uAmplitude;

    // Edge fade for subtle blending
    float edgeFade = smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x);
    aurora *= edgeFade;

    // Overall intensity — subtle, dreamy overlay
    float alpha = clamp(length(aurora) * 0.7, 0.0, 0.55);

    gl_FragColor = vec4(aurora, alpha);
}
`;

/**
 * AuroraVisualizer — flowing northern lights bands that overlay the scene.
 *
 * Renders as a semi-transparent full-screen shader on top of the image plane.
 * Colors shift slowly and brightness reacts to audio playback.
 */
export function AuroraVisualizer({
    audioCurrentTime,
    audioDuration,
    isPlaying,
    planeWidth,
    planeHeight,
}: VisualizerProps) {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const timeRef = useRef(0);
    const audioRef = useRef({ currentTime: audioCurrentTime, duration: audioDuration });
    audioRef.current = { currentTime: audioCurrentTime, duration: audioDuration };

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uAudioPhase: { value: 0 },
            uAmplitude: { value: 0.5 },
        }),
        []
    );

    useFrame((_state, delta) => {
        const speed = isPlaying ? 1.0 : 0.1;
        timeRef.current += delta * speed;

        const audioPhase = computeWaveformPhase(audioRef.current.currentTime, audioRef.current.duration);
        const targetAmp = isPlaying ? 1.0 : 0.4;

        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = timeRef.current;
            materialRef.current.uniforms.uAudioPhase.value = audioPhase;
            materialRef.current.uniforms.uAmplitude.value = THREE.MathUtils.lerp(
                materialRef.current.uniforms.uAmplitude.value,
                targetAmp,
                delta * 3.0
            );
        }
    });

    return (
        <mesh position={[0, 0, 0.08]} scale={[planeWidth, planeHeight, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                ref={materialRef}
                vertexShader={AURORA_VS}
                fragmentShader={AURORA_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
