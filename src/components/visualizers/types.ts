export type VisualizerType = 'waveform' | 'rain' | 'none'; // easily extensible later

export type VisualizerProps = {
    audioCurrentTime: number;
    audioDuration: number;
    isPlaying: boolean;
    planeWidth: number;
    planeHeight: number;
    texture?: any; // THREE.Texture but avoiding big three imports here if simpler, or just any
};
