# Project Context

<!-- Created or updated by `bun nvst create project-context`. Cap: 250 lines. -->

## Conventions
- Naming: PascalCase for components, camelCase for variables/functions, kebab-case for files
- Formatting: Prettier + ESLint defaults
- Git flow: feature branches per iteration (`feature/it_XXXXXX`), merged to main after approval
- Workflow: Define → Prototype → Refactor per iteration; adhere to this file from iteration 2 onward

## Tech Stack
- Language: TypeScript
- Runtime: Browser (client-side only, no backend)
- Frameworks: React 19 + Vite, React Three Fiber (R3F)
- Key libraries: Strudel REPL (in-browser audio via Web Audio API)
- Package manager: bun
- Build / tooling: Vite

## Code Standards
- Style patterns: functional components, hooks for state and side effects
- Error handling: user-visible error messages for audio failures (autoplay policy, Web Audio support, REPL errors)
- Module organisation: `src/components/` for UI, `src/lib/` for pure logic (pattern generation, parameter mapping)
- Forbidden patterns: no backend calls, no custom audio pipeline (use Strudel REPL natively)

## Testing Strategy
- Approach: TDD — write tests before implementation
- Runner: Vitest
- Coverage targets: none enforced for MVP
- Test location convention: co-located `*.test.ts` / `*.test.tsx` next to source files

## Product Architecture
- Single-page browser app; no server required
- User configures parameters (mood, tempo, style) → clicks Generate → client-side logic maps params to a Strudel pattern string → Strudel REPL executes pattern in-browser via Web Audio API
- R3F used for visual/animation layer alongside audio playback

## Modular Structure
- `src/components/`: UI components (parameter controls, player, error/loading states)
- `src/lib/pattern-generator.ts`: pure function mapping UI params → Strudel pattern string
- `src/lib/strudel.ts`: Strudel REPL integration (init, play, pause, error handling)

## Implemented Capabilities
<!-- Updated at the end of each iteration by bun nvst create project-context -->
- (none yet — populated after first Refactor)
