import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useRef } from 'react';
import * as THREE from 'three';
import { buildWaveformPositions, computeWaveformPhase } from '../../lib/visual-scene';
import type { VisualizerProps } from './types';

const WAVEFORM_SAMPLE_COUNT = 192;

type WaveformConfig = {
    color: string;
    yFactor: number;
    amplitudeScale: number;
    speed: number;
    opacity: number;
    freqA: number;
    freqB: number;
    phaseOffset: number;
};

const WAVEFORM_CONFIGS: WaveformConfig[] = [
    { color: '#ffd580', yFactor: 0, amplitudeScale: 1.00, speed: 0.80, opacity: 0.95, freqA: 10.0, freqB: 24.0, phaseOffset: 0 },
    { color: '#7dd3fc', yFactor: 0, amplitudeScale: 0.65, speed: 1.37, opacity: 0.75, freqA: 7.3, freqB: 18.7, phaseOffset: Math.PI * 0.7 },
    { color: '#c4b5fd', yFactor: 0, amplitudeScale: 0.55, speed: 1.03, opacity: 0.70, freqA: 12.9, freqB: 31.1, phaseOffset: Math.PI * 1.5 },
    { color: '#86efac', yFactor: 0, amplitudeScale: 0.42, speed: 1.91, opacity: 0.55, freqA: 5.7, freqB: 22.3, phaseOffset: Math.PI * 0.35 },
];

export function WaveformVisualizer({ audioCurrentTime, audioDuration, isPlaying, planeWidth, planeHeight }: VisualizerProps) {
    // Keep audio values in refs so useFrame never captures a stale closure.
    const audioCurrentTimeRef = useRef(audioCurrentTime);
    const audioDurationRef = useRef(audioDuration);
    const isPlayingRef = useRef(isPlaying);
    audioCurrentTimeRef.current = audioCurrentTime;
    audioDurationRef.current = audioDuration;
    isPlayingRef.current = isPlaying;

    const elapsedRef = useRef(0);
    const amplitudeMultiplierRef = useRef(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linesRef = useRef<any[]>([]);

    useFrame((_state, delta) => {
        const isPlayingNow = isPlayingRef.current;
        const speedMul = isPlayingNow ? 1.0 : 0.05;
        elapsedRef.current += delta * speedMul;

        amplitudeMultiplierRef.current = THREE.MathUtils.lerp(
            amplitudeMultiplierRef.current,
            isPlayingNow ? 1.0 : 0.0,
            delta * 5.0
        );

        const audioPhase = computeWaveformPhase(audioCurrentTimeRef.current, audioDurationRef.current);
        const baseAmplitude = Math.max(planeHeight * 0.28, 0.08) * amplitudeMultiplierRef.current;
        const waveWidth = Math.max(planeWidth * 0.92, 0.5);

        for (let i = 0; i < WAVEFORM_CONFIGS.length; i++) {
            const cfg = WAVEFORM_CONFIGS[i];

            const phase = audioPhase + elapsedRef.current * cfg.speed + cfg.phaseOffset;
            const amplitude = baseAmplitude * cfg.amplitudeScale;

            const positions = buildWaveformPositions(
                WAVEFORM_SAMPLE_COUNT,
                waveWidth,
                amplitude,
                phase,
                cfg.freqA,
                cfg.freqB
            );

            const lineNode = linesRef.current[i];
            if (lineNode && lineNode.geometry) {
                lineNode.geometry.setPositions(positions);
                lineNode.geometry.computeBoundingSphere();
                lineNode.position.set(0, cfg.yFactor * planeHeight, 0.1 + i * 0.01);
            }
        }
    });

    return (
        <>
            {WAVEFORM_CONFIGS.map((cfg, i) => (
                <Line
                    key={i}
                    ref={(el) => {
                        linesRef.current[i] = el;
                    }}
                    points={[0, 0, 0, 1, 1, 1]}
                    color={cfg.color}
                    lineWidth={4}
                    transparent
                    opacity={cfg.opacity}
                />
            ))}
            <EffectComposer>
                <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
            </EffectComposer>
        </>
    );
}
