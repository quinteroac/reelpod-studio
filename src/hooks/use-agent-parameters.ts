import { useEffect } from 'react';
import type { SongParameters } from '../mcp/parameter-store';

export const AGENT_PARAMETERS_STREAM_URL = '/mcp/parameters/stream';

export interface UseAgentParametersCallbacks {
  onParametersUpdate: (params: SongParameters) => void;
}

export function useAgentParameters({ onParametersUpdate }: UseAgentParametersCallbacks): void {
  useEffect(() => {
    const eventSource = new EventSource(AGENT_PARAMETERS_STREAM_URL);

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const params: SongParameters = JSON.parse(event.data);
        onParametersUpdate(params);
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      eventSource.close();
    };
  }, [onParametersUpdate]);
}
