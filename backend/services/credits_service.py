from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)

_CREDITS_FILE = Path(__file__).resolve().parents[1] / "config" / "model_credits.yaml"

_credits_text: str | None = None
_credits_loaded: bool = False


def _format_credits(data: dict[str, Any]) -> str:
    models = data.get("models")
    if not isinstance(models, list) or not models:
        return ""
    parts: list[str] = []
    for entry in models:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name", "")
        role = entry.get("role", "")
        if name and role:
            parts.append(f"{name} ({role})")
        elif name:
            parts.append(name)
    if not parts:
        return ""
    return "Models used: " + " · ".join(parts)


def _load(path: Path = _CREDITS_FILE) -> str:
    import yaml  # pyyaml — available as transitive dep via comfy-diffusion

    if not path.is_file():
        logger.warning("model_credits.yaml not found at %s; model credits will be omitted.", path)
        return ""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        logger.warning("model_credits.yaml is malformed (%s); model credits will be omitted.", exc)
        return ""
    if not isinstance(raw, dict):
        logger.warning("model_credits.yaml must be a YAML mapping; model credits will be omitted.")
        return ""
    return _format_credits(raw)


def startup(path: Path = _CREDITS_FILE) -> None:
    global _credits_text, _credits_loaded
    _credits_text = _load(path)
    _credits_loaded = True
    if _credits_text:
        logger.info("Model credits loaded: %s", _credits_text)


def get_credits_text() -> str:
    global _credits_text, _credits_loaded
    if not _credits_loaded:
        startup(_CREDITS_FILE)
    return _credits_text or ""


def reset_for_tests() -> None:
    global _credits_text, _credits_loaded
    _credits_text = None
    _credits_loaded = False
