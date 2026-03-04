import { useEffect } from 'react';
import type { SongParameters } from '../mcp/parameter-store';

export const AGENT_GENERATION_STREAM_URL = '/mcp/generation/stream';

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
    const eventSource = new EventSource(AGENT_GENERATION_STREAM_URL);

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const command: GenerationCommand = JSON.parse(event.data);
        onGenerationCommand(command);
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      eventSource.close();
    };
  }, [onGenerationCommand]);
}
