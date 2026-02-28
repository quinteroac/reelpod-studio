from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import main


# ---------------------------------------------------------------------------
# US-001-AC03: Request body validation (mood, tempo, style)
# ---------------------------------------------------------------------------


class TestGenerateRequestBody:
    def test_valid_request_body(self) -> None:
        body = main.GenerateRequestBody(mood="chill", tempo=80, style="jazz")
        assert body.mood == "chill"
        assert body.tempo == 80
        assert body.style == "jazz"

    def test_tempo_below_minimum_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="chill", tempo=59, style="jazz")

    def test_tempo_above_maximum_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="chill", tempo=121, style="jazz")

    def test_empty_mood_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="", tempo=80, style="jazz")

    def test_empty_style_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="chill", tempo=80, style="")

    def test_whitespace_only_mood_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="   ", tempo=80, style="jazz")

    def test_tempo_at_boundaries_accepted(self) -> None:
        low = main.GenerateRequestBody(mood="chill", tempo=60, style="jazz")
        high = main.GenerateRequestBody(mood="chill", tempo=120, style="jazz")
        assert low.tempo == 60
        assert high.tempo == 120


# ---------------------------------------------------------------------------
# US-001-AC04: Prompt template
# ---------------------------------------------------------------------------


class TestBuildPrompt:
    def test_prompt_follows_template(self) -> None:
        body = main.GenerateRequestBody(mood="chill", tempo=80, style="jazz")
        prompt = main.build_prompt(body)
        assert prompt == "chill lofi jazz, 80 BPM"

    def test_prompt_includes_all_parameters(self) -> None:
        body = main.GenerateRequestBody(mood="warm", tempo=95, style="hip-hop")
        prompt = main.build_prompt(body)
        assert "warm" in prompt
        assert "hip-hop" in prompt
        assert "95 BPM" in prompt
        assert "lofi" in prompt

    def test_prompt_template_documented_in_source(self) -> None:
        """US-001-AC04: The exact template must be documented in a code comment."""
        source = Path(__file__).parent.joinpath("main.py").read_text()
        assert '# Prompt template: "{mood} lofi {style}, {tempo} BPM"' in source


# ---------------------------------------------------------------------------
# US-001-AC01: ace-step dependency
# ---------------------------------------------------------------------------


class TestDependencyListed:
    def test_ace_step_in_requirements_txt(self) -> None:
        requirements = (Path(__file__).parent / "requirements.txt").read_text()
        assert "ace-step" in requirements

    def test_ace_step_in_pyproject_toml(self) -> None:
        pyproject = (Path(__file__).parent / "pyproject.toml").read_text()
        assert "ace-step" in pyproject


# ---------------------------------------------------------------------------
# US-001-AC09: OpenAI removal verification
# ---------------------------------------------------------------------------


class TestOpenAIRemoved:
    def test_no_openai_imports_in_main(self) -> None:
        source = (Path(__file__).parent / "main.py").read_text()
        assert "from openai" not in source
        assert "import openai" not in source

    def test_no_openai_api_key_reference(self) -> None:
        source = (Path(__file__).parent / "main.py").read_text()
        assert "OPENAI_API_KEY" not in source

    def test_removed_helpers_absent(self) -> None:
        assert not hasattr(main, "build_messages")
        assert not hasattr(main, "load_skill_body")
        assert not hasattr(main, "load_few_shot_examples")
        assert not hasattr(main, "validate_pattern")
        assert not hasattr(main, "extract_pattern_candidate")
        assert not hasattr(main, "flatten_text_content")
        assert not hasattr(main, "is_malformed_pattern")


# ---------------------------------------------------------------------------
# US-001-AC10: llm-skills directory removed
# ---------------------------------------------------------------------------


class TestLlmSkillsRemoved:
    def test_llm_skills_directory_does_not_exist(self) -> None:
        llm_skills_dir = Path(__file__).parent / "llm-skills"
        assert not llm_skills_dir.exists()


# ---------------------------------------------------------------------------
# Fixtures for endpoint tests
# ---------------------------------------------------------------------------

WAV_HEADER = b"RIFF" + b"\x00" * 100


@pytest.fixture
def mock_ace_model(tmp_path):
    """Provide a mock ACEStepPipeline that writes a fake WAV file and returns its path."""
    mock_model = MagicMock(spec=main.ACEStepPipeline)

    def fake_call(**kwargs):
        save_path = kwargs.get("save_path", str(tmp_path))
        wav_file = os.path.join(save_path, "output_0.wav")
        with open(wav_file, "wb") as f:
            f.write(WAV_HEADER)
        return [wav_file, {"params": "json"}]

    mock_model.side_effect = fake_call
    return mock_model


@pytest.fixture
def client(mock_ace_model):
    """TestClient with the ACEStep model replaced by a mock via lifespan."""
    with patch("main.ACEStepPipeline", return_value=mock_ace_model):
        with TestClient(app=main.app, raise_server_exceptions=False) as c:
            yield c


# ---------------------------------------------------------------------------
# US-001-AC02, AC05, AC06, AC07, AC08: Endpoint behavior with mocked ACEStep
# ---------------------------------------------------------------------------


class TestGenerateEndpoint:
    # US-001-AC03: endpoint accepts same request body
    def test_valid_request_returns_200(self, client, mock_ace_model) -> None:
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.status_code == 200

    # US-001-AC07: returns StreamingResponse with audio/wav
    def test_response_media_type_is_wav(self, client, mock_ace_model) -> None:
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.headers["content-type"] == "audio/wav"

    # US-001-AC07: response contains WAV bytes
    def test_response_contains_wav_bytes(self, client, mock_ace_model) -> None:
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.content.startswith(b"RIFF")

    # US-001-AC05: lyrics="" (instrumental)
    def test_pipeline_called_with_empty_lyrics(self, client, mock_ace_model) -> None:
        client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        call_kwargs = mock_ace_model.call_args.kwargs
        assert call_kwargs["lyrics"] == ""

    # US-001-AC06: audio_duration=30, infer_step=20
    def test_pipeline_called_with_default_duration_and_steps(self, client, mock_ace_model) -> None:
        client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        call_kwargs = mock_ace_model.call_args.kwargs
        assert call_kwargs["audio_duration"] == 30
        assert call_kwargs["infer_step"] == 20

    # US-001-AC04: prompt built from parameters
    def test_pipeline_called_with_correct_prompt(self, client, mock_ace_model) -> None:
        client.post("/api/generate", json={"mood": "warm", "tempo": 95, "style": "hip-hop"})
        call_kwargs = mock_ace_model.call_args.kwargs
        assert call_kwargs["prompt"] == "warm lofi hip-hop, 95 BPM"

    # US-001-AC08: inference failure returns 500
    def test_inference_failure_returns_500_with_error(self, client, mock_ace_model) -> None:
        mock_ace_model.side_effect = RuntimeError("GPU out of memory")
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.status_code == 500
        assert response.json() == {"error": "Audio generation failed"}

    # US-001-AC03: validation errors return 422
    def test_invalid_tempo_returns_422(self, client) -> None:
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 50, "style": "jazz"})
        assert response.status_code == 422
        assert "error" in response.json()

    def test_empty_mood_returns_422(self, client) -> None:
        response = client.post("/api/generate", json={"mood": "", "tempo": 80, "style": "jazz"})
        assert response.status_code == 422

    def test_missing_field_returns_422(self, client) -> None:
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80})
        assert response.status_code == 422

    # US-001-AC07: format=wav passed to pipeline
    def test_pipeline_called_with_wav_format(self, client, mock_ace_model) -> None:
        client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        call_kwargs = mock_ace_model.call_args.kwargs
        assert call_kwargs["format"] == "wav"


# ---------------------------------------------------------------------------
# US-003: End-to-end smoke test for POST /api/generate
# ---------------------------------------------------------------------------


class TestGenerateEndpointSmokeTest:
    """US-003: Automated smoke tests verifying the generate endpoint returns valid WAV audio."""

    # US-003-AC01, AC02, AC03: mock ACEStep infer(), assert 200 + audio/wav + non-empty body
    def test_success_returns_200_wav_with_body(self, client) -> None:
        response = client.post(
            "/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert len(response.content) > 0

    # US-003-AC04: when ACEStep infer() raises, endpoint returns 500 with error JSON
    def test_infer_exception_returns_500_error_json(self, client, mock_ace_model) -> None:
        mock_ace_model.side_effect = RuntimeError("Unexpected failure")
        response = client.post(
            "/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"}
        )
        assert response.status_code == 500
        assert response.json() == {"error": "Audio generation failed"}


# ---------------------------------------------------------------------------
# US-001-AC02: Model loaded once at startup (lifespan test)
# ---------------------------------------------------------------------------


class TestModelLifespan:
    def test_model_is_loaded_via_lifespan(self) -> None:
        with patch("main.ACEStepPipeline") as mock_cls:
            mock_cls.return_value = MagicMock()
            with TestClient(app=main.app):
                mock_cls.assert_called_once()

    def test_model_is_none_after_shutdown(self) -> None:
        with patch("main.ACEStepPipeline") as mock_cls:
            mock_cls.return_value = MagicMock()
            with TestClient(app=main.app):
                pass
            assert main.ace_model is None
