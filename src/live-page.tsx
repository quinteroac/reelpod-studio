import { VisualScene } from './components/visual-scene';

const LIVE_ASPECT_RATIO = 16 / 9;

export function LivePage() {
  return (
    <main className="min-h-screen bg-black" data-testid="live-page">
      <VisualScene
        imageUrl={null}
        audioCurrentTime={0}
        audioDuration={0}
        isPlaying={false}
        aspectRatio={LIVE_ASPECT_RATIO}
        visualizerType="none"
        effects={['none']}
        backgroundColor="#000000"
        showPlaceholderCopy={false}
        fullBleed
      />
    </main>
  );
}
