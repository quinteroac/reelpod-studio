export const GENERATE_ENDPOINT_PATH = '/api/generate';
export const GENERATE_IMAGE_ENDPOINT_PATH = '/api/generate-image';
export const PLAYLISTS_ENDPOINT_PATH = '/api/playlists';

export function playlistEndpoint(playlistId: string): string {
  return `${PLAYLISTS_ENDPOINT_PATH}/${encodeURIComponent(playlistId)}`;
}

export function playlistTracksEndpoint(playlistId: string): string {
  return `${PLAYLISTS_ENDPOINT_PATH}/${encodeURIComponent(playlistId)}/tracks`;
}
