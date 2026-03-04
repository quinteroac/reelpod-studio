import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentGeneration, AGENT_GENERATION_STREAM_URL, type GenerationCommand } from './use-agent-generation';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

describe('useAgentGeneration', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('creates an EventSource connected to the generation stream URL', () => {
    const callback = vi.fn();
    renderHook(() => useAgentGeneration({ onGenerationCommand: callback }));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(AGENT_GENERATION_STREAM_URL);
  });

  it('calls onGenerationCommand when a valid message is received', () => {
    const callback = vi.fn();
    renderHook(() => useAgentGeneration({ onGenerationCommand: callback }));

    const command: GenerationCommand = {
      parameters: {
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      },
      imagePrompt: 'sunset cafe',
      targetWidth: 1920,
      targetHeight: 1080,
    };
    MockEventSource.instances[0].simulateMessage(JSON.stringify(command));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(command);
  });

  it('ignores malformed messages without throwing', () => {
    const callback = vi.fn();
    renderHook(() => useAgentGeneration({ onGenerationCommand: callback }));

    MockEventSource.instances[0].simulateMessage('not valid json');

    expect(callback).not.toHaveBeenCalled();
  });

  it('closes EventSource on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() =>
      useAgentGeneration({ onGenerationCommand: callback })
    );

    const eventSource = MockEventSource.instances[0];
    expect(eventSource.closed).toBe(false);

    unmount();
    expect(eventSource.closed).toBe(true);
  });
});
