import http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from './server.js';

const DEFAULT_PORT = 3100;

async function main() {
  const port = Number(process.env.MCP_PORT) || DEFAULT_PORT;
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/sse' && req.method === 'GET') {
      const server = createMcpServer();
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
