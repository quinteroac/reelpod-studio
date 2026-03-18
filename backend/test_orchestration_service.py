from __future__ import annotations

import json

import pytest

from models.errors import OrchestrationFailedError
from services import orchestration_service


@pytest.fixture(autouse=True)
def restore_orchestration_state() -> None:
    previous_pipeline = orchestration_service.llm_pipeline
    previous_error = orchestration_service.llm_pipeline_load_error
    orchestration_service.llm_pipeline = object()
    orchestration_service.llm_pipeline_load_error = None
    yield
    orchestration_service.llm_pipeline = previous_pipeline
    orchestration_service.llm_pipeline_load_error = previous_error


def test_orchestrate_successful_with_creative_director_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, str] = {}
    image_prompt = (
        "score_9, score_8, best quality, highres, newest, safe, 1girl, hatsune miku, "
        "vocaloid, kantoku, city lights, night, neon, rain"
    )
    payload = {
        "song_title": "Neon Solitude",
        "audio_prompt": "synthwave, moody, 90 BPM, analog bass, dreamy pads, lyrics about neon solitude",
        "image_prompt": image_prompt,
        "video_prompt": "A lone singer crosses a neon intersection while rain streaks over the camera lens.",
        "youtube_title": "Neon Solitude - Synthwave Lofi",
        "youtube_description": (
            "A moody synthwave track drifting through neon-lit streets at night. "
            "Perfect for late-night drives and introspective moments."
        ),
    }

    def fake_generate_json_concept(_clip: object, user_prompt: str) -> str:
        seen["user_prompt"] = user_prompt
        seen["system_prompt"] = orchestration_service._build_orchestration_prompt(user_prompt)
        return json.dumps(payload)

    def fake_generate_video_prompt_ltx2(_clip: object, seed_prompt: str) -> str:
        seen["video_seed"] = seed_prompt
        return (
            "Style: cinematic anime. A vocalist is walking through a rainy crosswalk as the camera tracks "
            "beside her and neon reflections ripple on wet asphalt while distant traffic hum and soft synth "
            "arpeggios blend with her measured footsteps."
        )

    monkeypatch.setattr(orchestration_service, "_generate_json_concept", fake_generate_json_concept)
    monkeypatch.setattr(
        orchestration_service,
        "_generate_video_prompt_ltx2",
        fake_generate_video_prompt_ltx2,
    )

    result = orchestration_service.orchestrate("night city performance clip with introspective mood")

    assert result.song_title == payload["song_title"]
    assert result.audio_prompt == payload["audio_prompt"]
    assert result.image_prompt == image_prompt
    assert "creative director" in seen["system_prompt"].lower()
    assert "song_title" in seen["system_prompt"]
    assert "audio_prompt" in seen["system_prompt"]
    assert "image_prompt" in seen["system_prompt"]
    assert "video_prompt" in seen["system_prompt"]
    assert "youtube_title" in seen["system_prompt"]
    assert "youtube_description" in seen["system_prompt"]
    assert seen["video_seed"] == payload["video_prompt"]
    assert result.video_prompt == image_prompt
    assert "\n" not in result.video_prompt
    assert result.youtube_title == payload["youtube_title"]
    assert result.youtube_description == payload["youtube_description"]


def test_orchestrate_retries_json_parse_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def fake_generate_json_concept(_clip: object, _user_prompt: str) -> str:
        calls["count"] += 1
        if calls["count"] == 1:
            return "not-json"
        return json.dumps(
            {
                "song_title": "Morning Light",
                "audio_prompt": "lofi house, warm mood, 110 BPM, drum machine, jazzy keys, lyrics about sunrise",
                "image_prompt": (
                    "score_9, score_8, best quality, highres, newest, safe, 1girl, original, "
                    "unknown artist, sunrise, apartment balcony, coffee mug"
                ),
                "video_prompt": "A creator opens curtains as early sunlight enters a small studio apartment.",
                "youtube_title": "Morning Light - Lofi House Sunrise",
                "youtube_description": "A warm lofi house track for slow mornings and golden hour.",
            }
        )

    monkeypatch.setattr(orchestration_service, "_generate_json_concept", fake_generate_json_concept)
    monkeypatch.setattr(
        orchestration_service,
        "_generate_video_prompt_ltx2",
        lambda _clip, seed: f"Style: cinematic. {seed} Soft room tone and distant birds are audible.",
    )

    result = orchestration_service.orchestrate("morning studio vibe")

    assert calls["count"] == 2
    assert result.audio_prompt.startswith("lofi house")
    assert result.image_prompt.startswith("score_9, score_8, best quality, highres")


def test_orchestrate_raises_error_when_pipeline_failed_to_load() -> None:
    orchestration_service.llm_pipeline = None
    orchestration_service.llm_pipeline_load_error = "REELPOD_LLM_MODEL_PATH does not point to a file"

    with pytest.raises(OrchestrationFailedError) as exc_info:
        orchestration_service.orchestrate("retro cyberpunk alley performance")

    assert "LLM orchestration unavailable" in str(exc_info.value)
    assert "REELPOD_LLM_MODEL_PATH does not point to a file" in str(exc_info.value)


def test_creative_director_system_prompt_contains_song_title_rule() -> None:
    prompt = orchestration_service.CREATIVE_DIRECTOR_SYSTEM_PROMPT
    assert "song_title" in prompt
    assert "60" in prompt  # max 60 characters rule


def test_orchestration_result_strips_whitespace_from_song_title() -> None:
    result = orchestration_service.OrchestrationResult(
        song_title="  Neon Dreams  ",
        audio_prompt="synthwave, moody, 90 BPM, analog bass, dreamy pads",
        image_prompt="score_9, score_8, best quality, highres, neon cityscape",
        video_prompt="A soft neon glow drifts over the city at night.",
        youtube_title="Neon Dreams - Synthwave",
        youtube_description="A moody synthwave track for late-night city drives.",
    )
    assert result.song_title == "Neon Dreams"


def test_orchestrate_retries_when_song_title_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}
    image_prompt = "score_9, score_8, best quality, highres, lofi bedroom scene"

    def fake_generate_json_concept(_clip: object, _user_prompt: str) -> str:
        calls["count"] += 1
        if calls["count"] == 1:
            # First call omits song_title — validation should fail and trigger retry
            return json.dumps(
                {
                    "audio_prompt": "lofi jazz, relaxed, 85 BPM, soft piano, vinyl warmth",
                    "image_prompt": image_prompt,
                    "video_prompt": "Dust motes drift through golden afternoon light in a cosy bedroom.",
                    "youtube_title": "Golden Hour - Lofi Jazz",
                    "youtube_description": "A relaxed lofi jazz track for golden afternoon sessions.",
                }
            )
        return json.dumps(
            {
                "song_title": "Golden Hour",
                "audio_prompt": "lofi jazz, relaxed, 85 BPM, soft piano, vinyl warmth",
                "image_prompt": image_prompt,
                "video_prompt": "Dust motes drift through golden afternoon light in a cosy bedroom.",
                "youtube_title": "Golden Hour - Lofi Jazz",
                "youtube_description": "A relaxed lofi jazz track for golden afternoon sessions.",
            }
        )

    monkeypatch.setattr(orchestration_service, "_generate_json_concept", fake_generate_json_concept)
    monkeypatch.setattr(
        orchestration_service,
        "_generate_video_prompt_ltx2",
        lambda _clip, seed: f"Style: cinematic. {seed}",
    )

    result = orchestration_service.orchestrate("lofi bedroom afternoon vibe")

    assert calls["count"] == 2
    assert result.song_title == "Golden Hour"


def test_orchestrate_raises_orchestration_failed_error_when_song_title_persistently_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_generate_json_concept(_clip: object, _user_prompt: str) -> str:
        # Always omit song_title so all retries fail
        return json.dumps(
            {
                "audio_prompt": "lofi jazz, relaxed, 85 BPM, soft piano, vinyl warmth",
                "image_prompt": "score_9, score_8, best quality, highres, lofi bedroom scene",
                "video_prompt": "Dust motes drift through golden afternoon light in a cosy bedroom.",
                "youtube_title": "Golden Hour - Lofi Jazz",
                "youtube_description": "A relaxed lofi jazz track for golden afternoon sessions.",
            }
        )

    monkeypatch.setattr(orchestration_service, "_generate_json_concept", fake_generate_json_concept)

    with pytest.raises(OrchestrationFailedError):
        orchestration_service.orchestrate("lofi bedroom afternoon vibe")


def test_orchestration_result_youtube_title_no_underscores() -> None:
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="underscores"):
        orchestration_service.OrchestrationResult(
            song_title="Neon Dreams",
            audio_prompt="synthwave, moody, 90 BPM, analog bass, dreamy pads",
            image_prompt="score_9, score_8, best quality, highres, neon cityscape",
            video_prompt="A soft neon glow drifts over the city at night.",
            youtube_title="Neon_Dreams_Synthwave",
            youtube_description="A moody synthwave track for late-night city drives.",
        )


def test_orchestration_result_youtube_title_no_file_extension() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="file extension"):
        orchestration_service.OrchestrationResult(
            song_title="Neon Dreams",
            audio_prompt="synthwave, moody, 90 BPM, analog bass, dreamy pads",
            image_prompt="score_9, score_8, best quality, highres, neon cityscape",
            video_prompt="A soft neon glow drifts over the city at night.",
            youtube_title="Neon Dreams.mp3",
            youtube_description="A moody synthwave track for late-night city drives.",
        )


def test_orchestration_result_valid_youtube_fields() -> None:
    result = orchestration_service.OrchestrationResult(
        song_title="Neon Dreams",
        audio_prompt="synthwave, moody, 90 BPM, analog bass, dreamy pads",
        image_prompt="score_9, score_8, best quality, highres, neon cityscape",
        video_prompt="A soft neon glow drifts over the city at night.",
        youtube_title="Neon Dreams - Synthwave Lofi",
        youtube_description="A moody synthwave track drifting through neon-lit streets at night.",
    )
    assert result.youtube_title == "Neon Dreams - Synthwave Lofi"
    assert "_" not in result.youtube_title
    assert len(result.youtube_title) <= 100
    assert result.youtube_description
    assert len(result.youtube_description) <= 5000


def test_orchestrate_retries_when_youtube_fields_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}
    image_prompt = "score_9, score_8, best quality, highres, lofi bedroom scene"

    def fake_generate_json_concept(_clip: object, _user_prompt: str) -> str:
        calls["count"] += 1
        if calls["count"] == 1:
            # First call omits youtube_title and youtube_description
            return json.dumps(
                {
                    "song_title": "Golden Hour",
                    "audio_prompt": "lofi jazz, relaxed, 85 BPM, soft piano, vinyl warmth",
                    "image_prompt": image_prompt,
                    "video_prompt": "Dust motes drift through golden afternoon light in a cosy bedroom.",
                }
            )
        return json.dumps(
            {
                "song_title": "Golden Hour",
                "audio_prompt": "lofi jazz, relaxed, 85 BPM, soft piano, vinyl warmth",
                "image_prompt": image_prompt,
                "video_prompt": "Dust motes drift through golden afternoon light in a cosy bedroom.",
                "youtube_title": "Golden Hour - Lofi Jazz",
                "youtube_description": "A relaxed lofi jazz track for golden afternoon sessions.",
            }
        )

    monkeypatch.setattr(orchestration_service, "_generate_json_concept", fake_generate_json_concept)
    monkeypatch.setattr(
        orchestration_service,
        "_generate_video_prompt_ltx2",
        lambda _clip, seed: f"Style: cinematic. {seed}",
    )

    result = orchestration_service.orchestrate("lofi bedroom afternoon vibe")

    assert calls["count"] == 2
    assert result.youtube_title == "Golden Hour - Lofi Jazz"
    assert result.youtube_description == "A relaxed lofi jazz track for golden afternoon sessions."


def test_orchestrate_raises_when_youtube_fields_persistently_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_generate_json_concept(_clip: object, _user_prompt: str) -> str:
        # Always omit youtube fields so all retries fail
        return json.dumps(
            {
                "song_title": "Golden Hour",
                "audio_prompt": "lofi jazz, relaxed, 85 BPM, soft piano, vinyl warmth",
                "image_prompt": "score_9, score_8, best quality, highres, lofi bedroom scene",
                "video_prompt": "Dust motes drift through golden afternoon light in a cosy bedroom.",
            }
        )

    monkeypatch.setattr(orchestration_service, "_generate_json_concept", fake_generate_json_concept)

    with pytest.raises(OrchestrationFailedError):
        orchestration_service.orchestrate("lofi bedroom afternoon vibe")


def test_creative_director_system_prompt_contains_youtube_rules() -> None:
    prompt = orchestration_service.CREATIVE_DIRECTOR_SYSTEM_PROMPT
    assert "youtube_title" in prompt
    assert "youtube_description" in prompt
    assert "100" in prompt  # max 100 characters rule for youtube_title


def test_startup_captures_load_failure_and_orchestrate_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        orchestration_service,
        "load_llm_pipeline",
        lambda: (_ for _ in ()).throw(RuntimeError("runtime init failed")),
    )

    orchestration_service.startup()

    assert orchestration_service.llm_pipeline is None
    assert orchestration_service.llm_pipeline_load_error == "runtime init failed"
    with pytest.raises(OrchestrationFailedError):
        orchestration_service.orchestrate("ambient forest timelapse")
