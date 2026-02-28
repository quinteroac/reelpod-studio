# Project Context

<!-- Created or updated by `bun nvst create project-context`. Cap: 250 lines. -->

## Conventions
- Naming: PascalCase for components, camelCase for variables/functions, kebab-case for files
- Formatting: Prettier + ESLint defaults
- Git flow: feature branches per iteration (`feature/it_XXXXXX`), merged to main after approval
- Workflow: Define → Prototype → Refactor per iteration; adhere to this file from iteration 2 onward

## Tech Stack
- Language: TypeScript
- Runtime: Browser frontend (React/Vite) + Python backend (FastAPI + OpenAI)
- Frameworks: React 19 + Vite, React Three Fiber (R3F)
- Key libraries: Strudel REPL (in-browser audio via Web Audio API)
- Package manager: bun
- Build / tooling: Vite

## Code Standards
- Style patterns: functional components, hooks for state and side effects
- Error handling: user-visible error messages for audio failures (autoplay policy, Web Audio support, REPL errors)
- Module organisation: `src/components/` for UI, `src/lib/` for pure logic (pattern generation, parameter mapping)
- Forbidden patterns: no custom audio pipeline (use Strudel REPL natively)

## Testing Strategy
- Approach: TDD — write tests before implementation
- Runner: Vitest
- Coverage targets: none enforced for MVP
- Test location convention: co-located `*.test.ts` / `*.test.tsx` next to source files

## Product Architecture
- Browser frontend (React/Vite) + Python backend (FastAPI, port 8000); Vite proxies `/api` to backend
- User configures parameters (mood, tempo, style) → clicks Generate → `POST /api/generate` (FastAPI + OpenAI) returns a Strudel pattern string → Strudel REPL executes pattern in-browser via Web Audio API
- R3F used for visual/animation layer alongside audio playback

## Modular Structure
- `src/App.tsx`: all UI (parameter controls, player, error/loading states); `src/components/` reserved for future extraction
- `src/lib/pattern-generator.ts`: pure function mapping UI params → Strudel pattern string
- `src/lib/strudel.ts`: controller interface, error types, and user-facing error mapping
- `src/lib/strudel-adapter.ts`: browser-specific Strudel controller (`createBrowserStrudelController`)
- `src/lib/strudel-repl.ts`: low-level Strudel REPL wrapper (`bootstrapStrudelRepl`, `StrudelWebReplEngine`)
- `src/api/constants.ts`: API endpoint constants (`/api/generate`)

## Implemented Capabilities
<!-- Updated at the end of each iteration by bun nvst create project-context -->
- Lofi theme
- Parameter controls
- Audio generation
- Playback controls
- Error handling
