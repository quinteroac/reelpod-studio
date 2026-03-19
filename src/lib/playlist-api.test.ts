import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPlaylist,
  deletePlaylistTrack,
  fetchPlaylistTracks,
  patchPlaylistName,
  playlistTrackFileUrl,
  uploadPlaylistTrack,
} from './playlist-api';

describe('uploadPlaylistTrack', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('US-002-AC04: throws with server error message when response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Disk full' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadPlaylistTrack('pl-1', new Blob([new Uint8Array([1])], { type: 'video/mp4' }), 'a.mp4'),
    ).rejects.toThrow(/Disk full/);
  });

  it('US-002-AC01: POSTs FormData to playlist tracks URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        track: {
          id: 't1',
          filename: 'a.mp4',
          created_at: '2020-01-01T00:00:00Z',
          size_bytes: 4,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' });
    const track = await uploadPlaylistTrack('my-playlist-id', blob, 'a.mp4');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playlists/my-playlist-id/tracks',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(track.id).toBe('t1');
    expect(track.size_bytes).toBe(4);
  });

  it('US-003-AC02: PATCHes playlist endpoint with JSON name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'pl-1',
        name: 'Lofi Session March',
        tracks: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const pl = await patchPlaylistName('pl-1', 'Lofi Session March');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playlists/pl-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Lofi Session March' }),
      }),
    );
    expect(pl.name).toBe('Lofi Session March');
  });
});

describe('fetchPlaylistTracks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('US-004-AC04: GETs /api/playlists/{id}/tracks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tracks: [
          {
            id: 't1',
            filename: 'a.mp4',
            created_at: '2020-01-01T00:00:00Z',
            size_bytes: 10,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('pl-99');

    expect(fetchMock).toHaveBeenCalledWith('/api/playlists/pl-99/tracks', { method: 'GET' });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].filename).toBe('a.mp4');
  });
});

describe('createPlaylist', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('US-004-AC01: POSTs /api/playlists with default name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'new-id',
        name: 'New Playlist',
        tracks: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const pl = await createPlaylist();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playlists',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New Playlist' }),
      }),
    );
    expect(pl.id).toBe('new-id');
  });
});

describe('playlistTrackFileUrl', () => {
  it('US-005-AC02: matches GET /api/playlists/{playlist}/tracks/{track}/file', () => {
    expect(playlistTrackFileUrl('pl-x', 'tr-y')).toBe('/api/playlists/pl-x/tracks/tr-y/file');
  });
});

describe('deletePlaylistTrack', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('US-005-AC04: sends DELETE to the track resource', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await deletePlaylistTrack('pl-1', 'tr-9');

    expect(fetchMock).toHaveBeenCalledWith('/api/playlists/pl-1/tracks/tr-9', { method: 'DELETE' });
  });
});
