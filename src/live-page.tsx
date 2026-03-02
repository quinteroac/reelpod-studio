import { useEffect, useMemo, useState } from 'react';
import { VisualScene } from './components/visual-scene';
import {
  DEFAULT_LIVE_MIRROR_STATE,
  createLiveMirrorChannel,
  isLiveMirrorMessage
} from './lib/live-sync';

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}

const FORMAT_LABELS: Record<string, string> = {
  '1920x1080': 'YouTube 16:9',
  '1080x1920': 'TikTok / Reels 9:16',
  '1080x1080': 'Instagram 1:1'
};

export function LivePage() {
  const [mirroredState, setMirroredState] = useState(DEFAULT_LIVE_MIRROR_STATE);
  const viewport = useWindowSize();

  useEffect(() => {
    const channel = createLiveMirrorChannel();
    if (!channel) {
      return;
    }

    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isLiveMirrorMessage(event.data)) {
        return;
      }

      setMirroredState({
        imageUrl: event.data.imageUrl,
        audioCurrentTime: event.data.audioCurrentTime,
        audioDuration: event.data.audioDuration,
        isPlaying: event.data.isPlaying,
        aspectRatio: event.data.aspectRatio,
        outputWidth: event.data.outputWidth,
        outputHeight: event.data.outputHeight,
        visualizerType: event.data.visualizerType,
        effects: event.data.effects,
        backgroundColor: event.data.backgroundColor,
        showPlaceholderCopy: event.data.showPlaceholderCopy,
        fullBleed: event.data.fullBleed
      });
    };

    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, []);

  const { outputWidth, outputHeight } = mirroredState;

  // Scale the output frame to fit within the viewport with some padding
  const padding = 48;
  const scale = useMemo(() => {
    const maxW = viewport.width - padding * 2;
    const maxH = viewport.height - padding * 2;
    return Math.min(1, maxW / outputWidth, maxH / outputHeight);
  }, [viewport.width, viewport.height, outputWidth, outputHeight]);

  const displayWidth = Math.round(outputWidth * scale);
  const displayHeight = Math.round(outputHeight * scale);

  const formatLabel = FORMAT_LABELS[`${outputWidth}x${outputHeight}`]
    ?? `${outputWidth}×${outputHeight}`;

  return (
    <main
      className="fixed inset-0 m-0 flex flex-col items-center justify-center overflow-hidden bg-black"
      data-testid="live-page"
    >
      {/* Format badge */}
      <div className="absolute left-4 top-4 z-10 rounded bg-white/10 px-3 py-1 text-xs font-medium text-white/70 backdrop-blur-sm">
        {formatLabel} · {outputWidth}×{outputHeight}
      </div>

      {/* Canvas at exact output aspect ratio */}
      <div
        data-testid="live-output-frame"
        style={{ width: displayWidth, height: displayHeight }}
      >
        <VisualScene
          imageUrl={mirroredState.imageUrl}
          audioCurrentTime={mirroredState.audioCurrentTime}
          audioDuration={mirroredState.audioDuration}
          isPlaying={mirroredState.isPlaying}
          aspectRatio={mirroredState.aspectRatio}
          visualizerType={mirroredState.visualizerType}
          effects={mirroredState.effects}
          backgroundColor={mirroredState.backgroundColor}
          showPlaceholderCopy={mirroredState.showPlaceholderCopy}
          fullBleed
        />
      </div>
    </main>
  );
}
