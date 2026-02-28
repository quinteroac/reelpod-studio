import { AuroraVisualizer } from './AuroraVisualizer';
import { CircleSpectrumVisualizer } from './CircleSpectrumVisualizer';
import { ContourVisualizer } from './ContourVisualizer';
import { GlitchVisualizer } from './GlitchVisualizer';
import { RainVisualizer } from './RainVisualizer';
import { SceneRainVisualizer } from './SceneRainVisualizer';
import { SmokeVisualizer } from './SmokeVisualizer';
import { StarfieldVisualizer } from './StarfieldVisualizer';
import { WaveformVisualizer } from './WaveformVisualizer';
import type { VisualizerProps, VisualizerType } from './types';

interface VisualizerFactoryProps extends VisualizerProps {
    type: VisualizerType;
}

export function VisualizerFactory({ type, ...props }: VisualizerFactoryProps) {
    switch (type) {
        case 'waveform':
            return <WaveformVisualizer {...props} />;
        case 'rain':
            return <RainVisualizer {...props} />;
        case 'scene-rain':
            return <SceneRainVisualizer {...props} />;
        case 'starfield':
            return <StarfieldVisualizer {...props} />;
        case 'aurora':
            return <AuroraVisualizer {...props} />;
        case 'circle-spectrum':
            return <CircleSpectrumVisualizer {...props} />;
        case 'glitch':
            return <GlitchVisualizer {...props} />;
        case 'smoke':
            return <SmokeVisualizer {...props} />;
        case 'contour':
            return <ContourVisualizer {...props} />;
        case 'none':
            return null;
        default:
            console.warn(`Visualizer type "${type}" is not implemented. Falling back to none.`);
            return null;
    }
}
