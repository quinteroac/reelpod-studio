from __future__ import annotations

import logging
from pathlib import Path

import pytest

from services import credits_service


@pytest.fixture(autouse=True)
def reset_credits_state() -> None:
    credits_service.reset_for_tests()
    yield
    credits_service.reset_for_tests()


class TestCreditsServiceValidYaml:
    def test_get_credits_text_returns_formatted_string(self, tmp_path: Path) -> None:
        yaml_file = tmp_path / "model_credits.yaml"
        yaml_file.write_text(
            "models:\n"
            "  - name: ACEStep 1.5\n"
            "    role: Music generation\n"
            "  - name: Anima\n"
            "    role: Image generation\n"
            "  - name: Wan 2.1 I2V\n"
            "    role: Video animation\n",
            encoding="utf-8",
        )

        credits_service.startup(yaml_file)
        text = credits_service.get_credits_text()

        assert "ACEStep 1.5" in text
        assert "Music generation" in text
        assert "Anima" in text
        assert "Image generation" in text
        assert "Wan 2.1 I2V" in text
        assert "Video animation" in text
        assert text.startswith("Models used:")

    def test_credits_text_uses_separator_between_models(self, tmp_path: Path) -> None:
        yaml_file = tmp_path / "model_credits.yaml"
        yaml_file.write_text(
            "models:\n"
            "  - name: ModelA\n"
            "    role: Role A\n"
            "  - name: ModelB\n"
            "    role: Role B\n",
            encoding="utf-8",
        )

        credits_service.startup(yaml_file)
        text = credits_service.get_credits_text()

        assert "ModelA (Role A)" in text
        assert "ModelB (Role B)" in text
        assert " · " in text

    def test_startup_loads_real_yaml_file(self) -> None:
        """AC01: The real model_credits.yaml file can be read and produces non-empty credits."""
        real_path = Path(__file__).parent / "config" / "model_credits.yaml"
        assert real_path.is_file(), "backend/config/model_credits.yaml must exist"

        credits_service.startup(real_path)
        text = credits_service.get_credits_text()

        assert text != "", "model_credits.yaml should produce non-empty credits text"


class TestCreditsServiceMissingFile:
    def test_missing_file_returns_empty_string(self, tmp_path: Path) -> None:
        missing = tmp_path / "nonexistent.yaml"

        credits_service.startup(missing)
        text = credits_service.get_credits_text()

        assert text == ""

    def test_missing_file_logs_warning(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        missing = tmp_path / "nonexistent.yaml"

        with caplog.at_level(logging.WARNING, logger="services.credits_service"):
            credits_service.startup(missing)

        assert "not found" in caplog.text.lower() or "warning" in caplog.text.lower() or any(
            r.levelno >= logging.WARNING for r in caplog.records
        )

    def test_lazy_load_missing_file_returns_empty_string(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        missing = tmp_path / "nonexistent.yaml"
        monkeypatch.setattr(credits_service, "_CREDITS_FILE", missing)

        text = credits_service.get_credits_text()

        assert text == ""


class TestCreditsServiceMalformedYaml:
    def test_malformed_yaml_returns_empty_string(self, tmp_path: Path) -> None:
        yaml_file = tmp_path / "model_credits.yaml"
        yaml_file.write_text("{ invalid yaml: [unclosed", encoding="utf-8")

        credits_service.startup(yaml_file)
        text = credits_service.get_credits_text()

        assert text == ""

    def test_malformed_yaml_logs_warning(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        yaml_file = tmp_path / "model_credits.yaml"
        yaml_file.write_text("{ invalid yaml: [unclosed", encoding="utf-8")

        with caplog.at_level(logging.WARNING, logger="services.credits_service"):
            credits_service.startup(yaml_file)

        assert any(r.levelno >= logging.WARNING for r in caplog.records)

    def test_non_mapping_yaml_returns_empty_string(self, tmp_path: Path) -> None:
        yaml_file = tmp_path / "model_credits.yaml"
        yaml_file.write_text("- item1\n- item2\n", encoding="utf-8")

        credits_service.startup(yaml_file)
        text = credits_service.get_credits_text()

        assert text == ""
