import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { EffectProps } from './types';

// Slight zoom-in so panning never reveals the edge of the texture
const ZOOM = 1.18;
const UV_SCALE = 1 / ZOOM;        // visible fraction per axis (~0.847)
const MAX_OFFSET = 1 - UV_SCALE;  // max travel per axis (~0.153)

/**
 * CameraMovementEffect — simulates handheld camera with random pan targets
 * and variable movement speed (slow drift → quick reframe).
 *
 * Works by animating texture.offset (pan) and texture.repeat (zoom).
 * Note: conflicts with ZoomEffect if both are active simultaneously.
 */
export function CameraMovementEffect({ isPlaying, texture }: EffectProps) {
    const timeRef = useRef(0);
    const posRef = useRef({ x: MAX_OFFSET / 2, y: MAX_OFFSET / 2 });
    const targetRef = useRef({ x: MAX_OFFSET / 2, y: MAX_OFFSET / 2 });
    // Speed: slow drift (0.25) → quick snap (3.0)
    const speedRef = useRef(0.5);
    // Zoom oscillates subtly around ZOOM base
    const zoomPhaseRef = useRef(Math.random() * Math.PI * 2);
    // Accumulated time for next target selection
    const nextTargetAtRef = useRef(0);

    useFrame((_, delta) => {
        if (!texture) return;

        const playSpeed = isPlaying ? 1.0 : 0.08;
        timeRef.current += delta * playSpeed;
        const t = timeRef.current;

        // Pick a new random target when it's time
        if (t >= nextTargetAtRef.current) {
            targetRef.current = {
                x: Math.random() * MAX_OFFSET,
                y: Math.random() * MAX_OFFSET,
            };
            // Variable speed: slow (0.25) or fast (up to 3.0), weighted toward slow
            speedRef.current = Math.random() < 0.7
                ? 0.25 + Math.random() * 0.6   // 70% slow drift
                : 1.2 + Math.random() * 1.8;   // 30% quick reframe
            // Dwell time before next target: 1.5s – 6s
            nextTargetAtRef.current = t + 1.5 + Math.random() * 4.5;
        }

        // Exponential lerp — decelerates naturally as we approach the target
        const lerpFactor = 1 - Math.exp(-speedRef.current * delta * playSpeed * 60);
        posRef.current.x += (targetRef.current.x - posRef.current.x) * lerpFactor;
        posRef.current.y += (targetRef.current.y - posRef.current.y) * lerpFactor;

        // Subtle zoom breathe ±2% layered on top of the base ZOOM
        zoomPhaseRef.current += delta * playSpeed * 0.18;
        const zoomFactor = ZOOM + Math.sin(zoomPhaseRef.current) * 0.02;
        const uvScale = 1 / zoomFactor;
        const maxOff = 1 - uvScale;

        // Re-clamp offset to the current UV scale bounds
        const ox = Math.min(posRef.current.x, maxOff);
        const oy = Math.min(posRef.current.y, maxOff);

        texture.repeat.set(uvScale, uvScale);
        texture.offset.set(ox, oy);
        texture.needsUpdate = true;
    });

    return null;
}
