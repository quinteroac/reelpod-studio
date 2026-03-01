# Project Context

<!-- Created or updated by `bun nvst create project-context`. Cap: 250 lines. -->

## Conventions
- Naming: PascalCase for components, camelCase for variables/functions, kebab-case for files
- Formatting: Prettier + ESLint defaults
- Git flow: feature branches per iteration (`feature/it_XXXXXX`), merged to main after approval
- Workflow: Define → Prototype → Refactor per iteration; adhere to this file from iteration 2 onward
- GLSL shaders: inline strings in component files; use custom `smoothstep` implementation (avoid Shadertoy macros that cause WebGL undefined behaviour)
- R3F performance: mutate refs in `useFrame` to avoid React re-renders; never set React state inside the render loop

## Tech Stack
- Language: TypeScript (frontend) + Python (backend)
- Runtime: Browser frontend (React/Vite) + Python backend (FastAPI) + ACEStep service (port 8001)
- Frameworks: React 19 + Vite, React Three Fiber (R3F)
- Key libraries:
  - `three` + `@types/three`: 3D geometry, materials, `ShaderMaterial`, `InstancedMesh`
  - `@react-three/fiber`: R3F — `Canvas`, `useFrame`, `useLoader`, `useThree`
  - `@react-three/drei`: R3F helpers — `Line` component
  - `@react-three/postprocessing`: post-processing pipeline — `EffectComposer`, `Bloom`
  - ACEStep: separate REST API process (`start-acestep.sh`), local music generation model
- Package manager: bun
- Build / tooling: Vite

## Code Standards
- Style patterns: functional components, hooks for state and side effects
- Error handling: user-visible error messages for audio failures (network errors, non-OK responses, inference errors)
- Module organisation: `src/components/` for UI (with `visualizers/` and `effects/` subsystems), `src/lib/` for pure logic
- Visualizer pattern: factory + registry via switch-case in `VisualizerFactory`; all visualizers implement `VisualizerProps`
- Effect pattern: composer + registry via object map in `EffectComposer`; all effects implement `EffectProps`; multiple effects stack freely
- Shader visualizers: `<mesh>` with `<shaderMaterial>` + inline GLSL; uniforms updated via `useFrame` + `materialRef`
- R3F testing: DOM overlay with `data-*` attributes to expose Three.js-computed values to jsdom tests
- Forbidden patterns: no Strudel REPL; no setting React state inside `useFrame`

## Testing Strategy
- Approach: TDD — write tests before implementation
- Runner: Vitest (frontend) + pytest (backend)
- Coverage targets: none enforced for MVP
- Test location convention: co-located `*.test.ts` / `*.test.tsx` next to frontend source; `backend/test_main.py` for backend
- Test setup: `src/test/setup.ts` provides jsdom polyfills (`URL.createObjectURL`, `ResizeObserver` mock, `afterEach(cleanup)`)

## Product Architecture
- Browser frontend (React/Vite) + Python backend (FastAPI, port 8000) + ACEStep service (port 8001); Vite proxies `/api` to backend
- Backend layering: `backend/routes/` handles HTTP transport + exception mapping, `backend/services/` owns business logic/orchestration, `backend/repositories/` performs external I/O (ACEStep HTTP + image model/pipeline integration)
- Audio flow: User configures parameters → clicks Generate → `POST /api/generate` → route delegates to audio service → service submits/polls/fetches through ACEStep repository → route returns `StreamingResponse` to browser → HTML5 `<audio>` plays it
- ACEStep communication: submit/poll pattern via `urllib` — `ACESTEP_API_URL` env var (default `http://localhost:8001`)
- Visual flow: `VisualScene` hosts R3F `<Canvas>` (orthographic camera, zoom 120) → renders image plane (or fallback SVG) + active visualizer + stacked effects; all driven by `audioCurrentTime` / `audioDuration` / `isPlaying` props for audio-reactive animation
- Some visualizers replace the default image plane entirely (rain, scene-rain, glitch)

## Modular Structure
- `src/App.tsx`: top-level UI — parameter controls, image upload (JPEG/PNG/WebP), audio player (play/pause/seek), error/loading states; passes audio timing props to `VisualScene`
- `src/components/visual-scene.tsx`: R3F Canvas host; split into `VisualScene` (DOM, state) + `SceneContent` (R3F context) to cross the Canvas boundary; hardcoded active visualizer/effects config (no UI switcher yet)
- `src/components/visualizers/`: factory pattern — `VisualizerFactory` dispatches by `VisualizerType`; types: `waveform`, `rain`, `scene-rain`, `starfield`, `aurora`, `circle-spectrum`, `glitch`, `smoke`, `contour`, `none`
- `src/components/effects/`: composer pattern — `EffectComposer` renders from `EffectType[]`; types: `zoom`, `flicker`, `vignette`, `filmGrain`, `chromaticAberration`, `scanLines`, `colorDrift`, `none`
- `src/lib/visual-scene.ts`: pure math — `computeContainScale`, `computeWaveformPhase`, `buildWaveformPositions`
- `src/api/constants.ts`: API endpoint constants (`/api/generate`)
- `backend/main.py`: backend composition root — creates FastAPI app, registers routers/handlers, and wires startup/shutdown lifecycle hooks
- `backend/routes/`: FastAPI route modules (`APIRouter`) that parse HTTP requests/responses and delegate work to services
- `backend/services/`: business/domain orchestration layer (audio queue flow and image processing rules) with no direct external transport calls
- `backend/repositories/`: external integration layer for ACEStep/image model I/O and adapter utilities used by services

## Implemented Capabilities
<!-- Updated at the end of each iteration by bun nvst create project-context -->
- ReelPod Studio branding; warm lofi theme
- Parameter controls
- Audio generation (ACEStep external REST API inference)
- Playback controls (HTML5 audio element — play, pause, seek)
- Error handling
- Image upload with validation (JPEG, PNG, WebP)
- R3F visual scene with orthographic camera
- 10 visualizers (waveform, rain, scene-rain, starfield, aurora, circle-spectrum, glitch, smoke, contour, none) — factory pattern
- 7 post-processing effects (zoom, flicker, vignette, filmGrain, chromaticAberration, scanLines, colorDrift) — composer pattern, stackable
- Audio-reactive animations (visualizers and effects driven by audio timing props)
- Fallback SVG visual when no image uploaded
