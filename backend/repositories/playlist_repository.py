from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

PLAYLISTS_JSON_PATH: Path = Path(__file__).resolve().parents[1] / "playlists.json"
RECORDINGS_ROOT: Path = Path(__file__).resolve().parents[1] / "recordings"


def read_store(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"playlists": []}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"playlists": []}
    if not isinstance(raw, dict):
        return {"playlists": []}
    return raw


def write_store(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def normalize_tracks(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for t in raw:
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        filename = t.get("filename")
        created_at = t.get("created_at")
        size_bytes = t.get("size_bytes")
        if (
            isinstance(tid, str)
            and tid.strip()
            and isinstance(filename, str)
            and filename.strip()
            and isinstance(created_at, str)
            and created_at.strip()
            and isinstance(size_bytes, int)
            and size_bytes >= 0
        ):
            out.append(
                {
                    "id": tid.strip(),
                    "filename": filename.strip(),
                    "created_at": created_at.strip(),
                    "size_bytes": size_bytes,
                }
            )
    return out


def normalize_playlist_entry(p: Any) -> dict[str, Any] | None:
    if not isinstance(p, dict):
        return None
    pid = p.get("id")
    name = p.get("name")
    if not (
        isinstance(pid, str)
        and pid.strip()
        and isinstance(name, str)
        and name.strip()
    ):
        return None
    tracks = normalize_tracks(p.get("tracks"))
    return {"id": pid.strip(), "name": name.strip(), "tracks": tracks}


def normalize_playlists(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for p in raw:
        entry = normalize_playlist_entry(p)
        if entry:
            out.append(entry)
    return out


def safe_filename(name: str | None) -> str:
    if not name or not isinstance(name, str):
        return "recording.mp4"
    base = Path(name).name
    if not base or base in (".", ".."):
        return "recording.mp4"
    cleaned = re.sub(r"[^a-zA-Z0-9._\- ]+", "_", base).strip()
    if not cleaned:
        return "recording.mp4"
    if not cleaned.lower().endswith(".mp4"):
        cleaned = f"{cleaned}.mp4"
    return cleaned[:200]
