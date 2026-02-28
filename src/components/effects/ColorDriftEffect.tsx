import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { EffectProps } from './types';

/**
 * Warm lofi palette for the color drift.
 * Each color is a soft, muted tone typical of lofi aesthetics.
 */
const PALETTE = [
    new THREE.Color('#8B6F47'), // warm brown
    new THREE.Color('#6B4C6E'), // muted purple
    new THREE.Color('#4A6B5A'), // sage green
    new THREE.Color('#7B5E57'), // dusty rose
    new THREE.Color('#5A6B7B'), // slate blue
    new THREE.Color('#8B7355'), // amber
];

/**
 * ColorDriftEffect — slow, dreamy color tint that drifts between warm lofi tones.
 *
 * Renders a transparent overlay mesh whose color lerps smoothly
 * between palette colors. The transitions are slow and organic.
 */
export function ColorDriftEffect({ isPlaying }: EffectProps) {
    const timeRef = useRef(0);
    const meshRef = useRef<THREE.Mesh>(null);
    const colorRef = useRef(new THREE.Color());
    const indexRef = useRef(0);
    const nextIndexRef = useRef(1);
    const progressRef = useRef(0);

    useFrame((_, delta) => {
        if (!meshRef.current) return;

        const speed = isPlaying ? 1.0 : 0.1;
        timeRef.current += delta * speed;

        // Each color transition takes ~8 seconds
        const transitionSpeed = 0.125;
        progressRef.current += delta * speed * transitionSpeed;

        if (progressRef.current >= 1.0) {
            progressRef.current = 0;
            indexRef.current = nextIndexRef.current;
            nextIndexRef.current = (nextIndexRef.current + 1) % PALETTE.length;
        }

        // Smooth easing
        const t = progressRef.current;
        const ease = t * t * (3 - 2 * t); // smoothstep

        colorRef.current.copy(PALETTE[indexRef.current]).lerp(PALETTE[nextIndexRef.current], ease);

        const material = meshRef.current.material as THREE.MeshBasicMaterial;
        material.color.copy(colorRef.current);

        // Very gentle opacity pulse
        const opacityBase = 0.10;
        const opacityPulse = Math.sin(timeRef.current * 0.3) * 0.04;
        material.opacity = THREE.MathUtils.clamp(opacityBase + opacityPulse, 0.04, 0.18);
    });

    return (
        <mesh ref={meshRef} position={[0, 0, 0.025]} scale={[20, 20, 1]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color="#8B6F47" transparent opacity={0.10} />
        </mesh>
    );
}
