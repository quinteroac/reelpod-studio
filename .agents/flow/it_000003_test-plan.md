# Test Plan - Iteration 000003

## Scope

- Backend: `POST /api/generate` endpoint behaviour (request validation, OpenAI integration, response shape, error handling).
- Backend: API key configuration (env loading, missing-key handling, `.env.example` and `.gitignore`).
- Frontend: Generate flow calling backend instead of local `generatePattern()`; loading and error states; passing returned pattern to Strudel.
- End-to-end: Parameter set → Generate → backend returns pattern → Strudel plays (automated where possible; one manual visual check for subjective playback feel).

## Environment and data

- Node/bun for frontend (Vitest); Python 3.x for backend tests (e.g. pytest with `httpx.ASGITransport` or `TestClient`).
- Backend tests may use mocked OpenAI client to avoid real API calls; integration tests may use a real OpenAI client with a test key or remain mocked.
- Frontend tests use mocked `fetch` (or MSW) to simulate backend success/error responses.
- Optional: `.env.test` or env vars in CI for backend integration tests if not fully mocked.
- Vite dev server and backend server runnable for local e2e/manual checks (e.g. root `dev` script or separate terminals).

---

## User Story: US-001 - Backend Generation Endpoint

| Test Case ID | Description | Type | Mode | Correlated Requirements | Expected Result |
|--------------|-------------|------|------|-------------------------|-----------------|
| TC-001-01 | Valid `POST /api/generate` with `{ mood, tempo, style }` returns 200 and `{ pattern: string }` when OpenAI returns a valid pattern | integration | automated | US-001, FR-1, FR-2, FR-3, FR-6 | 200, JSON body has `pattern` (non-empty string). |
| TC-001-02 | Request with missing `mood` returns 422 and `{ error: string }` | integration | automated | US-001-AC02, FR-11 | 422, body contains `error`. |
| TC-001-03 | Request with missing `tempo` or `style` returns 422 and `{ error: string }` | integration | automated | US-001-AC02, FR-11 | 422, body contains `error`. |
| TC-001-04 | Request with invalid types (e.g. `tempo` as string) returns 422 and `{ error: string }` | integration | automated | US-001-AC02, FR-11 | 422, body contains `error`. |
| TC-001-05 | Request with `tempo` outside valid range returns 422 and `{ error: string }` | integration | automated | US-001-AC02, FR-11 | 422, body contains `error`. |
| TC-001-06 | Handler uses `OPENAI_API_KEY` from server environment only (not from request body or headers) | unit/integration | automated | US-001-AC03, FR-9 | No key in request; OpenAI client called with env key (or test asserts env read at startup). |
| TC-001-07 | Prompt sent to OpenAI instructs “return only a valid Strudel pattern string” (no markdown/explanation) | unit | automated | US-001-AC04, FR-3, FR-4 | Assert prompt content contains the instruction; optional: assert model is `gpt-4o-mini`. |
| TC-001-08 | On success, response is 200 with `{ pattern: string }` and pattern passes backend validation | integration | automated | US-001-AC05, FR-6, FR-12 | 200, `pattern` is trimmed, non-empty, within length guard, not malformed. |
| TC-001-09 | When OpenAI returns empty/blank string, endpoint returns 500 with `{ error: string }` | integration | automated | US-001-AC07, FR-5, FR-12 | 500, body has `error` describing failure. |
| TC-001-10 | When OpenAI returns malformed output (e.g. markdown block), endpoint returns 500 with `{ error: string }` | integration | automated | US-001-AC06, US-001-AC07, FR-5, FR-12 | 500, body has `error`. |
| TC-001-11 | When OpenAI API throws (network/auth error), endpoint returns 500 with `{ error: string }` | integration | automated | US-001-AC07, FR-5, FR-6 | 500, body has `error`. |
| TC-001-12 | Backend code passes typecheck / lint | unit | automated | US-001-AC08 | No type or lint errors. |

---

## User Story: US-002 - Frontend Calls Backend Instead of Local Generator

| Test Case ID | Description | Type | Mode | Correlated Requirements | Expected Result |
|--------------|-------------|------|------|-------------------------|-----------------|
| TC-002-01 | Clicking Generate sends `POST /api/generate` with current `{ mood, tempo, style }` | unit/integration | automated | US-002-AC01, FR-7 | Assert `fetch` called with correct URL, method POST, and JSON body matching form state. |
| TC-002-02 | While request is in flight, “Generating track…” loading state is shown | unit | automated | US-002-AC02 | Assert loading UI is visible when request is pending (e.g. mock slow fetch). |
| TC-002-03 | On 200 response, returned `pattern` is passed to `strudelController.generate(pattern)` and no error UI | unit | automated | US-002-AC03, FR-7 | Mock fetch returns `{ pattern: "..." }`; assert `strudelController.generate` called with that string; no error message in DOM. |
| TC-002-04 | On network or backend error (4xx/5xx or network failure), error UI shows backend error message | unit | automated | US-002-AC04 | Mock fetch rejects or returns error body; assert error message from backend is displayed. |
| TC-002-05 | Main Generate flow does not call local `generatePattern()` from `pattern-generator.ts` | unit | automated | US-002-AC05 | Assert `generatePattern` is not imported/called in the generate flow (or only in tests/fallback). |
| TC-002-06 | Frontend code passes typecheck / lint | unit | automated | US-002-AC06 | No type or lint errors. |
| TC-002-07 | Full flow in browser: set params → Generate → audible playback; visual and aural check | e2e | manual | US-002-AC07 | User confirms params → Generate → loading → playback; automation not reliable for subjective “audible playback” and visual feel. |

---

## User Story: US-003 - Backend API Key Configuration

| Test Case ID | Description | Type | Mode | Correlated Requirements | Expected Result |
|--------------|-------------|------|------|-------------------------|-----------------|
| TC-003-01 | Backend reads `OPENAI_API_KEY` from process environment (e.g. via `.env` at startup) | unit/integration | automated | US-003-AC01, FR-9 | Assert env is read (e.g. from `os.environ` or loaded dotenv); optional: assert first request uses it. |
| TC-003-02 | `.env.example` exists and documents `OPENAI_API_KEY=` | unit | automated | US-003-AC02, FR-9 | File exists and contains `OPENAI_API_KEY`. |
| TC-003-03 | `.env` is listed in `.gitignore` (or already ignored) | unit | automated | US-003-AC03 | `.gitignore` contains `.env` or pattern that ignores it. |
| TC-003-04 | When `OPENAI_API_KEY` is missing at startup, server logs clear error and exits (or returns descriptive 500 on first request) | integration | automated | US-003-AC04 | Start server without key; assert exit with error message or first `POST /api/generate` returns 500 with descriptive `error`. |
| TC-003-05 | Backend code passes typecheck / lint | unit | automated | US-003-AC05 | No type or lint errors. |

---

## Cross-cutting / FR coverage

| Test Case ID | Description | Type | Mode | Correlated Requirements | Expected Result |
|--------------|-------------|------|------|-------------------------|-----------------|
| TC-FR-08 | Frontend and backend can be started together (e.g. root `dev` script or Procfile) | integration | automated | FR-8 | Script starts both processes (or Procfile lists both); optional: health/readiness check. |
| TC-FR-10 | Backend has `requirements.txt` or `pyproject.toml` with expected dependencies | unit | automated | FR-10 | File exists; contains at least `fastapi`, `uvicorn`, `openai`, `python-dotenv` (or equivalent). |

---

## Checklist

- [x] Read `it_000003_PRD.json`
- [x] Read `.agents/PROJECT_CONTEXT.md`
- [x] Plan includes **Scope** section with at least one bullet
- [x] Plan includes **Environment and data** section with at least one bullet
- [x] Test cases are grouped by user story
- [x] Every `FR-N` (FR-1–FR-12) is covered by automated test cases (see tables above and TC-FR-08, TC-FR-10)
- [x] Every test case includes correlated requirement IDs (`US-XXX`, `FR-X`)
- [x] Manual tests: only TC-002-07 (visual/aural e2e); justified because automation is not reliable for subjective audible playback and visual feel
- [x] File written to `.agents/flow/it_000003_test-plan.md`
