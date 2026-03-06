import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { EffectProps } from './types';

const vertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform vec3 uLightColor;
varying vec2 vUv;

void main() {
    // Gradiente vertical uniforme: la luz llena todo el ancho desde abajo
    // sin ningun punto focal ni banda visible
    float fade = pow(1.0 - vUv.y, 1.8);

    float alpha = fade * 0.42;
    alpha = clamp(alpha, 0.0, 0.45);

    gl_FragColor = vec4(uLightColor, alpha);
}
`;

/**
 * LightingMovementEffect — simulates a sunrise/sunset light source at the horizon.
 *
 * The light originates from a point just below the bottom edge and slowly
 * drifts left/right, radiating upward like a sun. Color cycles between
 * warm golden/orange (sunrise) and cool purple/blue (dusk).
 */
export function LightingMovementEffect({ isPlaying }: EffectProps) {
    const timeRef = useRef(0);
    const meshRef = useRef<THREE.Mesh>(null);

    const uniformsRef = useRef({
        uLightColor: { value: new THREE.Color(1.0, 0.55, 0.15) }, // warm orange
    });

    useFrame((_, delta) => {
        if (!meshRef.current) return;

        const speed = isPlaying ? 1.0 : 0.15;
        timeRef.current += delta * speed;

        // Cycle through sunrise → golden → dusk → purple tones
        const t = timeRef.current * 0.04;
        const phase = (Math.sin(t) + 1) / 2; // 0..1

        // sunrise orange → golden noon → dusk purple
        let r, g, b;
        if (phase < 0.5) {
            const p = phase * 2;
            r = THREE.MathUtils.lerp(1.0,  1.0,  p);
            g = THREE.MathUtils.lerp(0.45, 0.75, p);
            b = THREE.MathUtils.lerp(0.1,  0.2,  p);
        } else {
            const p = (phase - 0.5) * 2;
            r = THREE.MathUtils.lerp(1.0,  0.6,  p);
            g = THREE.MathUtils.lerp(0.75, 0.3,  p);
            b = THREE.MathUtils.lerp(0.2,  0.7,  p);
        }

        uniformsRef.current.uLightColor.value.setRGB(r, g, b);
    });

    return (
        <mesh ref={meshRef} position={[0, 0, 0.03]} scale={[20, 20, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniformsRef.current}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
