# Requirement: Video Recording & Download

## Context
Content creators using ReelPod Studio need a way to capture the visual scene (R3F canvas) together with the generated audio and download the result as an MP4 file. Currently there is no export path — users must rely on third-party screen recorders. A native "Record" button closes this gap and keeps the workflow entirely inside the studio.

MP4 conversion is handled **client-side** using the `mediabunny` library (v1.39.2, formerly `mp4-muxer`). It uses the browser's WebCodecs API to encode H.264 + AAC directly in the browser — no backend involvement required.

## Goals
- Allow end users to record the animated canvas + audio in a single click.
- Deliver the recorded output as a downloadable MP4 file from the queue section.
- Keep the implementation fully client-side using `mediabunny`.

## User Stories

### US-001: Record button starts playback and captures canvas + audio
**As a** content creator, **I want** to click a "Record" button **so that** audio playback starts and the R3F canvas together with the audio are captured simultaneously into an MP4 file.

**Acceptance Criteria:**
- [ ] A "Record" button is visible in the studio UI (near the playback controls), enabled only when an audio URL is available.
- [ ] Clicking "Record" starts audio playback from the beginning.
- [ ] A `mediabunny` `Output` is created with `Mp4OutputFormat` and `BufferTarget`.
- [ ] The R3F canvas is captured via `canvas.captureStream(30)` and fed to `MediaStreamVideoTrackSource` with codec `avc` (H.264) at 4 Mbps.
- [ ] The audio element is captured via `AudioContext.createMediaElementSource` + `createMediaStreamDestination`, fed to `MediaStreamAudioTrackSource` with codec `aac` at 128 kbps.
- [ ] `output.start()` is called after both tracks are added; capture begins automatically.
- [ ] `canEncodeVideo({ codec: 'avc' })` and `canEncodeAudio({ codec: 'aac' })` are checked before starting; an error message is shown to the user if the browser does not support it.
- [ ] A visible recording indicator (e.g. red dot + "Recording…" label) is shown while capture is active.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-002: Recording stops automatically when playback ends
**As a** content creator, **I want** recording to stop automatically when the audio finishes **so that** the captured duration matches the song length without manual intervention.

**Acceptance Criteria:**
- [ ] When the `<audio>` element fires the `ended` event, `output.finalize()` is called automatically.
- [ ] If the user clicks a "Stop" button before playback ends, playback pauses and `output.finalize()` is called immediately.
- [ ] While `output.state === 'finalizing'` a loading/spinner indicator replaces the recording indicator.
- [ ] The "Record" button is disabled (replaced by "Stop") for the entire duration recording is active.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-003: Recorded video appears in queue as a downloadable MP4
**As a** content creator, **I want** the finished recording to appear in the queue section as an MP4 download entry **so that** I can save the video to my machine.

**Acceptance Criteria:**
- [ ] After `output.finalize()` resolves, `output.target.buffer` (an `ArrayBuffer`) is wrapped in a `Blob` with type `video/mp4`.
- [ ] A `URL.createObjectURL(blob)` URL is created and an entry is added to the queue section with filename `recording-<ISO-timestamp>.mp4`, file size in MB, and a "Download" button.
- [ ] Clicking "Download" triggers a browser file download (`<a download>` click pattern).
- [ ] Multiple recordings in the same session each produce a separate queue entry.
- [ ] Queue entries persist for the session (no page-reload required).
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

## Functional Requirements
- FR-1: Install `mediabunny` via `bun add mediabunny`. Requires browser WebCodecs API (Chrome 94+, Edge 94+).
- FR-2: The "Record" / "Stop" button is rendered in `src/App.tsx` or a dedicated `RecordButton` component, visible and enabled only when `audioUrl` is non-null.
- FR-3: Canvas reference: obtain the Three.js renderer canvas from the R3F `gl.domElement` via a forwarded ref or `useThree` inside `SceneContent`; expose it to `App.tsx` through a ref callback or context.
- FR-4: Audio capture: create one shared `AudioContext`; pipe the `<audio>` element through `createMediaElementSource` → `createMediaStreamDestination`; use the destination's `stream.getAudioTracks()[0]` as the `MediaStreamAudioTrackSource` input.
- FR-5: `mediabunny` output configuration: `new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })`. Use default `fastStart` (moov at end) to minimise memory overhead.
- FR-6: Frame rate for canvas capture: 30 fps (`canvas.captureStream(30)`); video bitrate 4 Mbps; audio bitrate 128 kbps.
- FR-7: Codec pre-flight: call `canEncodeVideo({ codec: 'avc', bitrate: 4e6 })` and `canEncodeAudio({ codec: 'aac', bitrate: 128e3 })` before starting; surface a user-visible error if either returns `false`.
- FR-8: Only one recording session may be active at a time.
- FR-9: The queue section (new `RecordingQueue` component or extension of any existing queue UI) renders each entry with: filename, size, and a download anchor element.

## Non-Goals (Out of Scope)
- Server-side recording or MP4 conversion via the backend.
- Streaming or uploading recordings to remote storage.
- Editing or trimming the recorded video.
- Custom resolution / bitrate controls in the UI.
- Recording across multiple songs in sequence.
- Persistent queue state across page reloads.
- Firefox / Safari support (WebCodecs not fully available; gracefully surface the codec pre-flight error).

## Open Questions
- None.
