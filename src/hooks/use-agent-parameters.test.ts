import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentParameters, AGENT_PARAMETERS_STREAM_URL } from './use-agent-parameters';
import type { SongParameters } from '../mcp/parameter-store';

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

describe('useAgentParameters', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('creates an EventSource connected to the parameters stream URL', () => {
    const callback = vi.fn();
    renderHook(() => useAgentParameters({ onParametersUpdate: callback }));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(AGENT_PARAMETERS_STREAM_URL);
  });

  it('calls onParametersUpdate when a valid message is received', () => {
    const callback = vi.fn();
    renderHook(() => useAgentParameters({ onParametersUpdate: callback }));

    const params: SongParameters = {
      mood: 'upbeat',
      tempo: 100,
      style: 'hip-hop',
      duration: 120,
      mode: 'parameters',
    };
    MockEventSource.instances[0].simulateMessage(JSON.stringify(params));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(params);
  });

  it('ignores malformed messages without throwing', () => {
    const callback = vi.fn();
    renderHook(() => useAgentParameters({ onParametersUpdate: callback }));

    MockEventSource.instances[0].simulateMessage('not valid json');

    expect(callback).not.toHaveBeenCalled();
  });

  it('closes EventSource on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() =>
      useAgentParameters({ onParametersUpdate: callback })
    );

    const eventSource = MockEventSource.instances[0];
    expect(eventSource.closed).toBe(false);

    unmount();
    expect(eventSource.closed).toBe(true);
  });
});
