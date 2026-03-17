import { useEffect } from 'react';
import type { SongParameters } from '../mcp/parameter-store';

export const AGENT_WS_URL = '/mcp/ws';

export interface UseAgentParametersCallbacks {
  onParametersUpdate: (params: SongParameters) => void;
}

export function useAgentParameters({ onParametersUpdate }: UseAgentParametersCallbacks): void {
  useEffect(() => {
    const ws = new WebSocket(AGENT_WS_URL);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: unknown = JSON.parse(event.data as string);
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as Record<string, unknown>).type === 'parameters'
        ) {
          onParametersUpdate((msg as Record<string, unknown>).data as SongParameters);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
    };
  }, [onParametersUpdate]);
}
