export const GENERATE_ENDPOINT_PATH = '/api/generate';
export const GENERATE_IMAGE_ENDPOINT_PATH = '/api/generate-image';
export const PLAYLISTS_ENDPOINT_PATH = '/api/playlists';

export function playlistEndpoint(playlistId: string): string {
  return `${PLAYLISTS_ENDPOINT_PATH}/${encodeURIComponent(playlistId)}`;
}

export function playlistTracksEndpoint(playlistId: string): string {
  return `${PLAYLISTS_ENDPOINT_PATH}/${encodeURIComponent(playlistId)}/tracks`;
}

/** Single track resource: `DELETE /api/playlists/{id}/tracks/{trackId}` */
export function playlistTrackEndpoint(playlistId: string, trackId: string): string {
  return `${playlistTracksEndpoint(playlistId)}/${encodeURIComponent(trackId)}`;
}

/** MP4 bytes: `GET /api/playlists/{id}/tracks/{trackId}/file` */
export function playlistTrackFileEndpoint(playlistId: string, trackId: string): string {
  return `${playlistTrackEndpoint(playlistId, trackId)}/file`;
}
