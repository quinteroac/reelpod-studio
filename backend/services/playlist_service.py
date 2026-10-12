from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from repositories import playlist_repository as repo

_DEFAULT_PLAYLIST_NAME = "My Playlist"
_NEW_PLAYLIST_DEFAULT_NAME = "New Playlist"


class PlaylistNotFoundError(Exception):
    """Raised when a playlist id does not exist in the store."""


class TrackNotFoundError(Exception):
    """Raised when a track id does not exist for the playlist."""


def get_playlists() -> list[dict[str, Any]]:
    """Return persisted playlists, creating a default playlist on disk when none exist."""
    path = repo.PLAYLISTS_JSON_PATH
    store = repo.read_store(path)
    raw_list = store.get("playlists")
    valid = repo.normalize_playlists(raw_list)
    if valid:
        return valid
    new_id = str(uuid.uuid4())
    entry = {"id": new_id, "name": _DEFAULT_PLAYLIST_NAME, "tracks": []}
    repo.write_store(path, {"playlists": [entry]})
    return [entry]


def create_playlist(name: str | None = None) -> dict[str, Any]:
    """Append a new empty playlist to playlists.json and return its row."""
    trimmed = (name or "").strip()
    if not trimmed:
        trimmed = _NEW_PLAYLIST_DEFAULT_NAME
    _ = get_playlists()
    store = repo.read_store(repo.PLAYLISTS_JSON_PATH)
    raw_list = store.get("playlists")
    if not isinstance(raw_list, list):
        raw_list = []
    new_id = str(uuid.uuid4())
    entry: dict[str, Any] = {"id": new_id, "name": trimmed, "tracks": []}
    raw_list = list(raw_list)
    raw_list.append(entry)
    repo.write_store(repo.PLAYLISTS_JSON_PATH, {"playlists": raw_list})
    return {"id": new_id, "name": trimmed, "tracks": []}


def get_playlist_tracks(playlist_id: str) -> list[dict[str, Any]]:
    """Return normalized track rows for a playlist id."""
    pid = playlist_id.strip()
    if not pid:
        raise PlaylistNotFoundError("Missing playlist id")
    playlists = get_playlists()
    match = next((p for p in playlists if p["id"] == pid), None)
    if match is None:
        raise PlaylistNotFoundError(f"Playlist not found: {pid}")
    return [dict(t) for t in match["tracks"]]


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
    filename = repo.safe_filename(original_filename)
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    dest_dir = repo.RECORDINGS_ROOT / pid
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{track_id}.mp4"
    dest_path.write_bytes(file_bytes)

    track: dict[str, Any] = {
        "id": track_id,
        "filename": filename,
        "created_at": created_at,
        "size_bytes": len(file_bytes),
    }

    store = repo.read_store(repo.PLAYLISTS_JSON_PATH)
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

    repo.write_store(repo.PLAYLISTS_JSON_PATH, {"playlists": updated})
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

    store = repo.read_store(repo.PLAYLISTS_JSON_PATH)
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

    repo.write_store(repo.PLAYLISTS_JSON_PATH, {"playlists": updated})
    refreshed = get_playlists()
    match = next((p for p in refreshed if p["id"] == pid), None)
    if match is None:
        raise PlaylistNotFoundError(f"Playlist not found after update: {pid}")
    return match


def get_track_mp4_path(playlist_id: str, track_id: str) -> tuple[Any, str]:
    """Resolve the on-disk MP4 path and original filename for a persisted track."""
    pid = playlist_id.strip()
    tid = track_id.strip()
    if not pid or not tid:
        raise PlaylistNotFoundError("Missing playlist or track id")
    playlists = get_playlists()
    pl = next((p for p in playlists if p["id"] == pid), None)
    if pl is None:
        raise PlaylistNotFoundError(f"Playlist not found: {pid}")
    track = next((t for t in pl["tracks"] if t["id"] == tid), None)
    if track is None:
        raise TrackNotFoundError(f"Track not found: {tid}")
    path = repo.RECORDINGS_ROOT / pid / f"{tid}.mp4"
    filename = str(track["filename"])
    return path, filename


def delete_track(playlist_id: str, track_id: str) -> None:
    """Remove a track from playlists.json and delete its MP4 file from disk."""
    pid = playlist_id.strip()
    tid = track_id.strip()
    if not pid or not tid:
        raise PlaylistNotFoundError("Missing playlist or track id")

    playlists = get_playlists()
    pl = next((p for p in playlists if p["id"] == pid), None)
    if pl is None:
        raise PlaylistNotFoundError(f"Playlist not found: {pid}")
    if not any(t["id"] == tid for t in pl["tracks"]):
        raise TrackNotFoundError(f"Track not found: {tid}")

    store = repo.read_store(repo.PLAYLISTS_JSON_PATH)
    raw_list = store.get("playlists")
    if not isinstance(raw_list, list):
        raw_list = []
    updated: list[Any] = []
    found = False
    for p in raw_list:
        if isinstance(p, dict) and p.get("id") == pid:
            found = True
            pl_dict = dict(p)
            tr = pl_dict.get("tracks")
            if not isinstance(tr, list):
                tr = []
            new_tracks = [t for t in tr if not (isinstance(t, dict) and t.get("id") == tid)]
            pl_dict["tracks"] = new_tracks
            updated.append(pl_dict)
        else:
            updated.append(p)
    if not found:
        raise PlaylistNotFoundError(f"Playlist not found in store: {pid}")

    repo.write_store(repo.PLAYLISTS_JSON_PATH, {"playlists": updated})

    file_path = repo.RECORDINGS_ROOT / pid / f"{tid}.mp4"
    if file_path.is_file():
        file_path.unlink()
