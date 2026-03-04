import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const MOODS = ['chill', 'melancholic', 'upbeat'] as const;
const STYLES = ['jazz', 'hip-hop', 'ambient'] as const;
const MODES = ['text', 'text-and-parameters', 'parameters'] as const;

const MIN_TEMPO = 60;
const MAX_TEMPO = 120;
const MIN_DURATION = 40;
const MAX_DURATION = 300;

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'reelpod-studio',
    version: '1.0.0',
  });

  server.registerTool('set_song_parameters', {
    title: 'Set Song Parameters',
    description:
      'Set the song generation parameters including mood, tempo, style, duration, generation mode, and prompt.',
    inputSchema: {
      mood: z.enum(MOODS).describe('The mood of the song'),
      tempo: z
        .number()
        .int()
        .min(MIN_TEMPO)
        .max(MAX_TEMPO)
        .describe(`Tempo in BPM (${MIN_TEMPO}–${MAX_TEMPO})`),
      style: z.enum(STYLES).describe('The musical style'),
      duration: z
        .number()
        .int()
        .min(MIN_DURATION)
        .max(MAX_DURATION)
        .describe(`Duration in seconds (${MIN_DURATION}–${MAX_DURATION})`),
      mode: z
        .enum(MODES)
        .optional()
        .describe('Generation mode: text, text-and-parameters, or parameters'),
      prompt: z
        .string()
        .optional()
        .describe('Text prompt describing the desired song'),
    },
  }, async ({ mood, tempo, style, duration, mode, prompt }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ mood, tempo, style, duration, mode, prompt }),
      },
    ],
  }));

  server.registerTool('generate_audio', {
    title: 'Generate Audio',
    description:
      'Trigger audio generation with the current parameters and wait for it to complete.',
    inputSchema: {
      imagePrompt: z
        .string()
        .optional()
        .describe('Prompt for the accompanying image (optional)'),
    },
  }, async ({ imagePrompt }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ status: 'generation_started', imagePrompt }),
      },
    ],
  }));

  server.registerTool('add_to_queue', {
    title: 'Add to Queue',
    description: 'Add the most recently generated song to the playback queue.',
  }, async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ status: 'added_to_queue' }),
      },
    ],
  }));

  server.registerTool('get_queue', {
    title: 'Get Queue',
    description:
      'Retrieve the current playback queue with status of each entry.',
  }, async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ queue: [] }),
      },
    ],
  }));

  return server;
}
