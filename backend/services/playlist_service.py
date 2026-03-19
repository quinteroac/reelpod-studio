from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

_DEFAULT_PLAYLIST_NAME = "My Playlist"

PLAYLISTS_JSON_PATH: Path = Path(__file__).resolve().parents[1] / "playlists.json"


def _read_store(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"playlists": []}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"playlists": []}
    if not isinstance(raw, dict):
        return {"playlists": []}
    return raw


def _write_store(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _normalize_playlists(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        name = p.get("name")
        if isinstance(pid, str) and pid.strip() and isinstance(name, str) and name.strip():
            out.append({"id": pid.strip(), "name": name.strip()})
    return out


def get_playlists() -> list[dict[str, str]]:
    """Return persisted playlists, creating a default playlist on disk when none exist."""
    path = PLAYLISTS_JSON_PATH
    store = _read_store(path)
    raw_list = store.get("playlists")
    valid = _normalize_playlists(raw_list)
    if valid:
        return valid
    new_id = str(uuid.uuid4())
    entry = {"id": new_id, "name": _DEFAULT_PLAYLIST_NAME}
    _write_store(path, {"playlists": [entry]})
    return [entry]
