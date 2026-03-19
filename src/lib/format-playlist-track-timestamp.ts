/**
 * Formats persisted ISO8601 track timestamps for playlist UI (locale-aware).
 */
export function formatPlaylistTrackCreatedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms));
}
