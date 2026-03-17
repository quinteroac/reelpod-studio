import { useEffect } from 'react';
import type { SongParameters } from '../mcp/parameter-store';

export const AGENT_WS_URL = '/mcp/ws';

export interface GenerationCommand {
  parameters: SongParameters;
  imagePrompt: string;
  targetWidth: number;
  targetHeight: number;
}

export interface UseAgentGenerationCallbacks {
  onGenerationCommand: (command: GenerationCommand) => void;
}

export function useAgentGeneration({ onGenerationCommand }: UseAgentGenerationCallbacks): void {
  useEffect(() => {
    const ws = new WebSocket(AGENT_WS_URL);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: unknown = JSON.parse(event.data as string);
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as Record<string, unknown>).type === 'generation'
        ) {
          onGenerationCommand((msg as Record<string, unknown>).data as GenerationCommand);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
    };
  }, [onGenerationCommand]);
}
