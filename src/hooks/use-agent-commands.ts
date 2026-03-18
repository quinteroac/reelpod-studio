import { useEffect, useRef } from 'react';

export const AGENT_WS_URL = '/mcp/ws';

export interface AgentCommandCallbacks {
  onSetVisualizer: (type: string) => void;
  onSetEffects: (effects: string[]) => void;
  onRecordQueue: () => void;
  onPublishToYoutube: (opts: { title?: string; description?: string }) => void;
}

export function useAgentCommands(callbacks: AgentCommandCallbacks): void {
  // Keep a stable ref so the effect closure always calls the latest callbacks
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const ws = new WebSocket(AGENT_WS_URL);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; data?: unknown };

        switch (msg.type) {
          case 'set_visualizer': {
            const { visualizerType } = (msg.data ?? {}) as { visualizerType?: string };
            if (visualizerType) callbacksRef.current.onSetVisualizer(visualizerType);
            break;
          }
          case 'set_effects': {
            const { effects } = (msg.data ?? {}) as { effects?: string[] };
            if (Array.isArray(effects)) callbacksRef.current.onSetEffects(effects);
            break;
          }
          case 'record_queue': {
            callbacksRef.current.onRecordQueue();
            break;
          }
          case 'publish_to_youtube': {
            callbacksRef.current.onPublishToYoutube(
              (msg.data ?? {}) as { title?: string; description?: string },
            );
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
    };
  }, []);
}
