const PHASE_SYNC_MULTIPLIER = Math.PI * 8;
const PHASE_ANIMATION_SPEED = 2;

export function computeContainScale(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number
): [number, number] {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return [1, 1];
  }

  const imageAspect = imageWidth / imageHeight;
  const viewportAspect = viewportWidth / viewportHeight;

  if (imageAspect > viewportAspect) {
    return [viewportWidth, viewportWidth / imageAspect];
  }

  return [viewportHeight * imageAspect, viewportHeight];
}

export function computeWaveformPhase(playbackProgress: number, animationSeconds: number): number {
  const normalizedProgress = Math.min(Math.max(playbackProgress, 0), 1);
  const safeAnimationSeconds = Math.max(animationSeconds, 0);
  return normalizedProgress * PHASE_SYNC_MULTIPLIER + safeAnimationSeconds * PHASE_ANIMATION_SPEED;
}

export function buildWaveformPositions(
  sampleCount: number,
  width: number,
  amplitude: number,
  phase: number
): Float32Array {
  const clampedSamples = Math.max(sampleCount, 2);
  const clampedWidth = Math.max(width, 0.1);
  const clampedAmplitude = Math.max(amplitude, 0.01);
  const positions = new Float32Array(clampedSamples * 3);

  for (let index = 0; index < clampedSamples; index += 1) {
    const ratio = index / (clampedSamples - 1);
    const x = ratio * clampedWidth - clampedWidth / 2;
    const primary = Math.sin(ratio * Math.PI * 10 + phase);
    const secondary = Math.sin(ratio * Math.PI * 24 + phase * 1.4);
    const y = (primary * 0.65 + secondary * 0.35) * clampedAmplitude;

    const positionOffset = index * 3;
    positions[positionOffset] = x;
    positions[positionOffset + 1] = y;
    positions[positionOffset + 2] = 0;
  }

  return positions;
}
