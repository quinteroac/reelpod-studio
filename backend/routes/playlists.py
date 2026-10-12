from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from models.schemas import (
    AddPlaylistTrackResponse,
    CreatePlaylistRequestBody,
    PlaylistItem,
    PlaylistTrackItem,
    PlaylistsListResponse,
    PlaylistTracksListResponse,
    UpdatePlaylistRequestBody,
)
from services import playlist_service

router = APIRouter()


@router.get("/api/playlists", response_model=PlaylistsListResponse)
def list_playlists() -> PlaylistsListResponse:
    rows = playlist_service.get_playlists()
    return PlaylistsListResponse(playlists=[PlaylistItem(**row) for row in rows])


@router.post("/api/playlists", response_model=PlaylistItem)
def create_playlist(body: CreatePlaylistRequestBody = CreatePlaylistRequestBody()) -> PlaylistItem:
    row = playlist_service.create_playlist(body.name)
    return PlaylistItem(**row)


@router.patch("/api/playlists/{playlist_id}", response_model=PlaylistItem)
def update_playlist(playlist_id: str, body: UpdatePlaylistRequestBody) -> PlaylistItem:
    try:
        row = playlist_service.update_playlist_name(playlist_id, body.name)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PlaylistItem(**row)


@router.get("/api/playlists/{playlist_id}/tracks", response_model=PlaylistTracksListResponse)
def list_playlist_tracks(playlist_id: str) -> PlaylistTracksListResponse:
    try:
        rows = playlist_service.get_playlist_tracks(playlist_id)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PlaylistTracksListResponse(tracks=[PlaylistTrackItem(**row) for row in rows])


@router.post("/api/playlists/{playlist_id}/tracks", response_model=AddPlaylistTrackResponse)
async def add_playlist_track(playlist_id: str, file: UploadFile = File(...)) -> AddPlaylistTrackResponse:
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty upload")
    try:
        row = playlist_service.add_track(playlist_id, contents, file.filename)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AddPlaylistTrackResponse(track=PlaylistTrackItem(**row))


@router.get("/api/playlists/{playlist_id}/tracks/{track_id}/file")
def get_playlist_track_file(playlist_id: str, track_id: str) -> FileResponse:
    try:
        path, filename = playlist_service.get_track_mp4_path(playlist_id, track_id)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except playlist_service.TrackNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Track file not found on disk")
    return FileResponse(
        path=str(path),
        media_type="video/mp4",
        filename=filename,
    )


@router.delete("/api/playlists/{playlist_id}/tracks/{track_id}")
def delete_playlist_track(playlist_id: str, track_id: str) -> Response:
    try:
        playlist_service.delete_track(playlist_id, track_id)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except playlist_service.TrackNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)
