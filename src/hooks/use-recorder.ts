import { useCallback, useRef, useState } from 'react';
import {
  BufferTarget,
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo
} from 'mediabunny';

export interface RecorderHandles {
  output: Output | null;
  audioContext: AudioContext | null;
}

interface UseRecorderOptions {
  getCanvas: () => HTMLCanvasElement | null;
  getVideoElement: () => HTMLVideoElement | null;
  onStarted?: () => void;
}

interface UseRecorderReturn {
  isRecording: boolean;
  isFinalizing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  recordingError: string | null;
  handlesRef: React.RefObject<RecorderHandles>;
}

export function useRecorder({
  getCanvas,
  getVideoElement,
  onStarted
}: UseRecorderOptions): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const handlesRef = useRef<RecorderHandles>({ output: null, audioContext: null });
  // Reuse the MediaElementAudioSourceNode: it can only be created once per element
  const mediaSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const streamDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const startRecording = useCallback(async () => {
    setRecordingError(null);

    const canvas = getCanvas();
    const video = getVideoElement();

    if (!canvas || !video) {
      setRecordingError('Recording is not available: canvas or audio element is not ready.');
      return;
    }

    // AC07: codec pre-flight checks
    const [videoSupported, audioSupported] = await Promise.all([
      canEncodeVideo('avc'),
      canEncodeAudio('aac')
    ]);

    if (!videoSupported || !audioSupported) {
      const missing = [
        !videoSupported && 'H.264 video',
        !audioSupported && 'AAC audio'
      ]
        .filter(Boolean)
        .join(' and ');
      setRecordingError(
        `Your browser does not support recording: ${missing} encoding is not available.`
      );
      return;
    }

    // Cancel any previous output
    if (handlesRef.current.output) {
      try {
        await handlesRef.current.output.cancel();
      } catch {
        // ignore cleanup errors
      }
      handlesRef.current.output = null;
    }

    // AC04: capture canvas stream at 30 fps
    const canvasStream = canvas.captureStream(30);
    const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamVideoTrack | undefined;

    if (!videoTrack) {
      setRecordingError('Failed to capture canvas video stream.');
      return;
    }

    // AC05: audio capture via AudioContext
    if (!handlesRef.current.audioContext) {
      handlesRef.current.audioContext = new AudioContext();
    }
    const audioContext = handlesRef.current.audioContext;
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (!mediaSourceNodeRef.current) {
      mediaSourceNodeRef.current = audioContext.createMediaElementSource(video);
      streamDestinationRef.current = audioContext.createMediaStreamDestination();
      // Keep audio audible while also routing it into the capture stream
      mediaSourceNodeRef.current.connect(audioContext.destination);
      mediaSourceNodeRef.current.connect(streamDestinationRef.current);
    }

    const audioStream = streamDestinationRef.current!.stream;
    const audioTrack = audioStream.getAudioTracks()[0] as MediaStreamAudioTrack | undefined;

    if (!audioTrack) {
      setRecordingError('Failed to capture audio stream.');
      return;
    }

    // AC03: create Output with Mp4OutputFormat and BufferTarget
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat(),
      target
    });
    handlesRef.current.output = output;

    // AC04: video track source — avc codec at 4 Mbps
    const videoSource = new MediaStreamVideoTrackSource(videoTrack, {
      codec: 'avc',
      bitrate: 4_000_000
    });

    // AC05: audio track source — aac codec at 128 kbps
    const audioSource = new MediaStreamAudioTrackSource(audioTrack, {
      codec: 'aac',
      bitrate: 128_000
    });

    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);

    // AC06: start output after both tracks are added
    await output.start();

    setIsRecording(true);
    onStarted?.();
  }, [getCanvas, getVideoElement, onStarted]);

  const stopRecording = useCallback(async () => {
    const output = handlesRef.current.output;
    if (!output) return;

    setIsRecording(false);
    setIsFinalizing(true);
    try {
      await output.finalize();
    } finally {
      setIsFinalizing(false);
      handlesRef.current.output = null;
    }
  }, []);

  return { isRecording, isFinalizing, startRecording, stopRecording, recordingError, handlesRef };
}
