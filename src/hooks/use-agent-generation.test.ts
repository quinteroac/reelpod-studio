import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentGeneration, AGENT_WS_URL, type GenerationCommand } from './use-agent-generation';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  readyState: number = 1; // WebSocket.OPEN

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = 3; // WebSocket.CLOSED
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

describe('useAgentGeneration', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it('creates a WebSocket connected to the agent WS URL', () => {
    const callback = vi.fn();
    renderHook(() => useAgentGeneration({ onGenerationCommand: callback }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe(AGENT_WS_URL);
  });

  it('calls onGenerationCommand when a generation message is received', () => {
    const callback = vi.fn();
    renderHook(() => useAgentGeneration({ onGenerationCommand: callback }));

    const command: GenerationCommand = {
      parameters: {
        duration: 60,
        mode: 'llm',
      },
      imagePrompt: 'sunset cafe',
      targetWidth: 1920,
      targetHeight: 1080,
    };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'generation', data: command }));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(command);
  });

  it('ignores messages of other types without calling the callback', () => {
    const callback = vi.fn();
    renderHook(() => useAgentGeneration({ onGenerationCommand: callback }));

    MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'parameters', data: {} }));

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores malformed messages without throwing', () => {
    const callback = vi.fn();
    renderHook(() => useAgentGeneration({ onGenerationCommand: callback }));

    MockWebSocket.instances[0].simulateMessage('not valid json');

    expect(callback).not.toHaveBeenCalled();
  });

  it('closes WebSocket on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() =>
      useAgentGeneration({ onGenerationCommand: callback })
    );

    const ws = MockWebSocket.instances[0];
    expect(ws.closed).toBe(false);

    unmount();
    expect(ws.closed).toBe(true);
  });
});
