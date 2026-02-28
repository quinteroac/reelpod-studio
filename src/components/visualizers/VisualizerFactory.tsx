import { WaveformVisualizer } from './WaveformVisualizer';
import type { VisualizerProps, VisualizerType } from './types';

interface VisualizerFactoryProps extends VisualizerProps {
    type: VisualizerType;
}

export function VisualizerFactory({ type, ...props }: VisualizerFactoryProps) {
    switch (type) {
        case 'waveform':
            return <WaveformVisualizer {...props} />;
        case 'none':
            return null;
        default:
            console.warn(`Visualizer type "${type}" is not implemented. Falling back to none.`);
            return null;
    }
}
