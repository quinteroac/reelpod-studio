import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ParameterStore, SongParameters } from './parameter-store.js';

const MIN_DURATION = 40;
const MAX_DURATION = 300;

const DEFAULT_BACKEND_BASE_URL = 'http://localhost:8000';
const DEFAULT_IMAGE_PROMPT = 'lofi artwork, warm colors';

const SOCIAL_FORMATS = {
  youtube: { width: 1920, height: 1080 },
  'tiktok-reels': { width: 1080, height: 1920 },
  'instagram-square': { width: 1080, height: 1080 },
} as const;

type SocialFormat = keyof typeof SOCIAL_FORMATS;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pollEvent(
  sseBaseUrl: string,
  event: string,
  timeoutMs: number,
): Promise<{ type: string; data?: unknown }> {
  const url = `${sseBaseUrl}/mcp/events/poll?event=${event}&timeout=${timeoutMs}`;
  const res = await fetch(url);
  return res.json() as Promise<{ type: string; data?: unknown }>;
}

async function getCapabilities(sseBaseUrl: string) {
  try {
    const res = await fetch(`${sseBaseUrl}/mcp/capabilities`);
    return res.json() as Promise<{
      visualizers: string[];
      effects: string[];
      activeVisualizer: string;
      activeEffects: string[];
    }>;
  } catch {
    return { visualizers: [], effects: [], activeVisualizer: 'none', activeEffects: [] };
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const { parameterStore, backendBaseUrl = DEFAULT_BACKEND_BASE_URL, sseBaseUrl } = options;
  const server = new McpServer({
    name: 'reelpod-studio',
    version: '1.0.0',
  });

  let lastGeneration: {
    parameters: SongParameters;
    imagePrompt: string;
    completed: boolean;
    addedToQueue: boolean;
  } | null = null;

  const queue: QueueEntry[] = [];
  let nextQueueId = 1;

  // -------------------------------------------------------------------------
  // set_song_parameters
  // -------------------------------------------------------------------------

  server.registerTool(
    'set_song_parameters',
    {
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
        prompt: z.string().optional().describe('Creative brief describing the desired concept'),
      },
    },
    async ({ duration, prompt }) => {
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
          // best-effort
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'parameters_set', parameters: params }),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // generate_audio
  // -------------------------------------------------------------------------

  server.registerTool(
    'generate_audio',
    {
      title: 'Generate Audio',
      description:
        'Trigger audio + video generation with the current parameters and wait for it to complete.',
      inputSchema: {
        imagePrompt: z
          .string()
          .optional()
          .describe('Prompt for the accompanying image (optional)'),
        socialFormat: z
          .enum(['youtube', 'tiktok-reels', 'instagram-square'])
          .optional()
          .describe('Output resolution preset. Defaults to youtube (1920×1080).'),
      },
    },
    async ({ imagePrompt, socialFormat }) => {
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
      const format = SOCIAL_FORMATS[(socialFormat as SocialFormat) ?? 'youtube'];

      if (sseBaseUrl) {
        try {
          const response = await fetch(`${sseBaseUrl}/mcp/generate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              parameters: params,
              imagePrompt: resolvedImagePrompt,
              targetWidth: format.width,
              targetHeight: format.height,
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
                    error: `Bridge returned status ${response.status}`,
                  }),
                },
              ],
            };
          }

          // Wait for the frontend to signal completion (up to 20 min)
          const event = await pollEvent(sseBaseUrl, 'generation_complete', 1_200_000);

          if (event.type === 'timeout') {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ status: 'timeout', error: 'Generation timed out' }),
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
                  status: 'completed',
                  format: socialFormat ?? 'youtube',
                  resolution: `${format.width}×${format.height}`,
                }),
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ status: 'failed', error: `Bridge error: ${message}` }),
              },
            ],
          };
        }
      }

      // Direct backend call (no bridge)
      try {
        const response = await fetch(`${backendBaseUrl}/api/generate-requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...params,
            imagePrompt: resolvedImagePrompt,
            targetWidth: format.width,
            targetHeight: format.height,
          }),
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
                  error: errorText ?? `Generation failed with status ${response.status}`,
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
            { type: 'text' as const, text: JSON.stringify({ status: 'completed' }) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        lastGeneration = {
          parameters: params,
          imagePrompt: resolvedImagePrompt,
          completed: false,
          addedToQueue: false,
        };
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: JSON.stringify({ status: 'failed', error: message }) },
          ],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_visualizers
  // -------------------------------------------------------------------------

  server.registerTool(
    'get_visualizers',
    {
      title: 'Get Visualizers',
      description:
        'Retrieve the list of available visualizer types and which one is currently active.',
    },
    async () => {
      const caps = sseBaseUrl ? await getCapabilities(sseBaseUrl) : null;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              available: caps?.visualizers ?? [],
              active: caps?.activeVisualizer ?? 'none',
            }),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // set_visualizer
  // -------------------------------------------------------------------------

  server.registerTool(
    'set_visualizer',
    {
      title: 'Set Visualizer',
      description: 'Set the active visualizer type in the UI.',
      inputSchema: {
        visualizerType: z
          .string()
          .describe('Visualizer type (use get_visualizers to see available options)'),
      },
    },
    async ({ visualizerType }) => {
      if (!sseBaseUrl) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'failed', error: 'Bridge not configured' }),
            },
          ],
        };
      }

      try {
        await fetch(`${sseBaseUrl}/mcp/visualizer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ visualizerType }),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'ok', visualizerType }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: JSON.stringify({ status: 'failed', error: message }) },
          ],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_effects
  // -------------------------------------------------------------------------

  server.registerTool(
    'get_effects',
    {
      title: 'Get Effects',
      description:
        'Retrieve the list of available visual effects and which ones are currently active.',
    },
    async () => {
      const caps = sseBaseUrl ? await getCapabilities(sseBaseUrl) : null;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              available: caps?.effects ?? [],
              active: caps?.activeEffects ?? [],
            }),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // set_effects
  // -------------------------------------------------------------------------

  server.registerTool(
    'set_effects',
    {
      title: 'Set Effects',
      description:
        'Activate a specific set of visual effects. Effects not in the list will be disabled.',
      inputSchema: {
        effects: z
          .array(z.string())
          .describe('List of effect names to activate (use get_effects to see available options)'),
      },
    },
    async ({ effects }) => {
      if (!sseBaseUrl) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'failed', error: 'Bridge not configured' }),
            },
          ],
        };
      }

      try {
        await fetch(`${sseBaseUrl}/mcp/effects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ effects }),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'ok', activeEffects: effects }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: JSON.stringify({ status: 'failed', error: message }) },
          ],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // record_queue
  // -------------------------------------------------------------------------

  server.registerTool(
    'record_queue',
    {
      title: 'Record Queue',
      description:
        'Start recording the full playback queue as a single video and wait for the recording to be ready for upload. Requires at least one completed entry in the queue.',
    },
    async () => {
      if (!sseBaseUrl) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'failed', error: 'Bridge not configured' }),
            },
          ],
        };
      }

      try {
        await fetch(`${sseBaseUrl}/mcp/record`, { method: 'POST' });

        // Wait for recording + backend MP4 conversion (up to 30 min)
        const event = await pollEvent(sseBaseUrl, 'recording_complete', 1_800_000);

        if (event.type === 'timeout') {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ status: 'timeout', error: 'Recording timed out' }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'recording_ready', ...((event.data as object) ?? {}) }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: JSON.stringify({ status: 'failed', error: message }) },
          ],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // publish_to_youtube
  // -------------------------------------------------------------------------

  server.registerTool(
    'publish_to_youtube',
    {
      title: 'Publish to YouTube',
      description:
        'Upload the most recently recorded video to YouTube. The user must have connected their YouTube account in the UI beforehand.',
      inputSchema: {
        title: z.string().optional().describe('YouTube video title'),
        description: z.string().optional().describe('YouTube video description'),
      },
    },
    async ({ title, description }) => {
      if (!sseBaseUrl) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'failed', error: 'Bridge not configured' }),
            },
          ],
        };
      }

      try {
        await fetch(`${sseBaseUrl}/mcp/youtube`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, description }),
        });

        // Wait for upload to complete (up to 10 min)
        const event = await pollEvent(sseBaseUrl, 'upload_complete', 600_000);

        if (event.type === 'timeout') {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ status: 'timeout', error: 'YouTube upload timed out' }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'published',
                ...((event.data as object) ?? {}),
              }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: JSON.stringify({ status: 'failed', error: message }) },
          ],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // add_to_queue
  // -------------------------------------------------------------------------

  server.registerTool(
    'add_to_queue',
    {
      title: 'Add to Queue',
      description: 'Add the most recently generated song to the playback queue.',
    },
    async () => {
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
    },
  );

  // -------------------------------------------------------------------------
  // get_queue
  // -------------------------------------------------------------------------

  server.registerTool(
    'get_queue',
    {
      title: 'Get Queue',
      description: 'Retrieve the current playback queue with all song metadata.',
    },
    async () => ({
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
    }),
  );

  return server;
}
