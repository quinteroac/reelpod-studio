import { describe, expect, it } from 'vitest';
import { buildWaveformPositions, computeContainScale, computeWaveformPhase } from './visual-scene';

describe('visual scene utilities', () => {
  it('computes a fit-to-canvas contain scale for wide and tall images', () => {
    expect(computeContainScale(8, 4, 1600, 800)).toEqual([8, 4]);
    expect(computeContainScale(8, 4, 800, 1600)).toEqual([2, 4]);
  });

  it('derives waveform phase from both playback progress and animation time', () => {
    const syncedPhase = computeWaveformPhase(0.5, 0);
    const animatedPhase = computeWaveformPhase(0.5, 1.25);

    expect(syncedPhase).toBeCloseTo(Math.PI * 4);
    expect(animatedPhase).toBeGreaterThan(syncedPhase);
    expect(computeWaveformPhase(10, -2)).toBeCloseTo(Math.PI * 8);
  });

  it('builds waveform coordinates as xyz triples across the scene width', () => {
    const positions = buildWaveformPositions(12, 6, 0.8, Math.PI / 2);

    expect(positions).toBeInstanceOf(Float32Array);
    expect(positions.length).toBe(36);
    expect(positions[0]).toBeCloseTo(-3);
    expect(positions[33]).toBeCloseTo(3);
  });
});
