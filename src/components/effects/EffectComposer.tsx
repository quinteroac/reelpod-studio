import type { ComponentType } from 'react';
import { ChromaticAberrationEffect } from './ChromaticAberrationEffect';
import { ColorDriftEffect } from './ColorDriftEffect';
import { FilmGrainEffect } from './FilmGrainEffect';
import { FlickerEffect } from './FlickerEffect';
import { ScanLinesEffect } from './ScanLinesEffect';
import type { EffectProps, EffectType } from './types';
import { VignetteEffect } from './VignetteEffect';
import { ZoomEffect } from './ZoomEffect';

/**
 * Registry mapping each EffectType to its component.
 * To add a new effect, just add an entry here and to the EffectType union.
 */
const EFFECT_REGISTRY: Record<Exclude<EffectType, 'none'>, ComponentType<EffectProps>> = {
    zoom: ZoomEffect,
    flicker: FlickerEffect,
    vignette: VignetteEffect,
    filmGrain: FilmGrainEffect,
    chromaticAberration: ChromaticAberrationEffect,
    scanLines: ScanLinesEffect,
    colorDrift: ColorDriftEffect,
};

interface EffectComposerProps extends EffectProps {
    effects: EffectType[];
}

/**
 * Renders all active effects simultaneously via composition.
 * Each effect in the array is rendered as an independent component,
 * allowing them to stack freely.
 */
export function EffectComposer({ effects, ...props }: EffectComposerProps) {
    return (
        <>
            {effects
                .filter((e): e is Exclude<EffectType, 'none'> => e !== 'none')
                .map((effectType) => {
                    const EffectComponent = EFFECT_REGISTRY[effectType];
                    if (!EffectComponent) {
                        console.warn(`Effect type "${effectType}" is not registered. Skipping.`);
                        return null;
                    }
                    return <EffectComponent key={effectType} {...props} />;
                })}
        </>
    );
}
