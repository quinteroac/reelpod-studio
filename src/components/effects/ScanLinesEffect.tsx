import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { EffectProps } from './types';

const SCAN_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SCAN_FS = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uLineCount;
varying vec2 vUv;

void main() {
    // Create horizontal stripes that scroll slowly
    float line = sin((vUv.y + uTime * 0.03) * uLineCount * 3.14159) * 0.5 + 0.5;
    // Sharpen the stripe edges
    line = smoothstep(0.3, 0.7, line);
    gl_FragColor = vec4(0.0, 0.0, 0.0, line * uOpacity);
}
`;

/**
 * ScanLinesEffect — horizontal lines reminiscent of old CRT monitors.
 *
 * Renders semi-transparent horizontal stripes that scroll slowly upward.
 * Opacity pulses gently so the effect breathes with the scene.
 */
export function ScanLinesEffect({ isPlaying }: EffectProps) {
    const timeRef = useRef(0);

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uOpacity: { value: 0.08 },
            uLineCount: { value: 200.0 },
        }),
        []
    );

    useFrame((_, delta) => {
        const speed = isPlaying ? 1.0 : 0.15;
        timeRef.current += delta * speed;
        const t = timeRef.current;
        uniforms.uTime.value = t;

        // Subtle opacity breathing
        uniforms.uOpacity.value = 0.08 + Math.sin(t * 0.5) * 0.03;
    });

    return (
        <mesh position={[0, 0, 0.06]} scale={[20, 20, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                vertexShader={SCAN_VS}
                fragmentShader={SCAN_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
