import {
  PLAYLISTS_ENDPOINT_PATH,
  playlistEndpoint,
  playlistTrackEndpoint,
  playlistTrackFileEndpoint,
  playlistTracksEndpoint,
} from '../api/constants';

export interface PlaylistTrack {
  id: string;
  filename: string;
  created_at: string;
  size_bytes: number;
}

export interface PlaylistItem {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
}

/** Same-origin URL for `<video src>` and download links. */
export function playlistTrackFileUrl(playlistId: string, trackId: string): string {
  return playlistTrackFileEndpoint(playlistId, trackId);
}

function parseErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const candidate = record.error ?? record.detail;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return null;
}

/**
 * Uploads an MP4 blob to the active playlist. Used after recording finalizes (MP4 path)
 * or after WebM→MP4 conversion (fallback path).
 */
export async function uploadPlaylistTrack(
  playlistId: string,
  blob: Blob,
  filename: string
): Promise<PlaylistTrack> {
  const formData = new FormData();
  formData.append('file', blob, filename);

  const res = await fetch(playlistTracksEndpoint(playlistId), {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let message = `Playlist upload failed (${res.status})`;
    try {
      const payload: unknown = await res.json();
      const parsed = parseErrorMessage(payload);
      if (parsed) {
        message = parsed;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const data: unknown = await res.json();
  if (
    typeof data !== 'object' ||
    data === null ||
    !('track' in data) ||
    typeof (data as { track: unknown }).track !== 'object' ||
    (data as { track: unknown }).track === null
  ) {
    throw new Error('Invalid playlist response');
  }
  const t = (data as { track: Record<string, unknown> }).track;
  const id = t.id;
  const fn = t.filename;
  const created = t.created_at;
  const size = t.size_bytes;
  if (
    typeof id !== 'string' ||
    typeof fn !== 'string' ||
    typeof created !== 'string' ||
    typeof size !== 'number'
  ) {
    throw new Error('Invalid track payload');
  }
  return { id, filename: fn, created_at: created, size_bytes: size };
}

/**
 * Fetches track rows for a playlist via GET /api/playlists/{id}/tracks.
 */
export async function fetchPlaylistTracks(playlistId: string): Promise<PlaylistTrack[]> {
  const res = await fetch(playlistTracksEndpoint(playlistId), { method: 'GET' });

  if (!res.ok) {
    let message = `Could not load playlist tracks (${res.status})`;
    try {
      const payload: unknown = await res.json();
      const parsed = parseErrorMessage(payload);
      if (parsed) {
        message = parsed;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const data: unknown = await res.json();
  if (typeof data !== 'object' || data === null || !('tracks' in data)) {
    throw new Error('Invalid playlist tracks response');
  }
  return parsePlaylistTracks((data as { tracks: unknown }).tracks);
}

/**
 * Creates a playlist via POST /api/playlists (default name "New Playlist").
 */
export async function createPlaylist(name = 'New Playlist'): Promise<PlaylistItem> {
  const res = await fetch(PLAYLISTS_ENDPOINT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    let message = `Could not create playlist (${res.status})`;
    try {
      const payload: unknown = await res.json();
      const parsed = parseErrorMessage(payload);
      if (parsed) {
        message = parsed;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const data: unknown = await res.json();
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid playlist response');
  }
  const row = data as Record<string, unknown>;
  const id = row.id;
  const plName = row.name;
  const tracksRaw = row.tracks;
  if (typeof id !== 'string' || typeof plName !== 'string') {
    throw new Error('Invalid playlist payload');
  }
  return {
    id,
    name: plName,
    tracks: parsePlaylistTracks(tracksRaw),
  };
}

function parsePlaylistTracks(raw: unknown): PlaylistTrack[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: PlaylistTrack[] = [];
  for (const t of raw) {
    if (typeof t !== 'object' || t === null) {
      continue;
    }
    const tr = t as Record<string, unknown>;
    if (
      typeof tr.id === 'string' &&
      typeof tr.filename === 'string' &&
      typeof tr.created_at === 'string' &&
      typeof tr.size_bytes === 'number'
    ) {
      out.push({
        id: tr.id,
        filename: tr.filename,
        created_at: tr.created_at,
        size_bytes: tr.size_bytes,
      });
    }
  }
  return out;
}

/**
 * Renames a playlist via PATCH /api/playlists/{id}.
 */
/**
 * Deletes a track via DELETE /api/playlists/{id}/tracks/{trackId}.
 */
export async function deletePlaylistTrack(playlistId: string, trackId: string): Promise<void> {
  const res = await fetch(playlistTrackEndpoint(playlistId, trackId), { method: 'DELETE' });

  if (!res.ok) {
    let message = `Could not delete track (${res.status})`;
    try {
      const payload: unknown = await res.json();
      const parsed = parseErrorMessage(payload);
      if (parsed) {
        message = parsed;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}

export async function patchPlaylistName(
  playlistId: string,
  name: string
): Promise<PlaylistItem> {
  const res = await fetch(playlistEndpoint(playlistId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    let message = `Could not rename playlist (${res.status})`;
    try {
      const payload: unknown = await res.json();
      const parsed = parseErrorMessage(payload);
      if (parsed) {
        message = parsed;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const data: unknown = await res.json();
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid playlist response');
  }
  const row = data as Record<string, unknown>;
  const id = row.id;
  const plName = row.name;
  const tracksRaw = row.tracks;
  if (typeof id !== 'string' || typeof plName !== 'string') {
    throw new Error('Invalid playlist payload');
  }
  return {
    id,
    name: plName,
    tracks: parsePlaylistTracks(tracksRaw),
  };
}
