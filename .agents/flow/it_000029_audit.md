# Audit — it_000029

## Executive Summary

All three user stories (US-001, US-002, US-003) and all nine functional requirements (FR-1 through FR-9) of iteration 000029 are implemented and verified. The recording feature is complete: a Record/Stop button in App.tsx captures the R3F canvas and video-element audio via mediabunny, with full codec pre-flight checks, a live recording indicator, a finalizing spinner, and a session-persistent queue of downloadable MP4 entries. One minor deviation was identified in FR-7 (codec pre-flight called without bitrate argument) and has been resolved.

## Verification by FR

| FR | Assessment | Notes |
|----|------------|-------|
| FR-1 | comply | `mediabunny` v1.39.2 installed in package.json |
| FR-2 | comply | Record/Stop buttons in App.tsx; disabled when `!activeVideoUrl \|\| isFinalizing` |
| FR-3 | comply | Canvas from `gl.domElement` via `visual-scene.tsx` onCreated → `handleCanvasCreated` callback → `canvasRef` |
| FR-4 | comply | Single `AudioContext`; `createMediaElementSource` → `createMediaStreamDestination`; audio routed to both speakers and capture stream |
| FR-5 | comply | `new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })` |
| FR-6 | comply | `canvas.captureStream(30)` at 30 fps; 4 Mbps video bitrate; 128 kbps audio bitrate |
| FR-7 | comply (after fix) | Pre-flight now calls `canEncodeVideo({ codec: 'avc', bitrate: 4e6 })` and `canEncodeAudio({ codec: 'aac', bitrate: 128e3 })`; user-visible error shown on failure |
| FR-8 | comply | Record button replaced by Stop while recording; `startRecording` cancels any lingering output before starting |
| FR-9 | comply | Queue renders filename, size (MB), and `<a download>` anchor per entry |

## Verification by US

| US | Assessment | Notes |
|----|------------|-------|
| US-001 | comply | Record button visible/enabled when `activeVideoUrl` set; starts playback from seek 0; mediabunny Output with correct codecs/bitrates; `output.start()` after both tracks; codec pre-flight with error; red pulsing dot + "Recording…" label |
| US-002 | comply | `video.onended` auto-calls `stopRecording()`; Stop button pauses and finalizes; spinner replaces dot while `isFinalizing`; Record button hidden during recording |
| US-003 | comply | `ArrayBuffer` → `Blob({ type: 'video/mp4' })` → `URL.createObjectURL`; entry with `recording-<ISO>.mp4` filename, MB size, and download anchor; multiple recordings produce separate entries; entries persist for session |

## Minor Observations

- The PRD describes an `<audio>` element as the playback source, but the implementation uses a `<video>` element. This is a valid adaptation; the app's media files carry both video and audio tracks, making it functionally equivalent for capture purposes.
- The Record button is also disabled during `isFinalizing`, beyond the PRD requirement of disabling only when no audio URL. This is a sensible additional guard.
- Object URLs created for queue entries are not revoked (`URL.revokeObjectURL`) during the session. Acceptable for a session-scoped feature, but Blob memory is held for the entire page lifetime.

## Conclusions and Recommendations

The iteration is fully compliant after the FR-7 fix. The codec pre-flight now validates both codec identity and target bitrate support before starting a recording session. No further blocking issues remain. The URL revocation omission is noted as a non-blocking improvement for a future iteration.

## Refactor Plan

### Applied fix (this iteration)
- **File:** `src/hooks/use-recorder.ts`, codec pre-flight block (~line 63-66)
- **Change:** Updated `canEncodeVideo('avc')` → `canEncodeVideo({ codec: 'avc', bitrate: 4e6 })` and `canEncodeAudio('aac')` → `canEncodeAudio({ codec: 'aac', bitrate: 128e3 })` to match FR-7 specification and verify bitrate-specific encoding support.

### Deferred (future iteration)
- Add `URL.revokeObjectURL(rec.url)` when a recording entry is removed from the queue to release Blob memory.
