import { describe, expect, it } from 'vitest';
import { generatePattern } from './pattern-generator';

describe('generatePattern', () => {
  it('maps selected parameters into a Strudel pattern', () => {
    const pattern = generatePattern({ mood: 'melancholic', tempo: 95, style: 'ambient' });

    expect(pattern).toContain('bd ~ ~ sd');
    expect(pattern).toContain('~ hh ~ hh');
    expect(pattern).toContain('cpm(95)');
  });

  it('clamps tempo into the supported range', () => {
    expect(generatePattern({ mood: 'chill', tempo: 30, style: 'jazz' })).toContain('cpm(60)');
    expect(generatePattern({ mood: 'chill', tempo: 200, style: 'jazz' })).toContain('cpm(120)');
  });
});
