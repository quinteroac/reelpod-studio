import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ParameterStore, SongParameters } from './parameter-store.js';

const MIN_DURATION = 40;
const MAX_DURATION = 300;

const DEFAULT_BACKEND_BASE_URL = 'http://localhost:8000';
const DEFAULT_IMAGE_PROMPT = 'lofi artwork, warm colors';
const DEFAULT_TARGET_WIDTH = 1920;
const DEFAULT_TARGET_HEIGHT = 1080;

export interface QueueEntry {
  id: number;
  parameters: SongParameters;
  imagePrompt: string;
}

export interface CreateMcpServerOptions {
  parameterStore?: ParameterStore;
  backendBaseUrl?: string;
  sseBaseUrl?: string;
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const { parameterStore, backendBaseUrl = DEFAULT_BACKEND_BASE_URL, sseBaseUrl } = options;
  const server = new McpServer({
    name: 'reelpod-studio',
    version: '1.0.0',
  });

  // Tracks the last generation result so add_to_queue knows what to enqueue
  let lastGeneration: {
    parameters: SongParameters;
    imagePrompt: string;
    completed: boolean;
    addedToQueue: boolean;
  } | null = null;

  const queue: QueueEntry[] = [];
  let nextQueueId = 1;

  server.registerTool('set_song_parameters', {
    title: 'Set Song Parameters',
    description:
      'Set the song generation parameters: creative brief (prompt) and duration. Generation uses LLM orchestration only.',
    inputSchema: {
      duration: z
        .number()
        .int()
        .min(MIN_DURATION)
        .max(MAX_DURATION)
        .describe(`Duration in seconds (${MIN_DURATION}–${MAX_DURATION})`),
      prompt: z
        .string()
        .optional()
        .describe('Creative brief describing the desired concept'),
    },
  }, async ({ duration, prompt }) => {
    const params: SongParameters = { duration, mode: 'llm', prompt };

    if (parameterStore) {
      parameterStore.set(params);
    }

    if (sseBaseUrl) {
      try {
        await fetch(`${sseBaseUrl}/mcp/parameters`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
        });
      } catch {
        // SSE bridge is best-effort; don't fail the tool call
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'parameters_set',
            parameters: params,
          }),
        },
      ],
    };
  });

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
  }, async ({ imagePrompt }) => {
    const params = parameterStore?.get();
    if (!params) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'failed',
              error: 'No song parameters set. Call set_song_parameters first.',
            }),
          },
        ],
      };
    }

    const resolvedImagePrompt = imagePrompt ?? DEFAULT_IMAGE_PROMPT;
    const payload = {
      ...params,
      imagePrompt: resolvedImagePrompt,
      targetWidth: DEFAULT_TARGET_WIDTH,
      targetHeight: DEFAULT_TARGET_HEIGHT,
    };

    // When sseBaseUrl is configured, delegate generation to the frontend via SSE bridge
    // (fire-and-forget — the UI does the actual generation)
    if (sseBaseUrl) {
      try {
        const response = await fetch(`${sseBaseUrl}/mcp/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            parameters: params,
            imagePrompt: resolvedImagePrompt,
            targetWidth: DEFAULT_TARGET_WIDTH,
            targetHeight: DEFAULT_TARGET_HEIGHT,
          }),
        });

        if (!response.ok) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'failed',
                  error: `SSE bridge returned status ${response.status}`,
                }),
              },
            ],
          };
        }

        lastGeneration = {
          parameters: params,
          imagePrompt: resolvedImagePrompt,
          completed: true,
          addedToQueue: false,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'queued',
                message: 'Generation command sent to the UI. The frontend will generate and auto-play.',
              }),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'failed',
                error: `SSE bridge error: ${message}`,
              }),
            },
          ],
        };
      }
    }

    // Direct backend call (no SSE bridge)
    try {
      const response = await fetch(`${backendBaseUrl}/api/generate-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorText: string | null = null;
        try {
          const body: unknown = await response.json();
          if (typeof body === 'object' && body !== null) {
            const record = body as Record<string, unknown>;
            const candidate = record.error ?? record.detail;
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              errorText = candidate.trim();
            }
          }
        } catch {
          // ignore JSON parse errors for non-JSON error responses
        }

        lastGeneration = {
          parameters: params,
          imagePrompt: resolvedImagePrompt,
          completed: false,
          addedToQueue: false,
        };

        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'failed',
                error:
                  errorText ??
                  `Generation failed with status ${response.status}`,
              }),
            },
          ],
        };
      }

      lastGeneration = {
        parameters: params,
        imagePrompt: resolvedImagePrompt,
        completed: true,
        addedToQueue: false,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'completed' }),
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      lastGeneration = {
        parameters: params,
        imagePrompt: resolvedImagePrompt,
        completed: false,
        addedToQueue: false,
      };

      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'failed',
              error: message,
            }),
          },
        ],
      };
    }
  });

  server.registerTool('add_to_queue', {
    title: 'Add to Queue',
    description: 'Add the most recently generated song to the playback queue.',
  }, async () => {
    if (!lastGeneration) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'failed',
              error: 'No audio has been generated yet. Call generate_audio first.',
            }),
          },
        ],
      };
    }

    if (!lastGeneration.completed) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'failed',
              error: 'The last audio generation failed. Generate a new song before adding to the queue.',
            }),
          },
        ],
      };
    }

    if (lastGeneration.addedToQueue) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'failed',
              error: 'This song has already been added to the queue. Generate a new song first.',
            }),
          },
        ],
      };
    }

    const entry: QueueEntry = {
      id: nextQueueId++,
      parameters: { ...lastGeneration.parameters },
      imagePrompt: lastGeneration.imagePrompt,
    };

    queue.push(entry);
    lastGeneration.addedToQueue = true;

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'added_to_queue',
            songCount: queue.length,
            queue: queue.map((e) => ({
              id: e.id,
              parameters: e.parameters,
              imagePrompt: e.imagePrompt,
            })),
          }),
        },
      ],
    };
  });

  server.registerTool('get_queue', {
    title: 'Get Queue',
    description:
      'Retrieve the current playback queue with all song metadata.',
  }, async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          songCount: queue.length,
          queue: queue.map((e, index) => ({
            position: index + 1,
            name: e.parameters.prompt ?? 'Creative brief',
            duration: e.parameters.duration,
            id: e.id,
            parameters: e.parameters,
            imagePrompt: e.imagePrompt,
          })),
        }),
      },
    ],
  }));

  return server;
}
