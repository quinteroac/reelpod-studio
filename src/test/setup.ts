import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Polyfill URL.createObjectURL / revokeObjectURL for jsdom
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:http://localhost/test';
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = () => {};
}

if (typeof globalThis.EventSource === 'undefined') {
  class EventSourceMock {
    url: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onopen: ((event: Event) => void) | null = null;
    readyState = 0;
    constructor(url: string) {
      this.url = url;
    }
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return false;
    }
  }
  globalThis.EventSource = EventSourceMock as unknown as typeof EventSource;
}

if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
});
