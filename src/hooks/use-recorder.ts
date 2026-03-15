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
  target: BufferTarget | null;
  audioContext: AudioContext | null;
  mediaRecorder: MediaRecorder | null;
}

interface UseRecorderOptions {
  getCanvas: () => HTMLCanvasElement | null;
  getVideoElement: () => HTMLVideoElement | null;
  onStarted?: () => void;
  /** Called once the recording is finalised and ready for download. */
  onFinalized?: (blob: Blob, meta: { mimeType: string; fileExtension: string }) => void;
}

interface UseRecorderReturn {
  isRecording: boolean;
  isFinalizing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  recordingError: string | null;
  handlesRef: React.RefObject<RecorderHandles>;
}

// Preferred MIME types for the MediaRecorder fallback path (best → worst compatibility).
const MR_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export function useRecorder({
  getCanvas,
  getVideoElement,
  onStarted,
  onFinalized,
}: UseRecorderOptions): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const handlesRef = useRef<RecorderHandles>({
    output: null,
    target: null,
    audioContext: null,
    mediaRecorder: null,
  });
  const onFinalizedRef = useRef(onFinalized);
  onFinalizedRef.current = onFinalized;

  // Reuse the MediaElementAudioSourceNode: it can only be created once per element.
  const mediaSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const streamDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Accumulates chunks for the MediaRecorder path.
  const mrChunksRef = useRef<Blob[]>([]);

  /** Shared setup: canvas stream + AudioContext audio stream. Returns both tracks or null on error. */
  const setupStreams = useCallback(
    async (
      canvas: HTMLCanvasElement,
      video: HTMLVideoElement
    ): Promise<{ videoTrack: MediaStreamVideoTrack; audioTrack: MediaStreamAudioTrack } | null> => {
      // Canvas stream at 30 fps.
      const canvasStream = canvas.captureStream(30);
      const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamVideoTrack | undefined;
      if (!videoTrack) {
        setRecordingError('Failed to capture canvas video stream.');
        return null;
      }

      // AudioContext — create once and reuse.
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
        // Keep audio audible while routing into capture stream.
        mediaSourceNodeRef.current.connect(audioContext.destination);
        mediaSourceNodeRef.current.connect(streamDestinationRef.current);
      }

      const audioTrack = streamDestinationRef.current!.stream.getAudioTracks()[0] as
        | MediaStreamAudioTrack
        | undefined;
      if (!audioTrack) {
        setRecordingError('Failed to capture audio stream.');
        return null;
      }

      return { videoTrack, audioTrack };
    },
    []
  );

  const startRecording = useCallback(async () => {
    setRecordingError(null);

    const canvas = getCanvas();
    const video = getVideoElement();
    if (!canvas || !video) {
      setRecordingError('Recording is not available: canvas or audio element is not ready.');
      return;
    }

    // Cancel any leftover output from a previous run.
    if (handlesRef.current.output) {
      try { await handlesRef.current.output.cancel(); } catch { /* ignore */ }
      handlesRef.current.output = null;
    }

    const tracks = await setupStreams(canvas, video);
    if (!tracks) return;
    const { videoTrack, audioTrack } = tracks;

    // ── Path A: mediabunny H.264 + AAC → MP4 (best external-player compat) ─────
    const [avcOk, aacOk] = await Promise.all([
      canEncodeVideo('avc', { bitrate: 4e6 }),
      canEncodeAudio('aac', { bitrate: 128e3 }),
    ]);

    if (avcOk && aacOk) {
      const target = new BufferTarget();
      const output = new Output({ format: new Mp4OutputFormat(), target });
      handlesRef.current.output = output;
      handlesRef.current.target = target;

      output.addVideoTrack(
        new MediaStreamVideoTrackSource(videoTrack, { codec: 'avc', bitrate: 4_000_000 })
      );
      output.addAudioTrack(
        new MediaStreamAudioTrackSource(audioTrack, { codec: 'aac', bitrate: 128_000 })
      );

      await output.start();
      setIsRecording(true);
      onStarted?.();
      return;
    }

    // ── Path B: native MediaRecorder → WebM (reliable fallback for Linux/Firefox) ─
    const mimeType = MR_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
    if (!MediaRecorder.isTypeSupported(mimeType) && mimeType !== 'video/webm') {
      setRecordingError('Your browser does not support video recording. Try Chrome or Edge.');
      return;
    }

    mrChunksRef.current = [];
    const combinedStream = new MediaStream([videoTrack, audioTrack]);
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) mrChunksRef.current.push(e.data);
    };

    handlesRef.current.mediaRecorder = recorder;
    recorder.start();
    setIsRecording(true);
    onStarted?.();
  }, [getCanvas, getVideoElement, onStarted, setupStreams]);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    setIsFinalizing(true);

    try {
      const { output, target, mediaRecorder } = handlesRef.current;

      if (mediaRecorder) {
        // MediaRecorder path: wait for onstop to fire.
        await new Promise<void>((resolve) => {
          mediaRecorder.onstop = () => {
            const rawMime = mediaRecorder.mimeType.split(';')[0] || 'video/webm';
            const blob = new Blob(mrChunksRef.current, { type: rawMime });
            const fileExtension = rawMime.includes('mp4') ? '.mp4' : '.webm';
            onFinalizedRef.current?.(blob, { mimeType: rawMime, fileExtension });
            mrChunksRef.current = [];
            resolve();
          };
          mediaRecorder.stop();
        });
        handlesRef.current.mediaRecorder = null;
        return;
      }

      if (output && target) {
        // mediabunny path.
        await output.finalize();
        if (target.buffer) {
          const blob = new Blob([target.buffer], { type: 'video/mp4' });
          onFinalizedRef.current?.(blob, { mimeType: 'video/mp4', fileExtension: '.mp4' });
        }
        handlesRef.current.output = null;
        handlesRef.current.target = null;
      }
    } finally {
      setIsFinalizing(false);
    }
  }, []);

  return { isRecording, isFinalizing, startRecording, stopRecording, recordingError, handlesRef };
}
