import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './sanitize-filename';

describe('sanitizeFilename', () => {
  // AC01: lowercased
  it('lowercases the title', () => {
    expect(sanitizeFilename('Midnight Rain')).toBe('midnight_rain');
  });

  // AC01: spaces replaced with underscores
  it('replaces spaces with underscores', () => {
    expect(sanitizeFilename('lo fi chill')).toBe('lo_fi_chill');
  });

  // AC01: characters outside [a-z0-9_-] removed
  it('removes characters outside [a-z0-9_-]', () => {
    expect(sanitizeFilename('Song: A & B!')).toBe('song_a__b');
  });

  it('preserves hyphens', () => {
    expect(sanitizeFilename('lo-fi dream')).toBe('lo-fi_dream');
  });

  it('preserves underscores', () => {
    expect(sanitizeFilename('chill_wave 99')).toBe('chill_wave_99');
  });

  it('preserves numbers', () => {
    expect(sanitizeFilename('Track 01')).toBe('track_01');
  });

  // AC01: trimmed to 80 chars
  it('trims to 80 characters', () => {
    const long = 'a'.repeat(100);
    const result = sanitizeFilename(long);
    expect(result).toBe('a'.repeat(80));
  });

  it('returns a stem of exactly 80 chars when input is 80 chars', () => {
    const exactly80 = 'b'.repeat(80);
    expect(sanitizeFilename(exactly80)).toBe(exactly80);
  });

  // AC03: returns null for empty result
  it('returns null when title is empty string', () => {
    expect(sanitizeFilename('')).toBeNull();
  });

  it('returns null when title contains only non-allowed characters', () => {
    expect(sanitizeFilename('!!!###')).toBeNull();
  });

  // Representative end-to-end example
  it('produces midnight_rain_lofi from "Midnight Rain Lofi"', () => {
    expect(sanitizeFilename('Midnight Rain Lofi')).toBe('midnight_rain_lofi');
  });
});
