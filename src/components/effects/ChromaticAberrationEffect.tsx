import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EffectProps } from './types';

const CHROMA_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CHROMA_FS = /* glsl */ `
uniform sampler2D uTexture;
uniform float uOffset;
varying vec2 vUv;

void main() {
    // Offset R and B channels in opposite directions from center
    vec2 dir = normalize(vUv - 0.5);
    float r = texture2D(uTexture, vUv + dir * uOffset).r;
    float g = texture2D(uTexture, vUv).g;
    float b = texture2D(uTexture, vUv - dir * uOffset).b;
    float a = texture2D(uTexture, vUv).a;
    gl_FragColor = vec4(r, g, b, a);
}
`;

/**
 * ChromaticAberrationEffect — subtle RGB channel offset.
 *
 * Shifts the red and blue channels outward from center to create
 * a retro lens distortion look. The offset amount breathes slowly.
 */
export function ChromaticAberrationEffect({ isPlaying, texture }: EffectProps) {
    const timeRef = useRef(0);

    const uniforms = useMemo(
        () => ({
            uTexture: { value: texture ?? null },
            uOffset: { value: 0.002 },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    useFrame((_, delta) => {
        if (!texture) return;
        uniforms.uTexture.value = texture;
        const speed = isPlaying ? 1.0 : 0.1;
        timeRef.current += delta * speed;
        const t = timeRef.current;

        // Gently oscillate the aberration strength
        const offset = 0.002 + Math.sin(t * 0.6) * 0.001 + Math.sin(t * 1.7) * 0.0005;
        uniforms.uOffset.value = THREE.MathUtils.clamp(offset, 0.0005, 0.005);
    });

    return (
        <mesh position={[0, 0, 0.01]} scale={[20, 20, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                vertexShader={CHROMA_VS}
                fragmentShader={CHROMA_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
