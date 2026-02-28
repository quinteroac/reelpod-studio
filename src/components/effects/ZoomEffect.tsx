import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { EffectProps } from './types';

export function ZoomEffect({ isPlaying, texture }: EffectProps) {
    const timeRef = useRef(0);

    useFrame((_, delta) => {
        if (!texture) return;
        const speed = isPlaying ? 1.0 : 0.05;
        timeRef.current += delta * speed;
        const t = timeRef.current;

        // Smooth, slow zoom for the image
        const panTime = t * 0.05; // Much slower
        const zoom = 1.1 + Math.sin(panTime) * 0.1; // Zooms between 1.0 and 1.2

        // We scale the UVs. A scale < 1 zooms in
        texture.repeat.set(1 / zoom, 1 / zoom);

        // Keep it centered without panning
        const centerX = 0.5 - (1 / zoom) / 2;
        const centerY = 0.5 - (1 / zoom) / 2;
        texture.offset.set(centerX, centerY);
        texture.needsUpdate = true;
    });

    return null; // This effect only mutates the shared texture and doesn't render DOM/WebGL elements
}
