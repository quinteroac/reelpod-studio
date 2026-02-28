import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeWaveformPhase } from '../../lib/visual-scene';
import type { VisualizerProps } from './types';

const SMOKE_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SMOKE_FS = /* glsl */ `
uniform float uTime;
uniform float uAudioPhase;
uniform float uDensity;
varying vec2 vUv;

// Value noise
float hash(vec2 p) {
    p = fract(p * vec2(443.8975, 397.2973));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion — layered noise for organic shapes
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

void main() {
    vec2 uv = vUv;
    float t = uTime;

    // Drift direction: slow upward and rightward motion
    vec2 drift = vec2(t * 0.08, -t * 0.05);

    // Two FBM layers with different scales and drift rates for depth
    float smoke1 = fbm(uv * 3.0 + drift);
    float smoke2 = fbm(uv * 5.0 + drift * 1.3 + vec2(5.2, 1.3));

    // Domain warping: use one noise to distort the other
    float warped = fbm(uv * 3.5 + vec2(smoke1 * 0.4, smoke2 * 0.3) + drift * 0.7);

    // Combine layers
    float smoke = (smoke1 * 0.4 + smoke2 * 0.3 + warped * 0.3);

    // Threshold and shape the smoke
    smoke = smoothstep(0.3, 0.7, smoke);

    // Audio reactivity — density pulses with audio phase
    float audioPulse = sin(uAudioPhase * 2.0 + t * 0.8) * 0.15 + 0.85;
    smoke *= audioPulse;

    // Soft edge fade so smoke doesn't have hard borders
    float edgeFade = smoothstep(0.0, 0.2, uv.x) * smoothstep(1.0, 0.8, uv.x)
                   * smoothstep(0.0, 0.15, uv.y) * smoothstep(1.0, 0.85, uv.y);
    smoke *= edgeFade;

    // Color: warm grey/white smoke with subtle color
    vec3 smokeColor = vec3(0.85, 0.82, 0.78); // Warm grey
    smokeColor += vec3(0.05, 0.02, -0.02) * sin(t * 0.3); // Subtle warm shift

    float alpha = smoke * uDensity * 0.45;
    alpha = clamp(alpha, 0.0, 0.5);

    gl_FragColor = vec4(smokeColor, alpha);
}
`;

/**
 * SmokeVisualizer — soft animated fog/smoke that drifts across the scene.
 *
 * Uses Fractal Brownian Motion (FBM) with domain warping for organic
 * smoke shapes. Density and speed respond to audio playback.
 * Renders as a semi-transparent overlay on top of the image plane.
 */
export function SmokeVisualizer({
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
            uDensity: { value: 0.5 },
        }),
        []
    );

    useFrame((_state, delta) => {
        const speed = isPlaying ? 1.0 : 0.12;
        timeRef.current += delta * speed;

        const audioPhase = computeWaveformPhase(audioRef.current.currentTime, audioRef.current.duration);
        const targetDensity = isPlaying ? 0.9 : 0.4;

        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = timeRef.current;
            materialRef.current.uniforms.uAudioPhase.value = audioPhase;
            materialRef.current.uniforms.uDensity.value = THREE.MathUtils.lerp(
                materialRef.current.uniforms.uDensity.value,
                targetDensity,
                delta * 2.5
            );
        }
    });

    return (
        <mesh position={[0, 0, 0.08]} scale={[planeWidth, planeHeight, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                ref={materialRef}
                vertexShader={SMOKE_VS}
                fragmentShader={SMOKE_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
