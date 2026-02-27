import { createStrudelController, type StrudelController, type StrudelReplEngine } from './strudel';

declare global {
  interface Window {
    __strudelRepl?: StrudelReplEngine;
    webkitAudioContext?: unknown;
  }
}

function hasBrowserWebAudioSupport(): boolean {
  const audioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;
  return typeof audioContext === 'function' || typeof window.webkitAudioContext === 'function';
}

function resolveBrowserEngine(): StrudelReplEngine {
  const engine = window.__strudelRepl;
  if (!engine) {
    throw new Error('Strudel REPL is not available.');
  }

  return engine;
}

export function createBrowserStrudelController(): StrudelController {
  return createStrudelController({
    hasWebAudioSupport: hasBrowserWebAudioSupport,
    resolveEngine: resolveBrowserEngine
  });
}
