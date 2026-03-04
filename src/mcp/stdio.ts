import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { ParameterStore } from './parameter-store.js';

const DEFAULT_SSE_BASE_URL = 'http://127.0.0.1:3100';

async function main() {
  const parameterStore = new ParameterStore();
  const sseBaseUrl = process.env.MCP_SSE_BASE_URL || DEFAULT_SSE_BASE_URL;
  const server = createMcpServer({ parameterStore, sseBaseUrl });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server failed to start:', error);
  process.exit(1);
});
