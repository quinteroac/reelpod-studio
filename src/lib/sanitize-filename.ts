const MAX_FILENAME_LENGTH = 80;

/**
 * Sanitizes a song title for use as a filename stem:
 * - lowercased
 * - spaces replaced with underscores
 * - characters outside [a-z0-9_-] removed
 * - trimmed to MAX_FILENAME_LENGTH characters
 *
 * Returns null if the result is empty.
 */
export function sanitizeFilename(title: string): string | null {
  const sanitized = title
    .toLowerCase()
    .replace(/ /g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_FILENAME_LENGTH);

  return sanitized.length > 0 ? sanitized : null;
}
