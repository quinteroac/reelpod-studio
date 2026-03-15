import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted so these are available when vi.mock factory runs (hoisted to top of file)
const {
  mockOutputStart,
  mockOutputAddVideoTrack,
  mockOutputAddAudioTrack,
  mockOutputCancel,
  mockOutputFinalize,
  MockOutput,
  MockMp4OutputFormat,
  MockBufferTarget,
  MockMediaStreamVideoTrackSource,
  MockMediaStreamAudioTrackSource,
  mockCanEncodeVideo,
  mockCanEncodeAudio
} = vi.hoisted(() => {
  const mockOutputStart = vi.fn().mockResolvedValue(undefined);
  const mockOutputAddVideoTrack = vi.fn();
  const mockOutputAddAudioTrack = vi.fn();
  const mockOutputCancel = vi.fn().mockResolvedValue(undefined);
  const mockOutputFinalize = vi.fn().mockResolvedValue(undefined);

  const MockOutput = vi.fn().mockImplementation(() => ({
    start: mockOutputStart,
    addVideoTrack: mockOutputAddVideoTrack,
    addAudioTrack: mockOutputAddAudioTrack,
    cancel: mockOutputCancel,
    finalize: mockOutputFinalize,
    state: 'pending'
  }));

  const MockMp4OutputFormat = vi.fn();
  const MockBufferTarget = vi.fn();
  const MockMediaStreamVideoTrackSource = vi.fn().mockImplementation(() => ({}));
  const MockMediaStreamAudioTrackSource = vi.fn().mockImplementation(() => ({}));
  const mockCanEncodeVideo = vi.fn().mockResolvedValue(true);
  const mockCanEncodeAudio = vi.fn().mockResolvedValue(true);

  return {
    mockOutputStart,
    mockOutputAddVideoTrack,
    mockOutputAddAudioTrack,
    mockOutputCancel,
    mockOutputFinalize,
    MockOutput,
    MockMp4OutputFormat,
    MockBufferTarget,
    MockMediaStreamVideoTrackSource,
    MockMediaStreamAudioTrackSource,
    mockCanEncodeVideo,
    mockCanEncodeAudio
  };
});

vi.mock('mediabunny', () => ({
  Output: MockOutput,
  Mp4OutputFormat: MockMp4OutputFormat,
  BufferTarget: MockBufferTarget,
  MediaStreamVideoTrackSource: MockMediaStreamVideoTrackSource,
  MediaStreamAudioTrackSource: MockMediaStreamAudioTrackSource,
  canEncodeVideo: mockCanEncodeVideo,
  canEncodeAudio: mockCanEncodeAudio
}));

import { useRecorder } from './use-recorder';

// --- Browser API mocks ---
function createMockVideoTrack(): MediaStreamVideoTrack {
  return { kind: 'video', stop: vi.fn() } as unknown as MediaStreamVideoTrack;
}

function createMockAudioTrack(): MediaStreamAudioTrack {
  return { kind: 'audio', stop: vi.fn() } as unknown as MediaStreamAudioTrack;
}

function createMockCanvas(): HTMLCanvasElement {
  const videoTrack = createMockVideoTrack();
  const mockStream = {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => []
  } as unknown as MediaStream;

  return {
    captureStream: vi.fn().mockReturnValue(mockStream)
  } as unknown as HTMLCanvasElement;
}

function createMockAudioStream(): MediaStream {
  const audioTrack = createMockAudioTrack();
  return {
    getAudioTracks: () => [audioTrack]
  } as unknown as MediaStream;
}

function createMockVideoElement(): HTMLVideoElement {
  return {
    currentTime: 0,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn()
  } as unknown as HTMLVideoElement;
}

function setupAudioContextMock(): void {
  const mockDestination = {
    stream: createMockAudioStream()
  } as unknown as MediaStreamAudioDestinationNode;

  const mockSource = {
    connect: vi.fn()
  } as unknown as MediaElementAudioSourceNode;

  const MockAudioContext = vi.fn().mockImplementation(() => ({
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    destination: {},
    createMediaElementSource: vi.fn().mockReturnValue(mockSource),
    createMediaStreamDestination: vi.fn().mockReturnValue(mockDestination)
  }));

  vi.stubGlobal('AudioContext', MockAudioContext);
}

describe('useRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanEncodeVideo.mockResolvedValue(true);
    mockCanEncodeAudio.mockResolvedValue(true);
    mockOutputFinalize.mockResolvedValue(undefined);
    setupAudioContextMock();
  });

  it('AC01: isRecording starts as false', () => {
    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );
    expect(result.current.isRecording).toBe(false);
  });

  it('AC07: sets recordingError when video codec is not supported', async () => {
    mockCanEncodeVideo.mockResolvedValue(false);
    mockCanEncodeAudio.mockResolvedValue(true);

    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.recordingError).toMatch(/H\.264 video/);
    expect(result.current.isRecording).toBe(false);
    expect(mockCanEncodeVideo).toHaveBeenCalledWith('avc');
  });

  it('AC07: sets recordingError when audio codec is not supported', async () => {
    mockCanEncodeVideo.mockResolvedValue(true);
    mockCanEncodeAudio.mockResolvedValue(false);

    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.recordingError).toMatch(/AAC audio/);
    expect(result.current.isRecording).toBe(false);
    expect(mockCanEncodeAudio).toHaveBeenCalledWith('aac');
  });

  it('AC03 + AC04 + AC05 + AC06: creates Output with Mp4OutputFormat and BufferTarget, sets up tracks, calls start()', async () => {
    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    // AC03: Output created with Mp4OutputFormat and BufferTarget
    expect(MockOutput).toHaveBeenCalledWith({
      format: expect.any(Object),
      target: expect.any(Object)
    });
    expect(MockMp4OutputFormat).toHaveBeenCalled();
    expect(MockBufferTarget).toHaveBeenCalled();

    // AC04: canvas.captureStream(30) called
    expect(canvas.captureStream).toHaveBeenCalledWith(30);
    // AC04: MediaStreamVideoTrackSource with avc at 4 Mbps
    expect(MockMediaStreamVideoTrackSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ codec: 'avc', bitrate: 4_000_000 })
    );

    // AC05: MediaStreamAudioTrackSource with aac at 128 kbps
    expect(MockMediaStreamAudioTrackSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ codec: 'aac', bitrate: 128_000 })
    );

    // Video and audio tracks added to output
    expect(mockOutputAddVideoTrack).toHaveBeenCalled();
    expect(mockOutputAddAudioTrack).toHaveBeenCalled();

    // AC06: output.start() called
    expect(mockOutputStart).toHaveBeenCalled();

    // isRecording is true after start
    expect(result.current.isRecording).toBe(true);
  });

  it('sets recordingError when canvas is not available', async () => {
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => null, getVideoElement: () => video })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.recordingError).toBeTruthy();
    expect(result.current.isRecording).toBe(false);
  });

  it('US-002-AC01: stopRecording calls output.finalize()', async () => {
    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      await result.current.stopRecording();
    });

    expect(mockOutputFinalize).toHaveBeenCalledTimes(1);
    expect(result.current.isRecording).toBe(false);
  });

  it('US-002-AC03: isFinalizing is true during finalization and false after', async () => {
    const canvas = createMockCanvas();
    const video = createMockVideoElement();

    let resolveFinalizing!: () => void;
    mockOutputFinalize.mockImplementation(
      () => new Promise<void>((resolve) => { resolveFinalizing = resolve; })
    );

    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    // Start stopRecording but don't await — check intermediate state
    act(() => {
      void result.current.stopRecording();
    });

    expect(result.current.isFinalizing).toBe(true);
    expect(result.current.isRecording).toBe(false);

    await act(async () => {
      resolveFinalizing();
    });

    expect(result.current.isFinalizing).toBe(false);
  });

  it('US-002: isFinalizing starts as false', () => {
    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );
    expect(result.current.isFinalizing).toBe(false);
  });

  it('US-002: stopRecording is a no-op when not recording', async () => {
    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video })
    );

    await act(async () => {
      await result.current.stopRecording();
    });

    expect(mockOutputFinalize).not.toHaveBeenCalled();
    expect(result.current.isFinalizing).toBe(false);
  });

  it('calls onStarted callback after recording begins', async () => {
    const canvas = createMockCanvas();
    const video = createMockVideoElement();
    const onStarted = vi.fn();
    const { result } = renderHook(() =>
      useRecorder({ getCanvas: () => canvas, getVideoElement: () => video, onStarted })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(onStarted).toHaveBeenCalledTimes(1);
  });
});
