# Requirement: OpenAI-Powered Pattern Generation via Backend

## Context
The current lofi generator uses a deterministic client-side function (`pattern-generator.ts`) to map mood/tempo/style to a fixed Strudel pattern. This limits the variety and expressiveness of the output. By routing generation through an OpenAI-backed backend, the app can produce richer, more varied patterns while keeping the API key secure server-side and never exposed to the browser.

## Goals
- Replace the deterministic pattern generator with an AI-generated Strudel pattern produced by the OpenAI API.
- Introduce a minimal backend server that holds the API key and proxies generation requests.
- Keep the end-user experience identical: set parameters → click Generate → audio plays.

## User Stories

### US-001: Backend Generation Endpoint
**As a** backend service, **I want** to expose a `POST /api/generate` endpoint that accepts mood, tempo, and style, **so that** the frontend can request an AI-generated Strudel pattern without handling the OpenAI API key.

**Acceptance Criteria:**
- [ ] `POST /api/generate` accepts a JSON body `{ mood: string, tempo: number, style: string }`.
- [ ] Invalid request payloads (missing fields, wrong types, or invalid tempo range) are rejected with `4xx` (e.g. `422`) and `{ error: string }`.
- [ ] The handler reads `OPENAI_API_KEY` from the server environment (never from the request).
- [ ] The handler sends a prompt to the OpenAI Chat Completions API instructing it to return a valid Strudel pattern string only (no markdown, no explanation).
- [ ] On success, the endpoint returns `200` with `{ pattern: string }`.
- [ ] Before returning success, the backend validates the returned pattern (trimmed non-empty string, length guard, and malformed-output rejection).
- [ ] On OpenAI error, invalid OpenAI response, or failed pattern validation, the endpoint returns `500` with `{ error: string }` describing the failure.
- [ ] Typecheck / lint passes.

### US-002: Frontend Calls Backend Instead of Local Generator
**As an** end user, **I want** the Generate button to call the backend endpoint, **so that** the AI-generated pattern is fetched and played by Strudel automatically.

**Acceptance Criteria:**
- [ ] Clicking Generate sends a `POST /api/generate` request with the current `{ mood, tempo, style }` values.
- [ ] While the request is in flight, the existing "Generating track…" loading state is shown.
- [ ] On a successful response, the returned `pattern` string is passed to `strudelController.generate(pattern)` and no error state is rendered.
- [ ] On a network or backend error, the existing error UI is shown with the error message returned by the backend.
- [ ] The local `generatePattern()` function from `pattern-generator.ts` is no longer called in the main flow.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: full end-to-end flow (set params → Generate → audible playback).

### US-003: Backend API Key Configuration
**As a** developer running the app locally, **I want** to set the OpenAI API key via an environment variable, **so that** the key is never committed or exposed to the browser.

**Acceptance Criteria:**
- [ ] The backend reads `OPENAI_API_KEY` from the process environment (e.g. via a `.env` file loaded at startup).
- [ ] A `.env.example` file documents the required variable (`OPENAI_API_KEY=`).
- [ ] `.env` is listed in `.gitignore` (or already ignored).
- [ ] If `OPENAI_API_KEY` is missing at startup, the server logs a clear error and exits (or returns a descriptive `500` on the first request).
- [ ] Typecheck / lint passes.

## Functional Requirements
- FR-1: A Python backend server is added under `backend/` in the repo.
- FR-2: The backend exposes exactly one endpoint: `POST /api/generate`.
- FR-3: The endpoint builds a system + user prompt from the incoming parameters and calls the OpenAI Chat Completions API (model: `gpt-4o-mini` by default).
- FR-4: The prompt instructs OpenAI to return only a valid Strudel pattern string with no surrounding text, markdown, or explanation.
- FR-5: If OpenAI returns an empty, blank, or otherwise invalid pattern string, the backend returns `500` with `{ "error": string }` describing the failure.
- FR-6: The backend returns `{ "pattern": string }` on success or `{ "error": string }` on failure.
- FR-7: The frontend replaces the `generatePattern()` call with a `fetch` to `POST /api/generate`.
- FR-8: Both frontend (Vite dev server) and backend (Python) can be started together in development (e.g. via a root-level `dev` script or a `Procfile`).
- FR-9: `OPENAI_API_KEY` is read from the server environment; `.env.example` documents it; `.env` is git-ignored.
- FR-10: The backend includes a `requirements.txt` (or `pyproject.toml`) listing its dependencies (e.g. `fastapi`, `uvicorn`, `openai`, `python-dotenv`).
- FR-11: The endpoint validates request payload shape and value constraints; malformed client input returns `4xx` (e.g. `422`) and does not call OpenAI.
- FR-12: The backend applies minimum output validation before returning success (trimmed non-empty string, reasonable max length, malformed-output rejection).

## Non-Goals (Out of Scope)
- Client-side API key input — the key lives only on the server.
- Model selection UI — the model is hardcoded server-side (`gpt-4o-mini`).
- Caching, rate limiting, or request queuing.
- User authentication or per-user quotas.
- Keeping the local deterministic `pattern-generator.ts` as a fallback toggle.
- Deployment / hosting configuration.
- Persisting generation request/response history or storing generated patterns.

## Open Questions
_All open questions resolved:_
- **Empty pattern validation:** Yes — backend returns `500` with a descriptive error if OpenAI returns an empty, blank, or invalid string.
- **Backend language/framework:** Python (FastAPI + Uvicorn), chosen to also support local video generation in future iterations.
