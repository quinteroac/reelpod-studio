import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EffectProps } from './types';

const VIGNETTE_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VIGNETTE_FS = /* glsl */ `
uniform float uIntensity;
varying vec2 vUv;
void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    // Smooth radial falloff — corners are darkest
    float vignette = smoothstep(0.25, 0.75, dist) * uIntensity;
    gl_FragColor = vec4(0.0, 0.0, 0.0, vignette);
}
`;

/**
 * VignetteEffect — darkened edges/corners that pulse gently.
 *
 * The intensity oscillates slowly with layered sine waves
 * so the vignette feels organic and musical.
 */
export function VignetteEffect({ isPlaying }: EffectProps) {
    const timeRef = useRef(0);

    const uniforms = useMemo(
        () => ({
            uIntensity: { value: 0.7 },
        }),
        []
    );

    useFrame((_, delta) => {
        const speed = isPlaying ? 1.0 : 0.1;
        timeRef.current += delta * speed;
        const t = timeRef.current;

        // Gently oscillate the vignette intensity
        const pulse = 0.7 + Math.sin(t * 0.4) * 0.15 + Math.sin(t * 1.1) * 0.08;
        uniforms.uIntensity.value = THREE.MathUtils.clamp(pulse, 0.4, 1.0);
    });

    return (
        <mesh position={[0, 0, 0.03]} scale={[20, 20, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                vertexShader={VIGNETTE_VS}
                fragmentShader={VIGNETTE_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
