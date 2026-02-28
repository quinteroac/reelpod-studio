import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { VisualizerProps } from './types';

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D uTexture;

varying vec2 vUv;

// Hash function for random noise
float N21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 st = vUv * vec2(aspect, 1.0);
    
    // Smooth, slow zoom for the image
    // uTime represents the total accumulated time. Since uTime progresses slowly for the rain
    // (about 0.25 per second), we multiply it by a larger number to get a visible cycle
    float panTime = uTime * 0.25; // Much slower zoom
    float zoom = 1.15 + sin(panTime) * 0.15; // Zooms between 1.0 and 1.3
    
    // Calculate new UVs to keep the image centered while zoomed
    vec2 imageUv = (vUv - 0.5) / zoom + 0.5;
    
    // Sample original background image with new centered UVs
    vec4 texColor = texture2D(uTexture, imageUv);
    vec3 col = texColor.rgb;
    
    float t = uTime * 1.5; // Rain speed
    
    // Base wind that slightly oscillates over time
    float globalWind = sin(t * 0.2) * 0.15 + 0.1;
    
    float rain = 0.0;
    
    // Multiple layers of rain for depth
    for(float i = 1.0; i < 5.0; i++) {
        // Apply a slightly different wind angle per layer to break uniformity
        float layerWind = globalWind + (N21(vec2(i, 1.23)) - 0.5) * 0.2;
        
        vec2 stLayer = st;
        // Slant the coordinates based on this layer's wind
        stLayer.x += stLayer.y * layerWind;
        
        // Adjust coordinate space for this layer (stretch vertically so drops are longer)
        vec2 p = stLayer * vec2(15.0 * i, 1.0); 
        
        // Get a unique ID for the horizontal column
        float columnId = floor(p.x);
        
        // Generate random properties for this column
        float columnNoise = N21(vec2(columnId, i));
        
        // Give each column a random falling speed, plus the base layer speed
        float fallSpeed = 2.0 + (i * 0.6) + (columnNoise * 1.5);
        
        // Apply vertical movement
        p.y += t * fallSpeed;
        
        // Add a huge random vertical offset to each column so they are completely staggered
        p.y += columnNoise * 100.0;
        
        // Now calculate cell IDs including the Y grid
        // We scale Y here to make drops longer or shorter based on the layer
        float yGridScale = 2.0 * i;
        vec2 id = vec2(columnId, floor(p.y * yGridScale));
        vec2 f = fract(vec2(p.x, p.y * yGridScale));
        
        // Random value per individual drop
        float dropNoise = N21(id + i * 0.1);
        
        // Only show drops randomly
        if (dropNoise > 0.7) {
            // slight random horizontal offset inside the column so it doesn't look perfectly aligned
            float xOffset = (N21(id + 0.5) - 0.5) * 0.4;
            float lineX = smoothstep(0.4, 0.5, f.x + xOffset) * smoothstep(0.6, 0.5, f.x + xOffset);
            
            // Randomize drop length via Y fade
            float dropLen = 0.3 + (N21(id + 0.2) * 0.6);
            float lineY = smoothstep(0.0, 0.1, f.y) * smoothstep(dropLen, dropLen - 0.2, f.y);
            
            // Add brightness (closer layers are brighter)
            float brightness = (dropNoise - 0.7) * 8.0 * (1.0 / i);
            rain += lineX * lineY * brightness;
        }
    }
    
    // Blend rain over the image (light blue-white highlight)
    col += rain * vec3(0.9, 0.95, 1.0) * 0.8;
    
    gl_FragColor = vec4(col, 1.0);
}
`;

export function SceneRainVisualizer({ audioCurrentTime, audioDuration, isPlaying, planeWidth, planeHeight, texture }: VisualizerProps) {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const timeRef = useRef(0);
    const audioCurrentTimeRef = useRef(audioCurrentTime);
    const audioDurationRef = useRef(audioDuration);

    audioCurrentTimeRef.current = audioCurrentTime;
    audioDurationRef.current = audioDuration;

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(planeWidth * 100, planeHeight * 100) },
            uTexture: { value: texture },
        }),
        [planeWidth, planeHeight, texture]
    );

    useFrame((_state, delta) => {
        // Calculate audio phase (0 to 1) like the waveform does
        const duration = audioDurationRef.current || 1;
        const phase = (audioCurrentTimeRef.current % duration) / duration;

        // Add delta to base time. Move fast when playing, very slow when paused
        const speedMultiplier = isPlaying ? 0.25 : 0.05; // Reduced from 0.5 to 0.25
        timeRef.current += delta * speedMultiplier;

        // Combine base time with audio phase to make rain react to track progress
        // This gives a constant forward motion plus a song-position-dependent shift
        const totalTime = timeRef.current + phase * 0.25; // Reduced from 1.0 to 0.5

        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = totalTime;
            materialRef.current.uniforms.uResolution.value.set(planeWidth * 100, planeHeight * 100);
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
                key={texture?.uuid || 'default-scenerain-mat'}
                ref={materialRef}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms}
                transparent={true}
            />
        </mesh>
    );
}
