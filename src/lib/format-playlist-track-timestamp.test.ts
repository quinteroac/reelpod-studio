import { describe, expect, it } from 'vitest';

import { formatPlaylistTrackCreatedAt } from './format-playlist-track-timestamp';

describe('formatPlaylistTrackCreatedAt', () => {
  it('returns the raw string when the value is not a valid date', () => {
    expect(formatPlaylistTrackCreatedAt('not-a-date')).toBe('not-a-date');
  });

  it('formats valid ISO timestamps', () => {
    const out = formatPlaylistTrackCreatedAt('2024-06-15T14:30:00Z');
    expect(out.length).toBeGreaterThan(4);
    expect(out).not.toBe('2024-06-15T14:30:00Z');
  });
});
