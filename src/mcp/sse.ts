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

type ServerMessage =
  | { type: 'parameters'; data: SongParameters }
  | { type: 'generation'; data: GenerationCommand };

async function main() {
  const port = Number(process.env.MCP_PORT) || DEFAULT_PORT;
  const parameterStore = new ParameterStore();

  // Track active WebSocket clients for broadcast
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
    // WebSocket endpoint — browser connects here for real-time agent updates
    .ws('/mcp/ws', {
      open(ws) {
        wsClients.add(ws.raw);
        // Push current parameters immediately so the UI is in sync on connect
        const current = parameterStore.get();
        if (current) {
          ws.send(JSON.stringify({ type: 'parameters', data: current } satisfies ServerMessage));
        }
      },
      close(ws) {
        wsClients.delete(ws.raw);
      },
      message(_ws, _message) {
        // Reserved for ACK / bidirectional messages from browser
      },
    })

    // Bridge: stdio MCP server POSTs parameter updates → store + WS broadcast
    .post('/mcp/parameters', ({ body }) => {
      parameterStore.set(body as SongParameters);
      return { status: 'ok' };
    })

    // Bridge: stdio MCP server POSTs generation commands → WS broadcast
    .post('/mcp/generate', ({ body }) => {
      broadcast({ type: 'generation', data: body as GenerationCommand });
      return { status: 'ok' };
    })

    .listen({ port, hostname: '127.0.0.1' });

  console.error(`MCP WebSocket server listening on ws://127.0.0.1:${port}/mcp/ws`);
}

main().catch((error) => {
  console.error('MCP WS server failed to start:', error);
  process.exit(1);
});
