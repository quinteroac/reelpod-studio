# Test Execution Report

**Iteration:** it_000003
**Test Plan:** `it_000003_TP.json`
**Total:** 26
**Passed:** 21
**Failed:** 5

| Test ID | Description | Status | Correlated Requirements | Artifacts |
|---------|-------------|--------|------------------------|-----------|
| TC-001-01 | Valid `POST /api/generate` with `{ mood, tempo, style }` returns 200 and `{ pattern: string }` when OpenAI returns a valid pattern | passed | US-001, FR-1, FR-2, FR-3, FR-6 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-01_attempt_001.json` |
| TC-001-02 | Request with missing `mood` returns 422 and `{ error: string }` | passed | FR-11 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-02_attempt_001.json` |
| TC-001-03 | Request with missing `tempo` or `style` returns 422 and `{ error: string }` | passed | FR-11 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-03_attempt_001.json` |
| TC-001-04 | Request with invalid types (e.g. `tempo` as string) returns 422 and `{ error: string }` | passed | FR-11 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-04_attempt_001.json` |
| TC-001-05 | Request with `tempo` outside valid range returns 422 and `{ error: string }` | passed | FR-11 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-05_attempt_001.json` |
| TC-001-06 | Handler uses `OPENAI_API_KEY` from server environment only (not from request body or headers) | passed | FR-9 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-06_attempt_001.json` |
| TC-001-07 | Prompt sent to OpenAI instructs “return only a valid Strudel pattern string” (no markdown/explanation) | passed | FR-3, FR-4 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-07_attempt_001.json` |
| TC-001-08 | On success, response is 200 with `{ pattern: string }` and pattern passes backend validation | passed | FR-6, FR-12 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-08_attempt_001.json` |
| TC-001-09 | When OpenAI returns empty/blank string, endpoint returns 500 with `{ error: string }` | passed | FR-5, FR-12 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-09_attempt_001.json` |
| TC-001-10 | When OpenAI returns malformed output (e.g. markdown block), endpoint returns 500 with `{ error: string }` | passed | FR-5, FR-12 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-10_attempt_001.json` |
| TC-001-11 | When OpenAI API throws (network/auth error), endpoint returns 500 with `{ error: string }` | passed | FR-5, FR-6 | `.agents/flow/it_000003_test-execution-artifacts/TC-001-11_attempt_001.json` |
| TC-001-12 | Backend code passes typecheck / lint | skipped |  | `.agents/flow/it_000003_test-execution-artifacts/TC-001-12_attempt_001.json` |
| TC-002-01 | Clicking Generate sends `POST /api/generate` with current `{ mood, tempo, style }` | passed | FR-7 | `.agents/flow/it_000003_test-execution-artifacts/TC-002-01_attempt_001.json` |
| TC-002-02 | While request is in flight, “Generating track…” loading state is shown | passed |  | `.agents/flow/it_000003_test-execution-artifacts/TC-002-02_attempt_001.json` |
| TC-002-03 | On 200 response, returned `pattern` is passed to `strudelController.generate(pattern)` and no error UI | passed | FR-7 | `.agents/flow/it_000003_test-execution-artifacts/TC-002-03_attempt_001.json` |
| TC-002-04 | On network or backend error (4xx/5xx or network failure), error UI shows backend error message | passed |  | `.agents/flow/it_000003_test-execution-artifacts/TC-002-04_attempt_001.json` |
| TC-002-05 | Main Generate flow does not call local `generatePattern()` from `pattern-generator.ts` | passed |  | `.agents/flow/it_000003_test-execution-artifacts/TC-002-05_attempt_001.json` |
| TC-002-06 | Frontend code passes typecheck / lint | skipped |  | `.agents/flow/it_000003_test-execution-artifacts/TC-002-06_attempt_001.json` |
| TC-003-01 | Backend reads `OPENAI_API_KEY` from process environment (e.g. via `.env` at startup) | passed | FR-9 | `.agents/flow/it_000003_test-execution-artifacts/TC-003-01_attempt_001.json` |
| TC-003-02 | `.env.example` exists and documents `OPENAI_API_KEY=` | passed | FR-9 | `.agents/flow/it_000003_test-execution-artifacts/TC-003-02_attempt_001.json` |
| TC-003-03 | `.env` is listed in `.gitignore` (or already ignored) | passed |  | `.agents/flow/it_000003_test-execution-artifacts/TC-003-03_attempt_001.json` |
| TC-003-04 | When `OPENAI_API_KEY` is missing at startup, server logs clear error and exits (or returns descriptive 500 on first request) | passed |  | `.agents/flow/it_000003_test-execution-artifacts/TC-003-04_attempt_001.json` |
| TC-003-05 | Backend code passes typecheck / lint | skipped |  | `.agents/flow/it_000003_test-execution-artifacts/TC-003-05_attempt_001.json` |
| TC-FR-08 | Frontend and backend can be started together (e.g. root `dev` script or Procfile) | passed | FR-8 | `.agents/flow/it_000003_test-execution-artifacts/TC-FR-08_attempt_001.json` |
| TC-FR-10 | Backend has `requirements.txt` or `pyproject.toml` with expected dependencies | failed | FR-10 | `.agents/flow/it_000003_test-execution-artifacts/TC-FR-10_attempt_001.json` |
| TC-002-07 | Full flow in browser: set params → Generate → audible playback; visual and aural check | failed |  | `.agents/flow/it_000003_test-execution-artifacts/TC-002-07_attempt_001.json` |

