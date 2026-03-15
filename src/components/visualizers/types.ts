import type * as THREE from 'three';

export type VisualizerType = 'waveform' | 'rain' | 'scene-rain' | 'starfield' | 'aurora' | 'circle-spectrum' | 'glitch' | 'smoke' | 'contour' | 'none';

export type VisualizerProps = {
    audioCurrentTime: number;
    audioDuration: number;
    isPlaying: boolean;
    planeWidth: number;
    planeHeight: number;
    texture?: THREE.Texture;
};
