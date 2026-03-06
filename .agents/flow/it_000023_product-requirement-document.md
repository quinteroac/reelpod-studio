# Requirement: Wan 2.2 Animated Video Generation

## Context
Currently the video pipeline generates a static MP4 by looping a single Anima-generated image for the full audio duration (ffmpeg `loop=1`). The goal is to replace that step with a 3-second animated video clip produced by Wan 2.2 (image-to-video) via DiffSynth Studio, then loop that clip to match the audio duration before muxing.

## Goals
- Replace the static image loop in the video pipeline with a Wan 2.2 animated clip.
- Maintain all existing output quality guarantees (H.264 + AAC, correct resolution, duration within tolerance).
- Reuse the DiffSynth Studio infrastructure already present in `backend/repositories/image_repository.py`.

## User Stories

### US-001: Animate generated image with Wan 2.2
**As a** creator, **I want** the generated video to show an animated scene **so that** the visual content is more engaging than a static freeze-frame.

**Acceptance Criteria:**
- [ ] After the Anima image is generated, a 3-second video clip is produced by `WanVideoPipeline` (`diffsynth.pipelines.wan_video`) using `Wan-AI/Wan2.2-I2V-A14B` with the generated image as `input_image`.
- [ ] Model weights are loaded via `WanVideoPipeline.from_pretrained` with `ModelConfig` entries (same pattern as `load_image_pipeline`); weights are auto-downloaded from ModelScope on first run.
- [ ] The Wan inference input image is resized to a supported resolution that preserves the target aspect ratio (e.g. 832×480 for 16:9, 480×832 for 9:16, 720×720 for 1:1).
- [ ] The output clip is saved as a temporary MP4 in the same temp directory used by the pipeline.
- [ ] Typecheck / lint passes.

### US-002: Loop animated clip to full audio duration
**As a** creator, **I want** the animated clip to fill the entire audio duration **so that** the output video has no gaps or black frames.

**Acceptance Criteria:**
- [ ] A new function in `media_repository` loops a video file to a target duration using ffmpeg (`stream_loop=-1` + `-t <duration>` or equivalent), producing a looped MP4.
- [ ] The looped clip duration is >= the audio duration (exact match within `MP4_DURATION_TOLERANCE_SECONDS`).
- [ ] Typecheck / lint passes.

### US-003: Mux looped animated clip with audio — same validation as current
**As a** creator, **I want** the final MP4 to pass the same quality checks as before **so that** nothing regresses.

**Acceptance Criteria:**
- [ ] The muxed output contains exactly one H.264 video stream and one AAC audio stream.
- [ ] Frame dimensions of the output MP4 match `body.image_target_width` x `body.image_target_height` (ffmpeg letterbox applied to the Wan clip output, same as current).
- [ ] `abs(audio_duration - mp4_duration) <= MP4_DURATION_TOLERANCE_SECONDS`.
- [ ] Existing `_validate_mp4_streams` and `_parse_video_dimensions` checks pass without modification.
- [ ] Typecheck / lint passes.

### US-004: Wan pipeline loader in image_repository
**As a** developer, **I want** a `load_wan_pipeline` function following the same structure as `load_image_pipeline` **so that** the integration is consistent and testable.

**Acceptance Criteria:**
- [ ] `load_wan_pipeline()` in `backend/repositories/image_repository.py` returns a `WanVideoPipeline` instance (imported from `diffsynth.pipelines.wan_video`) loaded with exactly the four `Wan-AI/Wan2.2-I2V-A14B` `ModelConfig` entries: `high_noise_model/diffusion_pytorch_model*.safetensors`, `low_noise_model/diffusion_pytorch_model*.safetensors`, `models_t5_umt5-xxl-enc-bf16.pth`, `Wan2.1_VAE.pth`; plus `tokenizer_config` pointing to `Wan-AI/Wan2.1-T2V-1.3B` / `google/umt5-xxl/`.
- [ ] VRAM config uses the **low-VRAM disk-offload pattern** from `examples/wanvideo/model_inference_low_vram/Wan2.2-I2V-A14B.py`: `offload_dtype="disk"`, `offload_device="disk"`, `onload_dtype=torch.bfloat16`, `onload_device="cpu"`, `preparing_dtype/device=bfloat16/cuda`, `computation_dtype/device=bfloat16/cuda`; `vram_limit = total_vram_gb - 2`.
- [ ] `run_wan_inference(pipeline, *, image, prompt, seed, width, height) -> list[PIL.Image]` calls `pipe(prompt=..., input_image=image, seed=seed, num_inference_steps=20, tiled=True, switch_DiT_boundary=0.9)` and returns the video frames list.
- [ ] Typecheck / lint passes.

## Functional Requirements
- FR-1: Add `load_wan_pipeline()` and `run_wan_inference()` to `backend/repositories/image_repository.py`. Both follow the **low-VRAM disk-offload pattern** from `examples/wanvideo/model_inference_low_vram/Wan2.2-I2V-A14B.py` (reference: `diffsynth.pipelines.wan_video.WanVideoPipeline`, `tiled=True`, `switch_DiT_boundary=0.9`, `fps=15`, `quality=5`).
- FR-2: Add Wan 2.2 model ID and file-pattern constants to `backend/models/constants.py` (e.g. `WAN_I2V_MODEL_ID`, `WAN_I2V_HIGH_NOISE_PATTERN`, `WAN_I2V_LOW_NOISE_PATTERN`, `WAN_I2V_T5_PATTERN`, `WAN_I2V_VAE_PATTERN`, `WAN_I2V_TOKENIZER_MODEL_ID`, `WAN_I2V_TOKENIZER_PATTERN`, `WAN_CLIP_DURATION_SECONDS = 3`, `WAN_CLIP_FPS = 15`).
- FR-3: Add `loop_video_to_duration(video_path, output_path, target_duration_seconds)` to `backend/repositories/media_repository.py`.
- FR-4: In `backend/services/video_service.py`, replace the `mux_image_and_audio_to_mp4` call with the sequence: `run_wan_inference` → save 3-sec clip → `loop_video_to_duration` → `mux_video_and_audio_to_mp4` (new or updated function that accepts a video input instead of a static image).
- FR-5: Add `mux_video_and_audio_to_mp4` to `media_repository` (or update `mux_image_and_audio_to_mp4` signature) to accept a video file as the video input instead of a still image with `loop=1`.
- FR-6: All existing MP4 output validations (`_validate_mp4_streams`, `_parse_video_dimensions`, duration check) remain in place and must pass.
- FR-7: Update `VIDEO_GENERATION_TIMEOUT_SECONDS` in `constants.py` to `1800` (30 min) to accommodate Wan 2.2 inference time.

## Non-Goals (Out of Scope)
- No new UI controls — the Wan animation step is fully transparent to the frontend.
- No user-configurable Wan parameters (steps, guidance scale) exposed via the API in this iteration.
- No support for Wan text-to-video (T2V) — only image-to-video (I2V).
- No change to the audio generation or Anima image generation steps.
- No upscaling of the Wan output with RealESRGAN in this iteration.

## Open Questions
None — all resolved:
- OQ-1 resolved: `num_inference_steps=20`.
- OQ-2 resolved: `tiled=True` always.
- OQ-3 resolved: `VIDEO_GENERATION_TIMEOUT_SECONDS = 1800` (30 min).
- OQ-4 resolved: instantiate per-request — load pipeline, run inference, then release (no singleton).
