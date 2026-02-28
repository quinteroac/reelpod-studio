import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeWaveformPhase } from '../../lib/visual-scene';
import type { VisualizerProps } from './types';

const CIRCLE_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CIRCLE_FS = /* glsl */ `
uniform float uTime;
uniform float uAudioPhase;
uniform float uAmplitude;
uniform float uAspect;
varying vec2 vUv;

void main() {
    // Correct aspect ratio so circles are actually round
    vec2 center = (vUv - 0.5) * vec2(uAspect, 1.0);
    float dist = length(center);

    float t = uTime;
    float audioP = uAudioPhase;

    // Create expanding concentric rings
    float ringCount = 6.0;
    float ringSpacing = 0.12;
    float rings = 0.0;

    for (float i = 0.0; i < 6.0; i++) {
        // Each ring expands outward over time, then wraps back
        float phase = fract(t * 0.15 + i / ringCount + audioP * 0.05);
        float radius = phase * 0.8;
        float thickness = 0.008 + phase * 0.004; // Thinner near center, thicker at edge

        // Distance from this ring
        float ringDist = abs(dist - radius);
        float ring = smoothstep(thickness, thickness * 0.3, ringDist);

        // Fade out as ring expands
        float fade = 1.0 - phase;
        fade = fade * fade; // Quadratic fade

        rings += ring * fade;
    }

    // Color gradient based on distance: cyan → purple → pink
    vec3 innerColor = vec3(0.3, 0.85, 1.0);   // Cyan
    vec3 midColor = vec3(0.55, 0.3, 0.9);      // Purple
    vec3 outerColor = vec3(0.95, 0.4, 0.65);   // Pink

    float colorMix = dist * 2.5;
    vec3 ringColor = mix(innerColor, midColor, clamp(colorMix, 0.0, 1.0));
    ringColor = mix(ringColor, outerColor, clamp(colorMix - 0.8, 0.0, 1.0));

    // Add subtle hue rotation over time
    float hueShift = sin(t * 0.2) * 0.15;
    ringColor.r += hueShift;
    ringColor.b -= hueShift * 0.5;

    vec3 col = ringColor * rings * uAmplitude;

    // Soft glow at center
    float centerGlow = exp(-dist * 6.0) * 0.15 * uAmplitude;
    col += vec3(0.4, 0.6, 1.0) * centerGlow;

    float alpha = clamp(rings * 0.6 * uAmplitude + centerGlow, 0.0, 0.7);

    gl_FragColor = vec4(col, alpha);
}
`;

/**
 * CircleSpectrumVisualizer — radial expanding rings that pulse outward from
 * the center of the scene.
 *
 * Ring speed and brightness increase when audio is playing.
 * Renders as a semi-transparent overlay on top of the image plane.
 */
export function CircleSpectrumVisualizer({
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
            uAspect: { value: planeWidth / planeHeight },
        }),
        [planeWidth, planeHeight]
    );

    useFrame((_state, delta) => {
        const speed = isPlaying ? 1.0 : 0.15;
        timeRef.current += delta * speed;

        const audioPhase = computeWaveformPhase(audioRef.current.currentTime, audioRef.current.duration);
        const targetAmp = isPlaying ? 1.0 : 0.3;

        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = timeRef.current;
            materialRef.current.uniforms.uAudioPhase.value = audioPhase;
            materialRef.current.uniforms.uAmplitude.value = THREE.MathUtils.lerp(
                materialRef.current.uniforms.uAmplitude.value,
                targetAmp,
                delta * 3.0
            );
            materialRef.current.uniforms.uAspect.value = planeWidth / planeHeight;
        }
    });

    return (
        <mesh position={[0, 0, 0.08]} scale={[planeWidth, planeHeight, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                ref={materialRef}
                vertexShader={CIRCLE_VS}
                fragmentShader={CIRCLE_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
