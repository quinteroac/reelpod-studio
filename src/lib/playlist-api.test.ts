import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadPlaylistTrack } from './playlist-api';

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
});
