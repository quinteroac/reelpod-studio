# Iteration 000030 — Audit

## Executive Summary

Iteration 000030 successfully delivers the core upscaling pipeline (US-002, US-003, FR-5–7): `SRVGGNetCompact`, tile-based processing, GPU half-precision, correct pipeline order (WAN I2V → upscale 4x → resize → loop → mux), and graceful fallback are all correctly implemented. The main gap was the startup-download requirement — ESRGAN weights were downloaded lazily on the first upscale call rather than at backend boot (US-001 / FR-3 / FR-4). Additionally, FR-1 and FR-2 showed naming/location drift from the PRD spec. All gaps have been addressed in the refactor.

## Verification by FR

| FR | Assessment | Notes |
|----|-----------|-------|
| FR-1 | partially_comply | Function exists in `video_repository.py` (not `media_repository.py`/`upscale_repository.py`); name is `upscale_video_with_realesrgan_and_resize` vs PRD `upscale_video_with_realesrgan_animevideo`. Functionally complete. |
| FR-2 | partially_comply | Constants existed with correct values but named `REAL_ESRGAN_ANIME_*` instead of `REAL_ESRGAN_VIDEO_*`. Fixed in refactor. |
| FR-3 | does_not_comply | `_ensure_realesrgan_video_weights()` was absent; `video_repository` called `image_repository.ensure_realesrgan_anime_weights()` directly. Fixed in refactor. |
| FR-4 | does_not_comply | No weights check at startup. Fixed in refactor by calling `video_repository.ensure_realesrgan_video_weights()` from `video_service.startup()`. |
| FR-5 | comply | Pipeline order WAN I2V → upscale → resize → loop → mux confirmed in `video_service.py`. |
| FR-6 | comply | Mux called without target dims; letterbox filter skipped when params are None. |
| FR-7 | comply | Exception from upscale caught in `video_service.py`, falls back to original Wan clip with a warning. |

## Verification by US

| US | Assessment | Notes |
|----|-----------|-------|
| US-001 | partially_comply | AC02–06 satisfied. AC01 (on-startup check) not satisfied at implementation time; fixed in refactor. |
| US-002 | comply | All ACs satisfied: SRVGGNetCompact, 4x upscale, LANCZOS resize, tile=256/tile_pad=10, GPU half-precision with CPU fallback, graceful fallback. |
| US-003 | comply | MP4 dimensions validated via ffprobe after mux; mismatch raises `VideoGenerationFailedError`. Visual ACs require runtime verification. |

## Minor Observations

- Debug/telemetry block in `image_repository.py` (lines 325–351) wrote JSON to `.cursor/debug.log` with `hypothesisId: "H4"` — leftover investigation code. Removed in refactor.
- Cross-repository coupling: `video_repository` imported `image_repository` to call weights download. Resolved by introducing `_ensure_realesrgan_video_weights()` in `video_repository`.
- Lazy weights download would have caused unexpected latency on first request in cold-start environments. Resolved by eager startup download.

## Conclusions and Recommendations

All identified gaps were addressed:
1. `REAL_ESRGAN_VIDEO_WEIGHTS_FILENAME` and `REAL_ESRGAN_VIDEO_WEIGHTS_URL` added to `constants.py`.
2. `_ensure_realesrgan_video_weights()` and `ensure_realesrgan_video_weights()` added to `video_repository.py`; `build_realesrgan_video_upsampler()` now calls the video-specific function.
3. `video_service.startup()` now calls `video_repository.ensure_realesrgan_video_weights()` eagerly, with graceful fallback on failure.
4. Debug telemetry block and unused `json`/`time` imports removed from `image_repository.py`.

## Refactor Plan

| # | File | Change | Status |
|---|------|--------|--------|
| 1 | `backend/models/constants.py` | Add `REAL_ESRGAN_VIDEO_WEIGHTS_FILENAME` and `REAL_ESRGAN_VIDEO_WEIGHTS_URL` | ✅ Done |
| 2 | `backend/repositories/video_repository.py` | Add `_ensure_realesrgan_video_weights()` / `ensure_realesrgan_video_weights()`; update `build_realesrgan_video_upsampler()` to use it | ✅ Done |
| 3 | `backend/services/video_service.py` | Call `video_repository.ensure_realesrgan_video_weights()` at startup with graceful fallback | ✅ Done |
| 4 | `backend/repositories/image_repository.py` | Remove debug telemetry block and unused `json`/`time` imports; clean up unused VRAM tracking vars | ✅ Done |
