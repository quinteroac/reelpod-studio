# Audit — Iteration 000035

## Executive Summary

Iteration 000035 is fully implemented across backend, frontend, and MCP layers. All five user stories and all eight functional requirements are satisfied. The LLM generates YouTube-optimised title and description during orchestration; model credits are loaded from a YAML file and appended to the description; queue entries carry the metadata to the frontend; a preview/edit modal allows the user to review and correct the content before publishing; and the `publish_to_youtube` MCP tool correctly defaults to the LLM-generated metadata with explicit-argument override and filename fallback. Test coverage (backend unit tests, frontend component tests, and MCP server tests) is comprehensive. No critical gaps were detected.

---

## Verification by FR

| FR | Description | Assessment |
|----|-------------|-----------|
| FR-1 | `OrchestrationResult` includes `youtube_title` and `youtube_description` (Pydantic-validated, length-constrained, format-validated) | comply |
| FR-2 | `backend/config/model_credits.yaml` exists with model roles, names, and footer | comply |
| FR-3 | `build_credits_block()` reads YAML, returns formatted plain-text; handles missing/malformed YAML with warning | comply |
| FR-4 | Backend returns `youtube_title` and `youtube_description` to frontend as HTTP response headers (`X-Youtube-Title`, `X-Youtube-Description`) | comply |
| FR-5 | `QueueEntry` stores `youtubeTitle` and `youtubeDescription` (nullable) for each completed entry | comply |
| FR-6 | Preview/edit modal lets user review and optionally modify title and description before YouTube publish | comply |
| FR-7 | `uploadVideoToYouTube` sends final (possibly user-edited) `snippet.description` including model credits block | comply |
| FR-8 | `publish_to_youtube` MCP tool defaults to queue-entry metadata when no arguments are provided | comply |

---

## Verification by US

| US | Title | Assessment |
|----|-------|-----------|
| US-001 | LLM generates a YouTube title and description during orchestration | comply |
| US-002 | Backend exposes a model-credits YAML and appends it to the description | comply |
| US-003 | Queue entries carry YouTube metadata to the frontend | comply |
| US-004 | Preview/edit dialog before YouTube publish | comply |
| US-005 | `publish_to_youtube` MCP tool uses the generated metadata | comply |

---

## Minor Observations

1. **FR-2 footer gap:** `model_credits.yaml` has no explicit `footer:` key — the footer text is composed programmatically by `build_credits_block()`. The spirit of FR-2 is satisfied, but a dedicated YAML key would match the spec more precisely and allow the sign-off line to be customised without touching Python code.
2. **Truncated PRD ACs:** US-001-AC01 and US-001-AC02 strings are cut off mid-sentence in the PRD JSON. Future audits may misread these criteria.
3. **US-004-AC05 — no automated browser test:** Visual verification of the dialog is manual only. No Playwright/Cypress smoke test exists for the modal open/pre-fill/publish flow.
4. **Accessibility — no focus trap in dialog:** The `YouTubePublishDialog` component lacks focus trapping. Keyboard users can tab outside the modal while it is open, violating WCAG 2.1 SC 2.1.2.
5. **UX — no character counter on description textarea:** The backend enforces a 5000-char max on `youtube_description`, but the dialog textarea gives no feedback until the upload fails.

---

## Conclusions and Recommendations

The iteration is production-ready. The following non-blocking improvements are recommended:

1. **Add focus-trap to `YouTubePublishDialog`** — use a lightweight focus-trap utility or native `<dialog>` element to keep keyboard focus inside the modal (WCAG 2.1 compliance).
2. **Add a character counter to the description textarea** — show remaining characters against the 5000-char limit directly in the dialog.
3. **Add a Playwright end-to-end test** — cover the dialog open → pre-fill → edit → publish flow to satisfy US-004-AC05 with an automated check.
4. **Add `footer:` key to `model_credits.yaml`** — allow the static sign-off line to be configured in YAML without touching Python code, aligning the file structure with FR-2's wording.
5. **Fix truncated AC texts in the PRD JSON** — restore complete text for US-001-AC01 and US-001-AC02.

---

## Refactor Plan

### 1 — Focus trap in `YouTubePublishDialog`

- **File:** `src/components/youtube-publish-dialog.tsx`
- **Approach:** Use the native HTML `<dialog>` element (which provides focus trap and `Escape` key handling natively) or add a `useEffect` that queries all focusable elements inside the modal and intercepts `Tab`/`Shift+Tab` to cycle within them.
- **Acceptance:** Opening the dialog with keyboard navigation keeps focus inside; `Escape` or Cancel closes it.

### 2 — Character counter on description textarea

- **File:** `src/components/youtube-publish-dialog.tsx`
- **Approach:** Track `description.length` in local state and render `{description.length} / 5000` below the textarea. Apply a warning colour (e.g., amber) above 4500 chars and an error colour above 5000 with the Publish button disabled.
- **Acceptance:** Counter updates on every keystroke; Publish is blocked when description exceeds 5000 chars.

### 3 — Playwright e2e test for publish dialog

- **File:** `e2e/youtube-publish-dialog.spec.ts` (new)
- **Approach:** Launch the app in test mode with a mock queue entry that has `youtubeTitle` and `youtubeDescription`. Click "Publish to YouTube", assert the dialog opens with pre-filled values, edit the title, assert the Publish button becomes enabled/disabled appropriately, and assert `onPublish` is called with the edited values.
- **Acceptance:** Test passes in CI.

### 4 — `footer:` key in `model_credits.yaml`

- **File:** `backend/config/model_credits.yaml`
- **Approach:** Add a top-level `footer: "Generated with ReelPod Studio"` (or similar) key. Update `_format_credits()` in `credits_service.py` to append the footer line when present.
- **Acceptance:** Existing unit tests still pass; new test asserts footer line appears in output.

### 5 — Fix truncated AC texts in PRD JSON

- **File:** `.agents/flow/it_000035_PRD.json`
- **Approach:** Restore full text for US-001-AC01 (`"OrchestrationResult gains two new fields: youtube_title (max 100 chars) and youtube_description (max 5000 chars)."`) and US-001-AC02 (`"The CREATIVE_DIRECTOR_SYSTEM_PROMPT is updated to instruct the LLM to return these fields in its JSON output."`).
- **Acceptance:** Both strings are complete sentences.
