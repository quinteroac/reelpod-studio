import { Elysia } from 'elysia';
import type { ServerWebSocket } from 'bun';
import { ParameterStore, type SongParameters } from './parameter-store.js';

const DEFAULT_PORT = 3100;

export interface GenerationCommand {
  parameters: SongParameters;
  imagePrompt: string;
  targetWidth: number;
  targetHeight: number;
}

export interface AgentCapabilities {
  visualizers: string[];
  effects: string[];
  activeVisualizer: string;
  activeEffects: string[];
}

type ServerMessage =
  | { type: 'parameters'; data: SongParameters }
  | { type: 'generation'; data: GenerationCommand }
  | { type: 'set_visualizer'; data: { visualizerType: string } }
  | { type: 'set_effects'; data: { effects: string[] } }
  | { type: 'record_queue' }
  | { type: 'publish_to_youtube'; data: { title?: string; description?: string } };

// ---------------------------------------------------------------------------
// Event system: browser → stdio long-poll
// ---------------------------------------------------------------------------

interface PendingEvent {
  type: string;
  data?: unknown;
}

const eventResolvers = new Map<string, Array<(e: PendingEvent) => void>>();
const eventQueue = new Map<string, PendingEvent[]>();

function waitForEvent(
  type: string,
  timeoutMs: number,
): Promise<PendingEvent | { type: 'timeout' }> {
  return new Promise((resolve) => {
    const queued = eventQueue.get(type);
    if (queued && queued.length > 0) {
      const event = queued.shift()!;
      if (queued.length === 0) eventQueue.delete(type);
      resolve(event);
      return;
    }

    const resolvers = eventResolvers.get(type) ?? [];

    const resolver = (event: PendingEvent) => {
      clearTimeout(timer);
      resolve(event);
    };

    const timer = setTimeout(() => {
      const idx = resolvers.indexOf(resolver);
      if (idx !== -1) resolvers.splice(idx, 1);
      if (resolvers.length === 0) eventResolvers.delete(type);
      resolve({ type: 'timeout' });
    }, timeoutMs);

    resolvers.push(resolver);
    eventResolvers.set(type, resolvers);
  });
}

function dispatchEvent(type: string, data?: unknown): void {
  const event: PendingEvent = { type, data };
  const resolvers = eventResolvers.get(type);
  if (resolvers && resolvers.length > 0) {
    const resolver = resolvers.shift()!;
    if (resolvers.length === 0) eventResolvers.delete(type);
    resolver(event);
    return;
  }
  const queue = eventQueue.get(type) ?? [];
  queue.push(event);
  eventQueue.set(type, queue);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const port = Number(process.env.MCP_PORT) || DEFAULT_PORT;
  const parameterStore = new ParameterStore();

  let capabilities: AgentCapabilities | null = null;
  const wsClients = new Set<ServerWebSocket<unknown>>();

  function broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const ws of wsClients) {
      ws.send(json);
    }
  }

  parameterStore.on('update', (params: SongParameters) => {
    broadcast({ type: 'parameters', data: params });
  });

  new Elysia()
    // ------------------------------------------------------------------
    // WebSocket — browser connects here for real-time commands/updates
    // ------------------------------------------------------------------
    .ws('/mcp/ws', {
      open(ws) {
        wsClients.add(ws.raw);
        const current = parameterStore.get();
        if (current) {
          ws.send(JSON.stringify({ type: 'parameters', data: current } satisfies ServerMessage));
        }
      },
      close(ws) {
        wsClients.delete(ws.raw);
      },
      message(_ws, _message) {
        // Reserved for future bidirectional use
      },
    })

    // ------------------------------------------------------------------
    // Capabilities — browser publishes available visualizers/effects + state
    // ------------------------------------------------------------------
    .post('/mcp/capabilities', ({ body }) => {
      capabilities = body as AgentCapabilities;
      return { status: 'ok' };
    })
    .get('/mcp/capabilities', () => {
      return (
        capabilities ?? {
          visualizers: [],
          effects: [],
          activeVisualizer: 'none',
          activeEffects: [],
        }
      );
    })

    // ------------------------------------------------------------------
    // Event notify — browser sends ACKs (generation_complete, recording_complete, etc.)
    // ------------------------------------------------------------------
    .post('/mcp/events/notify', ({ body }) => {
      const { type, data } = body as { type: string; data?: unknown };
      dispatchEvent(type, data);
      return { status: 'ok' };
    })

    // ------------------------------------------------------------------
    // Event poll — stdio MCP server waits for browser ACKs
    // ------------------------------------------------------------------
    .get('/mcp/events/poll', async ({ query }) => {
      const q = query as Record<string, string>;
      const type = q.event;
      const timeoutMs = Number(q.timeout) || 120_000;
      if (!type) return { type: 'error', message: 'Missing ?event= parameter' };
      return waitForEvent(type, timeoutMs);
    })

    // ------------------------------------------------------------------
    // Bridge: stdio MCP → WS broadcast (parameters & generation — existing)
    // ------------------------------------------------------------------
    .post('/mcp/parameters', ({ body }) => {
      parameterStore.set(body as SongParameters);
      return { status: 'ok' };
    })
    .post('/mcp/generate', ({ body }) => {
      broadcast({ type: 'generation', data: body as GenerationCommand });
      return { status: 'ok' };
    })

    // ------------------------------------------------------------------
    // Bridge: new commands → WS broadcast
    // ------------------------------------------------------------------
    .post('/mcp/visualizer', ({ body }) => {
      broadcast({ type: 'set_visualizer', data: body as { visualizerType: string } });
      return { status: 'ok' };
    })
    .post('/mcp/effects', ({ body }) => {
      broadcast({ type: 'set_effects', data: body as { effects: string[] } });
      return { status: 'ok' };
    })
    .post('/mcp/record', () => {
      broadcast({ type: 'record_queue' });
      return { status: 'ok' };
    })
    .post('/mcp/youtube', ({ body }) => {
      broadcast({
        type: 'publish_to_youtube',
        data: body as { title?: string; description?: string },
      });
      return { status: 'ok' };
    })

    .listen({ port, hostname: '127.0.0.1' });

  console.error(`MCP WebSocket server listening on ws://127.0.0.1:${port}/mcp/ws`);
}

main().catch((error) => {
  console.error('MCP WS server failed to start:', error);
  process.exit(1);
});
