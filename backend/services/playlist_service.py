from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DEFAULT_PLAYLIST_NAME = "My Playlist"

PLAYLISTS_JSON_PATH: Path = Path(__file__).resolve().parents[1] / "playlists.json"
RECORDINGS_ROOT: Path = Path(__file__).resolve().parents[1] / "recordings"


class PlaylistNotFoundError(Exception):
    """Raised when a playlist id does not exist in the store."""


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


def _normalize_tracks(raw: Any) -> list[dict[str, Any]]:
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


def _normalize_playlist_entry(p: Any) -> dict[str, Any] | None:
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
    tracks = _normalize_tracks(p.get("tracks"))
    return {"id": pid.strip(), "name": name.strip(), "tracks": tracks}


def _normalize_playlists(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for p in raw:
        entry = _normalize_playlist_entry(p)
        if entry:
            out.append(entry)
    return out


def _safe_filename(name: str | None) -> str:
    if not name or not isinstance(name, str):
        return "recording.mp4"
    base = Path(name).name
    if not base or base in (".", ".."):
        return "recording.mp4"
    # Allow only sane filename characters
    cleaned = re.sub(r"[^a-zA-Z0-9._\- ]+", "_", base).strip()
    if not cleaned:
        return "recording.mp4"
    if not cleaned.lower().endswith(".mp4"):
        cleaned = f"{cleaned}.mp4"
    return cleaned[:200]


def get_playlists() -> list[dict[str, Any]]:
    """Return persisted playlists, creating a default playlist on disk when none exist."""
    path = PLAYLISTS_JSON_PATH
    store = _read_store(path)
    raw_list = store.get("playlists")
    valid = _normalize_playlists(raw_list)
    if valid:
        return valid
    new_id = str(uuid.uuid4())
    entry = {"id": new_id, "name": _DEFAULT_PLAYLIST_NAME, "tracks": []}
    _write_store(path, {"playlists": [entry]})
    return [entry]


def add_track(playlist_id: str, file_bytes: bytes, original_filename: str | None) -> dict[str, Any]:
    """Save MP4 bytes under recordings/{playlist_id}/{track_id}.mp4 and append metadata to playlists.json."""
    pid = playlist_id.strip()
    if not pid:
        raise PlaylistNotFoundError("Missing playlist id")

    playlists = get_playlists()
    idx = next((i for i, p in enumerate(playlists) if p["id"] == pid), None)
    if idx is None:
        raise PlaylistNotFoundError(f"Playlist not found: {pid}")

    track_id = str(uuid.uuid4())
    filename = _safe_filename(original_filename)
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    dest_dir = RECORDINGS_ROOT / pid
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{track_id}.mp4"
    dest_path.write_bytes(file_bytes)

    track: dict[str, Any] = {
        "id": track_id,
        "filename": filename,
        "created_at": created_at,
        "size_bytes": len(file_bytes),
    }

    store = _read_store(PLAYLISTS_JSON_PATH)
    raw_list = store.get("playlists")
    if not isinstance(raw_list, list):
        raw_list = []
    updated: list[Any] = []
    found = False
    for p in raw_list:
        if isinstance(p, dict) and p.get("id") == pid:
            found = True
            pl = dict(p)
            tr = pl.get("tracks")
            if not isinstance(tr, list):
                tr = []
            tr = list(tr)
            tr.append(track)
            pl["tracks"] = tr
            updated.append(pl)
        else:
            updated.append(p)
    if not found:
        # Should not happen if get_playlists had this id; keep store consistent
        raise PlaylistNotFoundError(f"Playlist not found in store: {pid}")

    _write_store(PLAYLISTS_JSON_PATH, {"playlists": updated})
    return track


def update_playlist_name(playlist_id: str, name: str) -> dict[str, Any]:
    """Update a playlist's display name in playlists.json and return the normalized playlist row."""
    pid = playlist_id.strip()
    if not pid:
        raise PlaylistNotFoundError("Missing playlist id")
    trimmed = name.strip()
    if not trimmed:
        raise ValueError("Empty playlist name")

    playlists = get_playlists()
    if not any(p["id"] == pid for p in playlists):
        raise PlaylistNotFoundError(f"Playlist not found: {pid}")

    store = _read_store(PLAYLISTS_JSON_PATH)
    raw_list = store.get("playlists")
    if not isinstance(raw_list, list):
        raw_list = []
    updated: list[Any] = []
    found = False
    for p in raw_list:
        if isinstance(p, dict) and p.get("id") == pid:
            found = True
            pl = dict(p)
            pl["name"] = trimmed
            updated.append(pl)
        else:
            updated.append(p)
    if not found:
        raise PlaylistNotFoundError(f"Playlist not found in store: {pid}")

    _write_store(PLAYLISTS_JSON_PATH, {"playlists": updated})
    refreshed = get_playlists()
    match = next((p for p in refreshed if p["id"] == pid), None)
    if match is None:
        raise PlaylistNotFoundError(f"Playlist not found after update: {pid}")
    return match
