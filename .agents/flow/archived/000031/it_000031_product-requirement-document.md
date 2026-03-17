# Requirement: Record Queue & Delete Queue Items

## Context
Users can already record a single playing video via the Record/Stop button. However, there is no way to record the entire queue as one continuous session — each item must be recorded manually. Additionally, once a queue entry is generated there is no way to remove it, causing the queue to grow unboundedly. This iteration adds a "Record Queue" button that records all completed queue entries played back-to-back into a single file, and adds per-entry delete buttons.

## Goals
- Allow users to record the full queue playback (all completed entries, sequentially) into a single downloadable MP4.
- Allow users to delete individual entries from the generation queue.

## User Stories

### US-001: Record Queue starts recording and plays completed entries sequentially
**As an** end user, **I want** to click "Record Queue" **so that** all completed queue entries play back-to-back in the canvas while a single recording session captures them all.

**Acceptance Criteria:**
- [ ] A "Record Queue" button is visible in the Queue tab header area.
- [ ] The button is enabled only when at least one queue entry has `status === 'completed'` and `videoBlob !== null`.
- [ ] Clicking "Record Queue" calls `startRecording()` (reusing `use-recorder.ts`) and immediately begins playing the first completed entry from the top of the queue.
- [ ] After each entry ends, the next completed entry (in queue order) starts playing automatically — same chaining behaviour as the existing `playNextEntryRef`.
- [ ] While queue-recording is active, the "Record Queue" button is replaced by (or changes to) a "Stop Recording" button with a red indicator, matching the visual style of the existing record button.
- [ ] While queue-recording is active, the existing single-item Record button is disabled.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-002: Queue recording stops automatically when the last entry finishes
**As an** end user, **I want** the recording to finalise automatically when the last queue entry finishes playing **so that** I don't have to intervene after the queue completes.

**Acceptance Criteria:**
- [ ] When the `onEnded` callback fires for the last completed entry while queue-recording is active, `stopRecording()` is called automatically.
- [ ] The resulting file is added to the Recordings list (same `onFinalized` callback as the existing recorder).
- [ ] The "Stop Recording" button reverts to "Record Queue" after finalization.
- [ ] Typecheck / lint passes.

### US-003: User can manually stop the queue recording early
**As an** end user, **I want** to click "Stop Recording" at any time **so that** the recording is finalized up to that point and saved as a downloadable file.

**Acceptance Criteria:**
- [ ] Clicking "Stop Recording" while queue-recording is active pauses playback and calls `stopRecording()`.
- [ ] The resulting partial file is added to the Recordings list.
- [ ] The "Stop Recording" button reverts to "Record Queue".
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-004: User can delete individual queue entries
**As an** end user, **I want** to click a delete button on a queue entry **so that** it is removed from the queue without a page reload.

**Acceptance Criteria:**
- [ ] Each queue entry row displays a delete (×) button.
- [ ] Clicking the delete button removes that entry from `queueEntries` state immediately (no confirmation dialog needed).
- [ ] Deleting the currently playing entry pauses playback and clears `playingEntryId`.
- [ ] Deleting an entry while queue-recording is active stops the recording before removing the entry (to avoid a broken recording session).
- [ ] The delete button is accessible: has `aria-label="Delete entry {trackNumber}"`.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

## Functional Requirements
- FR-1: Add `isRecordingQueue` boolean state to `App`. When `true`, the "Record Queue" CTA is replaced by a "Stop Recording" button styled with a red indicator (matching `record-button.tsx` conventions). When `false`, "Record Queue" is shown.
- FR-2: Add `handleRecordQueue(): Promise<void>` in `App` that: (a) calls `startRecording()`, (b) finds the first completed entry with a `videoBlob`, (c) calls `playVideoFromUrl` with an `onEnded` that advances to the next completed entry or, if none remains, calls `stopRecording()`.
- FR-3: Add `handleStopQueueRecording(): Promise<void>` in `App` that pauses the video, calls `stopRecording()`, and sets `isRecordingQueue` to `false`.
- FR-4: The queue-recording advance logic must reuse the same `playVideoFromUrl` + `createVideoPlaybackUrl` helpers already present in `App`. Do NOT duplicate playback wiring.
- FR-5: Add `handleDeleteQueueEntry(entryId: number): void` in `App` that: (a) if `isRecordingQueue` is true, calls `handleStopQueueRecording()` first; (b) if the deleted entry is `playingEntryId`, pauses the video and clears `playingEntryId`; (c) calls `setQueueEntries(prev => prev.filter(e => e.id !== entryId))`.
- FR-6: The delete button is rendered inside each queue entry `<li>` in the existing queue map. It must not appear for entries with `status === 'generating'` while the queue is generating (to avoid race conditions), but may appear for `queued`, `completed`, and `failed` entries. *(Open: confirm whether deleting a `queued` entry before generation starts is in scope — default yes.)*
- FR-7: The "Record Queue" button must be disabled (and visually greyed) when no completed entries exist or when `isFinalizing` is true.

## Non-Goals (Out of Scope)
- No separate MP4 per queue entry — only one combined recording per queue-record session.
- No reordering of queue entries (drag-and-drop).
- No "clear all" bulk delete.
- No change to the single-item Record/Stop button behaviour.
- No backend changes.

## Open Questions
- None
