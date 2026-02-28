import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeWaveformPhase } from '../../lib/visual-scene';
import type { VisualizerProps } from './types';

const CONTOUR_VS = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CONTOUR_FS = /* glsl */ `
uniform float uTime;
uniform float uAudioPhase;
uniform float uAmplitude;
uniform float uAspect;
varying vec2 vUv;

// Smooth noise
float hash(vec2 p) {
    p = fract(p * vec2(443.8975, 397.2973));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// HSL to RGB conversion
vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

void main() {
    vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0);
    float t = uTime;

    // Create a terrain-like height field using FBM noise
    vec2 drift = vec2(t * 0.06, t * 0.04);
    float height = fbm(uv * 2.5 + drift);

    // Add a second layer warped by the first for organic shapes
    height += fbm(uv * 3.5 - drift * 0.7 + height * 0.4) * 0.5;

    // Audio reactivity — modulate the height field
    float audioPulse = sin(uAudioPhase * 2.0 + t * 0.5) * 0.1;
    height += audioPulse * uAmplitude;

    // Normalize height to [0, 1]
    height = fract(height * 1.0);

    // Generate contour lines
    float contourCount = 12.0; // Number of contour levels
    float contourVal = height * contourCount;
    float contourFrac = fract(contourVal);

    // Sharp contour lines using smoothstep
    float lineWidth = 0.06 + uAmplitude * 0.03;
    float contourLine = 1.0 - smoothstep(0.0, lineWidth, contourFrac)
                       + smoothstep(1.0 - lineWidth, 1.0, contourFrac);

    // Color each band with a different hue — cycling through a warm-to-cool palette
    float bandId = floor(contourVal) / contourCount;

    // Hue shifts slowly over time for a living feel
    float hueBase = bandId + t * 0.03;
    float hue = fract(hueBase);

    // Saturation and lightness vary per band for depth
    float sat = 0.6 + sin(bandId * 6.28) * 0.2;
    float lit = 0.45 + cos(bandId * 4.5 + t * 0.2) * 0.15;

    vec3 bandColor = hsl2rgb(hue, sat, lit);

    // Emphasize contour lines — they glow brighter
    vec3 lineColor = hsl2rgb(fract(hue + 0.1), 0.9, 0.75);

    vec3 col = mix(bandColor * 0.6, lineColor, contourLine * 0.8);

    // Subtle glow on contour lines
    col += contourLine * 0.15 * uAmplitude;

    // Soft edge fade
    vec2 edgeUv = vUv;
    float edgeFade = smoothstep(0.0, 0.1, edgeUv.x) * smoothstep(1.0, 0.9, edgeUv.x)
                   * smoothstep(0.0, 0.1, edgeUv.y) * smoothstep(1.0, 0.9, edgeUv.y);

    float alpha = (0.35 + contourLine * 0.3) * uAmplitude * edgeFade;
    alpha = clamp(alpha, 0.0, 0.7);

    gl_FragColor = vec4(col, alpha);
}
`;

/**
 * ContourVisualizer — topographic contour lines with shifting colors.
 *
 * Uses FBM noise to create a height field, then draws contour lines at
 * regular intervals. Each band gets a unique hue that slowly shifts over
 * time. Contour lines glow and pulse with audio playback.
 * Renders as a semi-transparent overlay on top of the image plane.
 */
export function ContourVisualizer({
    audioCurrentTime,
    audioDuration,
    isPlaying,
    planeWidth,
    planeHeight,
}: VisualizerProps) {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const timeRef = useRef(0);
    const audioRef = useRef({ currentTime: audioCurrentTime, duration: audioDuration });
    audioRef.current = { currentTime: audioCurrentTime, duration: audioDuration };

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uAudioPhase: { value: 0 },
            uAmplitude: { value: 0.5 },
            uAspect: { value: planeWidth / planeHeight },
        }),
        [planeWidth, planeHeight]
    );

    useFrame((_state, delta) => {
        const speed = isPlaying ? 1.0 : 0.1;
        timeRef.current += delta * speed;

        const audioPhase = computeWaveformPhase(audioRef.current.currentTime, audioRef.current.duration);
        const targetAmp = isPlaying ? 1.0 : 0.4;

        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = timeRef.current;
            materialRef.current.uniforms.uAudioPhase.value = audioPhase;
            materialRef.current.uniforms.uAmplitude.value = THREE.MathUtils.lerp(
                materialRef.current.uniforms.uAmplitude.value,
                targetAmp,
                delta * 3.0
            );
            materialRef.current.uniforms.uAspect.value = planeWidth / planeHeight;
        }
    });

    return (
        <mesh position={[0, 0, 0.08]} scale={[planeWidth, planeHeight, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                ref={materialRef}
                vertexShader={CONTOUR_VS}
                fragmentShader={CONTOUR_FS}
                uniforms={uniforms}
                transparent
                depthWrite={false}
            />
        </mesh>
    );
}
