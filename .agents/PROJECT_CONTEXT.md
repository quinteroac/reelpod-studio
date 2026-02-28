# Project Context

<!-- Created or updated by `bun nvst create project-context`. Cap: 250 lines. -->

## Conventions
- Naming: PascalCase for components, camelCase for variables/functions, kebab-case for files
- Formatting: Prettier + ESLint defaults
- Git flow: feature branches per iteration (`feature/it_XXXXXX`), merged to main after approval
- Workflow: Define → Prototype → Refactor per iteration; adhere to this file from iteration 2 onward

## Tech Stack
- Language: TypeScript (frontend) + Python (backend)
- Runtime: Browser frontend (React/Vite) + Python backend (FastAPI + ACEStep)
- Frameworks: React 19 + Vite, React Three Fiber (R3F)
- Key libraries: ACEStep (`ace-step` Python package, local music generation model, in-process inference)
- Package manager: bun
- Build / tooling: Vite

## Code Standards
- Style patterns: functional components, hooks for state and side effects
- Error handling: user-visible error messages for audio failures (network errors, non-OK responses, inference errors)
- Module organisation: `src/components/` for UI, `src/lib/` for pure logic (parameter mapping, audio utilities)
- Forbidden patterns: no external API calls for audio generation (use ACEStep in-process); no Strudel REPL

## Testing Strategy
- Approach: TDD — write tests before implementation
- Runner: Vitest (frontend) + pytest (backend)
- Coverage targets: none enforced for MVP
- Test location convention: co-located `*.test.ts` / `*.test.tsx` next to frontend source; `backend/test_main.py` for backend

## Product Architecture
- Browser frontend (React/Vite) + Python backend (FastAPI, port 8000); Vite proxies `/api` to backend
- User configures parameters (mood, tempo, style) → clicks Generate → `POST /api/generate` (FastAPI + ACEStep) runs local inference and returns a WAV audio stream → HTML5 `<audio>` element plays it in-browser
- ACEStep model loaded once at FastAPI startup; prompt template: `"{mood} lofi {style}, {tempo} BPM"`; inference defaults: `lyrics=""`, `audio_duration=30`, `infer_step=20`
- R3F used for visual/animation layer alongside audio playback

## Modular Structure
- `src/App.tsx`: all UI (parameter controls, player, error/loading states); `src/components/` reserved for future extraction
- `src/api/constants.ts`: API endpoint constants (`/api/generate`)
- `backend/main.py`: FastAPI app; ACEStep model instantiation at startup; `POST /api/generate` handler; returns `StreamingResponse` with `media_type="audio/wav"`

## Implemented Capabilities
<!-- Updated at the end of each iteration by bun nvst create project-context -->
- Lofi theme
- Parameter controls
- Audio generation (ACEStep local inference)
- Playback controls (HTML5 audio element — play, pause, seek)
- Error handling
