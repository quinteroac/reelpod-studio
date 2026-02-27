export type Mood = 'chill' | 'melancholic' | 'upbeat';
export type Style = 'jazz' | 'hip-hop' | 'ambient';

export interface GenerationParams {
  mood: Mood;
  tempo: number;
  style: Style;
}

const moodDrums: Record<Mood, string> = {
  chill: 'bd ~ sd ~',
  melancholic: 'bd ~ ~ sd',
  upbeat: 'bd bd sd ~'
};

const styleTexture: Record<Style, string> = {
  jazz: 'cp*2 hh*4',
  'hip-hop': 'cp hh*2',
  ambient: '~ hh ~ hh'
};

export function generatePattern(params: GenerationParams): string {
  const clampedTempo = Math.min(120, Math.max(60, Math.round(params.tempo)));

  return `stack([s("${moodDrums[params.mood]}") , s("${styleTexture[params.style]}")]).slow(2).gain(0.8).cpm(${clampedTempo})`;
}
