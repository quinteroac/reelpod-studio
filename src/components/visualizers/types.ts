export type VisualizerType = 'waveform' | 'none'; // easily extensible later

export type VisualizerProps = {
    audioCurrentTime: number;
    audioDuration: number;
    isPlaying: boolean;
    planeWidth: number;
    planeHeight: number;
};
