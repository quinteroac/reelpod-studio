# ReelPod Studio

Create music and visuals for streaming and video platforms.

ReelPod Studio is a creator-focused tool that generates lo-fi music and AI-powered visuals for content. Built for two modalities: **long-form videos** (multi-song compilations, 24/7 streams) and **live streaming**.

## Features

- **AI music generation** — Lo-fi beats via ACEStep (mood, style, tempo)
- **AI image generation** — Custom visual backgrounds from text prompts (Anima model)
- **Audio-reactive visualizers** — Waveform, rain, starfield, aurora, glitch, smoke, and more
- **Post-processing effects** — Vignette, film grain, chromatic aberration, scan lines, zoom, flicker
- **Playback controls** — Play, pause, seek, generate on demand

## Tech Stack

- **Frontend:** React 19, Vite, React Three Fiber (R3F), TypeScript
- **Backend:** FastAPI (Python), ACEStep (music), Anima/diffusers (images)
- **Package manager:** bun

## Getting Started

### Prerequisites

- [bun](https://bun.sh/)
- [uv](https://github.com/astral-sh/uv) (Python)
- ACEStep service (port 8001) for music generation

### Run development

```bash
bun install
bun run dev
```

Starts the frontend (Vite), backend (FastAPI on port 8000), and ACEStep. Ensure `backend/.env` is configured.

### Other commands

```bash
bun run dev:frontend   # Vite only
bun run dev:backend    # FastAPI only
bun run build          # Production build
bun run test           # Run tests
```

## Project Structure

- `src/` — React frontend, components, visualizers, effects
- `backend/` — FastAPI app, `/api/generate` (audio), `/api/generate-image` (images)
- `start-acestep.sh` — Launches ACEStep music model service

## License

Private project.
