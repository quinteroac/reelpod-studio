import { useEffect, useState } from 'react';
import { VisualScene } from './components/visual-scene';
import {
  DEFAULT_LIVE_MIRROR_STATE,
  createLiveMirrorChannel,
  isLiveMirrorMessage
} from './lib/live-sync';

export function LivePage() {
  const [mirroredState, setMirroredState] = useState(DEFAULT_LIVE_MIRROR_STATE);

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

  return (
    <main className="min-h-screen bg-black" data-testid="live-page">
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
        fullBleed={mirroredState.fullBleed}
      />
    </main>
  );
}
