import http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ParameterStore, type SongParameters } from './parameter-store.js';
import { createMcpServer } from './server.js';

const DEFAULT_PORT = 3100;

async function main() {
  const port = Number(process.env.MCP_PORT) || DEFAULT_PORT;
  const transports = new Map<string, SSEServerTransport>();
  const parameterStore = new ParameterStore();
  const parameterSubscribers = new Set<http.ServerResponse>();

  parameterStore.on('update', (params: SongParameters) => {
    const data = JSON.stringify(params);
    for (const res of parameterSubscribers) {
      res.write(`data: ${data}\n\n`);
    }
  });

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

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
