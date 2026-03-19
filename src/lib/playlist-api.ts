import { playlistTracksEndpoint } from '../api/constants';

export interface PlaylistTrack {
  id: string;
  filename: string;
  created_at: string;
  size_bytes: number;
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
