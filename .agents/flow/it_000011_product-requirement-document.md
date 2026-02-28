# Requirement: Queue Generations

## Context
Currently, ReelPod Studio only supports generating one audio track at a time. The user must wait for a generation to complete before starting another. This blocks creative flow — creators often want to batch several ideas (different genres, prompts, parameters) and review the results later. A queue system lets users stack up multiple generation requests and have them processed sequentially in the background.

## Goals
- Allow users to submit multiple generation requests without waiting for each to finish
- Provide clear visibility into the status of every queued generation
- Let users play back any completed generation directly from the queue

## User Stories

### US-001: Add generation to queue
**As a** creator, **I want** to submit a generation request that gets added to a queue **so that** I can keep configuring and submitting more requests without waiting.

**Acceptance Criteria:**
- [ ] A "Add to Queue" button (or equivalent) is available alongside or replacing the current "Generate" button
- [ ] Clicking it captures the current parameter values and adds an entry to the queue
- [ ] The user receives visual confirmation that the request was queued (e.g. item appears in the queue list)
- [ ] The user can immediately change parameters and queue another generation
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

### US-002: Display queue list with status
**As a** creator, **I want** to see a list of all my queued, in-progress, and completed generations **so that** I know what's happening at a glance.

**Acceptance Criteria:**
- [ ] A queue panel/section is visible in the UI showing all generation entries
- [ ] Each entry displays: a label or summary of its parameters, and its current status (queued / generating / completed / failed)
- [ ] The currently-processing item is visually distinct (e.g. spinner or progress indicator)
- [ ] Completed items are visually distinct (e.g. checkmark or different color)
- [ ] Failed items show an error indicator
- [ ] The list updates in real time as status changes (no manual refresh needed)
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

### US-003: Sequential backend queue processing
**As a** creator, **I want** the backend to process my queued generations one at a time **so that** ACEStep is not overloaded and each generation completes reliably.

**Acceptance Criteria:**
- [ ] Backend accepts generation requests and stores them in a queue (in-memory is acceptable for MVP)
- [ ] Backend processes one generation at a time via the existing ACEStep submit/poll flow
- [ ] When a generation completes (success or failure), the next queued item starts automatically
- [ ] Each queue item's status is queryable by the frontend (e.g. via a polling or SSE endpoint)
- [ ] Typecheck / lint passes

### US-004: Play back completed generation from queue
**As a** creator, **I want** to click on a completed generation in the queue and hear it **so that** I can compare results and pick my favorite.

**Acceptance Criteria:**
- [ ] Completed queue entries have a play button or are clickable
- [ ] Clicking a completed entry loads its audio into the existing player and begins playback
- [ ] The visual scene responds to the selected track's audio (existing audio-reactive behavior)
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

## Functional Requirements
- FR-1: Frontend maintains a local queue state (array of generation entries with id, parameters, status, and audio URL when completed)
- FR-2: Backend exposes an endpoint to submit a generation to the queue (e.g. `POST /api/queue`)
- FR-3: Backend exposes an endpoint to retrieve queue status (e.g. `GET /api/queue`)
- FR-4: Backend processes queue items sequentially — only one ACEStep generation runs at a time
- FR-5: Backend stores completed audio files and serves them via URL so the frontend can play any completed track
- FR-6: Frontend polls the queue status endpoint at a reasonable interval (e.g. every 2–3 seconds) to update the UI
- FR-7: Queue entries persist in memory for the lifetime of the backend process (no database required for MVP)

## Non-Goals (Out of Scope)
- Persistent queue storage across backend restarts (database/file persistence)
- Reordering or prioritizing queue items
- Cancelling or removing items from the queue
- Concurrent/parallel generation (ACEStep processes one at a time)
- Queue size limits or rate limiting
- User authentication or multi-user queue isolation

## Open Questions
- None at this time
