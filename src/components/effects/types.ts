export type EffectType = 'zoom' | 'flicker' | 'vignette' | 'filmGrain' | 'chromaticAberration' | 'scanLines' | 'colorDrift' | 'none';

export type EffectProps = {
    audioCurrentTime: number;
    audioDuration: number;
    isPlaying: boolean;
    texture?: any;
};
