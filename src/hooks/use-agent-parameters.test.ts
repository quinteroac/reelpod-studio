import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentParameters, AGENT_WS_URL } from './use-agent-parameters';
import type { SongParameters } from '../mcp/parameter-store';

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

describe('useAgentParameters', () => {
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
    renderHook(() => useAgentParameters({ onParametersUpdate: callback }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe(AGENT_WS_URL);
  });

  it('calls onParametersUpdate when a parameters message is received', () => {
    const callback = vi.fn();
    renderHook(() => useAgentParameters({ onParametersUpdate: callback }));

    const params: SongParameters = {
      duration: 120,
      mode: 'llm',
      prompt: 'hip-hop track',
    };
    MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'parameters', data: params }));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(params);
  });

  it('ignores messages of other types without calling the callback', () => {
    const callback = vi.fn();
    renderHook(() => useAgentParameters({ onParametersUpdate: callback }));

    MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'generation', data: {} }));

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores malformed messages without throwing', () => {
    const callback = vi.fn();
    renderHook(() => useAgentParameters({ onParametersUpdate: callback }));

    MockWebSocket.instances[0].simulateMessage('not valid json');

    expect(callback).not.toHaveBeenCalled();
  });

  it('closes WebSocket on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() =>
      useAgentParameters({ onParametersUpdate: callback })
    );

    const ws = MockWebSocket.instances[0];
    expect(ws.closed).toBe(false);

    unmount();
    expect(ws.closed).toBe(true);
  });
});
