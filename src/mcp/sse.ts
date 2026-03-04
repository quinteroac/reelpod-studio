import http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ParameterStore, type SongParameters } from './parameter-store.js';
import { createMcpServer } from './server.js';

const DEFAULT_PORT = 3100;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export interface GenerationCommand {
  parameters: SongParameters;
  imagePrompt: string;
  targetWidth: number;
  targetHeight: number;
}

async function main() {
  const port = Number(process.env.MCP_PORT) || DEFAULT_PORT;
  const transports = new Map<string, SSEServerTransport>();
  const parameterStore = new ParameterStore();
  const parameterSubscribers = new Set<http.ServerResponse>();
  const generationSubscribers = new Set<http.ServerResponse>();

  parameterStore.on('update', (params: SongParameters) => {
    const data = JSON.stringify(params);
    for (const res of parameterSubscribers) {
      res.write(`data: ${data}\n\n`);
    }
  });

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // --- SSE streams ---

    if (url.pathname === '/mcp/parameters/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const current = parameterStore.get();
      if (current) {
        res.write(`data: ${JSON.stringify(current)}\n\n`);
      }

      parameterSubscribers.add(res);
      req.on('close', () => {
        parameterSubscribers.delete(res);
      });
      return;
    }

    if (url.pathname === '/mcp/generation/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      generationSubscribers.add(res);
      req.on('close', () => {
        generationSubscribers.delete(res);
      });
      return;
    }

    // --- Bridge endpoints (stdio MCP → SSE broadcast) ---

    if (url.pathname === '/mcp/parameters' && req.method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as SongParameters;
        parameterStore.set(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
      return;
    }

    if (url.pathname === '/mcp/generate' && req.method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as GenerationCommand;
        const data = JSON.stringify(body);
        for (const subscriber of generationSubscribers) {
          subscriber.write(`data: ${data}\n\n`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
      return;
    }

    // --- MCP SSE transport ---

    if (url.pathname === '/sse' && req.method === 'GET') {
      const server = createMcpServer({ parameterStore });
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };

      await server.connect(transport);
      return;
    }

    if (url.pathname === '/messages' && req.method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown session' }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(port, '127.0.0.1', () => {
    console.error(`MCP SSE server listening on http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error('MCP SSE server failed to start:', error);
  process.exit(1);
});
