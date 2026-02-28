import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { EffectProps } from './types';

const GRAIN_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRAIN_FS = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;

// Pseudo-random hash
float hash(vec2 p) {
    p = fract(p * vec2(443.8975, 397.2973));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

void main() {
    // Rapidly changing grain — use time to seed the noise
    float grain = hash(vUv * 500.0 + uTime * 100.0);
    // Shift to [-0.5, 0.5] and apply intensity
    grain = (grain - 0.5) * uIntensity;
    // Render as a semi-transparent grey modulation
    float luminance = 0.5 + grain;
    gl_FragColor = vec4(vec3(luminance), 0.12);
}
`;

/**
 * FilmGrainEffect — animated noise overlay simulating old film grain.
 *
 * A full-screen shader generates pseudo-random noise that changes
 * every frame, giving the scene a warm analog texture.
 */
export function FilmGrainEffect({ isPlaying }: EffectProps) {
    const timeRef = useRef(0);

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uIntensity: { value: 0.5 },
        }),
        []
    );

    useFrame((_, delta) => {
        const speed = isPlaying ? 1.0 : 0.3;
        timeRef.current += delta * speed;
        uniforms.uTime.value = timeRef.current;
    });

    return (
        <mesh position={[0, 0, 0.04]} scale={[20, 20, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                vertexShader={GRAIN_VS}
                fragmentShader={GRAIN_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
