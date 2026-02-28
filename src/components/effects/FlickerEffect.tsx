import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { EffectProps } from './types';

/**
 * FlickerEffect — simulates a subtle, organic blinking / flicker.
 *
 * It works by periodically dimming the texture's brightness via the
 * mesh material opacity.  The flicker cadence uses layered sine waves
 * so the rhythm feels natural rather than mechanical.
 */
export function FlickerEffect({ isPlaying, texture }: EffectProps) {
    const timeRef = useRef(0);
    const meshRef = useRef<THREE.Mesh>(null);
    // Random phase offsets so each session starts with a unique color
    const phaseRef = useRef({
        r: Math.random() * Math.PI * 2,
        g: Math.random() * Math.PI * 2,
        b: Math.random() * Math.PI * 2,
    });

    useFrame((_, delta) => {
        if (!meshRef.current) return;

        const speed = isPlaying ? 1.0 : 0.15;
        timeRef.current += delta * speed;
        const t = timeRef.current;

        // --- Opacity flicker (layered sine waves) ---
        const flicker1 = Math.sin(t * 2.5) * 0.18;
        const flicker2 = Math.sin(t * 7.3) * 0.10;
        const flicker3 = Math.sin(t * 13.7) * 0.05;
        const noise = (Math.random() - 0.5) * 0.06;

        const baseOpacity = 0.30;
        const opacity = THREE.MathUtils.clamp(
            baseOpacity + flicker1 + flicker2 + flicker3 + noise,
            0.0,
            0.7
        );

        // --- Randomized color cycling ---
        // Each channel oscillates at a different speed with unique phase offsets,
        // producing slowly drifting, unpredictable hues.
        const p = phaseRef.current;
        const r = 0.5 + 0.5 * Math.sin(t * 0.37 + p.r);
        const g = 0.5 + 0.5 * Math.sin(t * 0.53 + p.g);
        const b = 0.5 + 0.5 * Math.sin(t * 0.71 + p.b);

        const material = meshRef.current.material as THREE.MeshBasicMaterial;
        material.opacity = opacity;
        material.color.setRGB(r, g, b);
    });

    // Colored overlay whose opacity & hue fluctuate to create the flicker.
    // Positioned slightly in front of the image plane (z = 0.02).
    return (
        <mesh ref={meshRef} position={[0, 0, 0.02]} scale={[20, 20, 1]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.18} />
        </mesh>
    );
}
