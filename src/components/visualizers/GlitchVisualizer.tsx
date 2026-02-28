import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeWaveformPhase } from '../../lib/visual-scene';
import type { VisualizerProps } from './types';

const GLITCH_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLITCH_FS = /* glsl */ `
uniform float uTime;
uniform float uAudioPhase;
uniform float uIntensity;
uniform sampler2D uTexture;
varying vec2 vUv;

// Pseudo-random hash
float hash(vec2 p) {
    p = fract(p * vec2(443.8975, 397.2973));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

float hash1(float n) {
    return fract(sin(n) * 43758.5453);
}

void main() {
    vec2 uv = vUv;
    float t = uTime;
    float intensity = uIntensity;

    // — Horizontal block displacement —
    // Divide the screen into horizontal bands
    float bandHeight = 0.03 + hash1(floor(t * 4.0)) * 0.08;
    float bandId = floor(uv.y / bandHeight);
    float bandRand = hash1(bandId + floor(t * 3.0) * 17.0);

    // Only glitch some bands
    float glitchStrength = step(0.85 - intensity * 0.3, bandRand) * intensity;

    // Horizontal offset for the band
    float hOffset = (hash1(bandId + t * 7.0) - 0.5) * 0.06 * glitchStrength;
    uv.x += hOffset;

    // — RGB channel split —
    float splitAmount = 0.005 + intensity * 0.012;

    // Occasionally, apply a larger split for dramatic effect
    float bigSplitTrigger = step(0.92, hash1(floor(t * 2.0) + 0.5));
    splitAmount += bigSplitTrigger * 0.02 * intensity;

    vec2 rOffset = vec2(splitAmount, 0.0);
    vec2 bOffset = vec2(-splitAmount, splitAmount * 0.5);

    float r = texture2D(uTexture, uv + rOffset).r;
    float g = texture2D(uTexture, uv).g;
    float b = texture2D(uTexture, uv + bOffset).b;

    vec3 col = vec3(r, g, b);

    // — Scanline noise —
    float scanline = sin(uv.y * 800.0 + t * 20.0) * 0.03 * intensity;
    col += scanline;

    // — Occasional full-screen noise flash —
    float noiseTrigger = step(0.96, hash1(floor(t * 5.0)));
    float noiseVal = hash(uv * 500.0 + t * 100.0);
    col = mix(col, vec3(noiseVal), noiseTrigger * 0.15 * intensity);

    // — Slight color tint on glitch frames —
    float tintTrigger = step(0.9, hash1(floor(t * 3.5) + 13.0));
    col += vec3(0.1, -0.05, 0.15) * tintTrigger * intensity * 0.4;

    // — Subtle vignette to ground the effect —
    float vignette = 1.0 - length((vUv - 0.5) * 1.2) * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * GlitchVisualizer — digital glitch/distortion effect on the uploaded image.
 *
 * Splits RGB channels, adds horizontal band displacements, scanline noise,
 * and occasional full-screen noise bursts. Intensity is driven by audio
 * playback state.
 *
 * This visualizer hides the default image plane and renders its own
 * texture-sampled fullscreen quad.
 */
export function GlitchVisualizer({
    audioCurrentTime,
    audioDuration,
    isPlaying,
    planeWidth,
    planeHeight,
    texture,
}: VisualizerProps) {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const timeRef = useRef(0);
    const audioRef = useRef({ currentTime: audioCurrentTime, duration: audioDuration });
    audioRef.current = { currentTime: audioCurrentTime, duration: audioDuration };

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uAudioPhase: { value: 0 },
            uIntensity: { value: 0.3 },
            uTexture: { value: texture },
        }),
        [texture]
    );

    useFrame((_state, delta) => {
        const speed = isPlaying ? 1.0 : 0.15;
        timeRef.current += delta * speed;

        const audioPhase = computeWaveformPhase(audioRef.current.currentTime, audioRef.current.duration);
        // Pulse intensity with audio — more glitchy at certain phases
        const basePulse = Math.sin(audioPhase * 3.0 + timeRef.current) * 0.3 + 0.5;
        const targetIntensity = isPlaying ? basePulse * 0.9 : 0.15;

        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = timeRef.current;
            materialRef.current.uniforms.uAudioPhase.value = audioPhase;
            materialRef.current.uniforms.uIntensity.value = THREE.MathUtils.lerp(
                materialRef.current.uniforms.uIntensity.value,
                targetIntensity,
                delta * 4.0
            );
            if (texture) {
                materialRef.current.uniforms.uTexture.value = texture;
                materialRef.current.uniformsNeedUpdate = true;
            }
        }
    });

    return (
        <mesh scale={[planeWidth, planeHeight, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                key={texture?.uuid || 'default-glitch-mat'}
                ref={materialRef}
                vertexShader={GLITCH_VS}
                fragmentShader={GLITCH_FS}
                uniforms={uniforms}
                transparent={false}
            />
        </mesh>
    );
}
