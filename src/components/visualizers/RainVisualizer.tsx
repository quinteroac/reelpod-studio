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
uniform vec3 uMouse;
uniform sampler2D uTexture;

varying vec2 vUv;

float S(float a, float b, float t) {
    if (a == b) return step(a, t);
    float x = clamp((t - a) / (b - a), 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
}
//#define CHEAP_NORMALS
#define HAS_HEART
//#define USE_POST_PROCESSING // Disable post processing like lightning to keep it calm, or keep if wanted

vec3 N13(float p) {
   vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
   p3 += dot(p3, p3.yzx + 19.19);
   return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
}

float N(float t) {
    return fract(sin(t*12345.564)*7658.76);
}

float Saw(float b, float t) {
	return S(0., b, t)*S(1., b, t);
}

vec2 DropLayer2(vec2 uv, float t) {
    vec2 UV = uv;
    
    uv.y += t*0.75;
    vec2 a = vec2(6., 1.);
    vec2 grid = a*2.;
    vec2 id = floor(uv*grid);
    
    float colShift = N(id.x); 
    uv.y += colShift;
    
    id = floor(uv*grid);
    vec3 n = N13(id.x*35.2+id.y*2376.1);
    vec2 st = fract(uv*grid)-vec2(.5, 0);
    
    float x = n.x-.5;
    
    float y = UV.y*20.;
    float wiggle = sin(y+sin(y));
    x += wiggle*(.5-abs(x))*(n.z-.5);
    x *= .7;
    float ti = fract(t+n.z);
    y = (Saw(.85, ti)-.5)*.9+.5;
    vec2 p = vec2(x, y);
    
    float d = length((st-p)*a.yx);
    
    float mainDrop = S(.4, .0, d);
    
    float r = sqrt(S(1., y, st.y));
    float cd = abs(st.x-x);
    float trail = S(.23*r, .15*r*r, cd);
    float trailFront = S(-.02, .02, st.y-y);
    trail *= trailFront*r*r;
    
    y = UV.y;
    float trail2 = S(.2*r, .0, cd);
    float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
    y = fract(y*10.)+(st.y-.5);
    float dd = length(st-vec2(x, y));
    droplets = S(.3, 0., dd);
    float m = mainDrop+droplets*r*trailFront;
    
    return vec2(m, trail);
}

float StaticDrops(vec2 uv, float t) {
	uv *= 40.;
    
    vec2 id = floor(uv);
    uv = fract(uv)-.5;
    vec3 n = N13(id.x*107.45+id.y*3543.654);
    vec2 p = (n.xy-.5)*.7;
    float d = length(uv-p);
    
    float fade = Saw(.025, fract(t+n.z));
    float c = S(.3, 0., d)*fract(n.z*10.)*fade;
    return c;
}

vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
    float s = StaticDrops(uv, t)*l0; 
    vec2 m1 = DropLayer2(uv, t)*l1;
    vec2 m2 = DropLayer2(uv*1.85, t)*l2;
    
    float c = s+m1.x+m2.x;
    c = S(.3, 1., c);
    
    return vec2(c, max(m1.y*l0, m2.y*l1));
}

void main() {
    float iTime = uTime;
    vec3 iMouse = uMouse;
    vec3 iResolution = vec3(uResolution, 1.0);
    vec2 fragCoord = vUv * iResolution.xy;

	vec2 uv = (fragCoord.xy-.5*iResolution.xy) / iResolution.y;
    vec2 UV = vUv;
    vec3 M = iMouse.xyz/iResolution.xyz;
    float T = iTime+M.x*2.;
    
    // Disable the heart logic for general lofi visualizer
    // #ifdef HAS_HEART
    // T = mod(iTime, 102.);
    // T = mix(T, M.x*102., M.z>0.?1.:0.);
    // #endif
    
    float t = T*.2;
    
    // Constant rain amount if not using mouse
    float rainAmount = 0.5; // sin(T*.05)*.3+.7;
    
    float maxBlur = mix(3., 6., rainAmount);
    float minBlur = 2.;
    
    float zoom = -cos(T*.2);
    uv *= .7+zoom*.3;
    UV = (UV-.5)*(.9+zoom*.1)+.5;
    
    float staticDrops = S(-.5, 1., rainAmount)*2.;
    float layer1 = S(.25, .75, rainAmount);
    float layer2 = S(.0, .5, rainAmount);
    
    vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
    vec2 e = vec2(.001, 0.);
    float cx = Drops(uv+e, t, staticDrops, layer1, layer2).x;
    float cy = Drops(uv+e.yx, t, staticDrops, layer1, layer2).x;
    vec2 n = vec2(cx-c.x, cy-c.x);		// expensive normals
    
    float focus = mix(maxBlur-c.y, minBlur, S(.1, .2, c.x));
    
    // Lod is not easily available in all webgl 1 setups by default (needs extension),
    // but standard texture2D might not support blur. Let's use simple texture lookup with normal offset.
    // For blur, WebGL needs texture2DLodEXT or multiple samples.
    // As a compatible alternative, we will sample around.
    
    vec4 tex = texture2D(uTexture, UV+n);
    vec3 col = tex.rgb;
    
    // To fake blur we mix it or simply darken the focused areas.
    // For standard webgl without textureLod, we will just use normal offset.
    
    gl_FragColor = vec4(col, 1.0);
}
`;

export function RainVisualizer({ isPlaying, planeWidth, planeHeight, texture }: VisualizerProps) {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const timeRef = useRef(0);

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(planeWidth * 100, planeHeight * 100) },
            uMouse: { value: new THREE.Vector3(0, 0.5, 0) },
            uTexture: { value: texture },
        }),
        [planeWidth, planeHeight, texture]
    );

    useFrame((_state, delta) => {
        // Only animate rain if playing
        if (isPlaying) {
            timeRef.current += delta;
        }
        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = timeRef.current;
            materialRef.current.uniforms.uResolution.value.set(planeWidth * 100, planeHeight * 100);
            if (texture) {
                materialRef.current.uniforms.uTexture.value = texture;
            }
        }
    });

    return (
        <mesh scale={[planeWidth, planeHeight, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                ref={materialRef}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms}
                transparent={true}
            />
        </mesh>
    );
}
