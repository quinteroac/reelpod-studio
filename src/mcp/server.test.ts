import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './server.js';

describe('MCP Server', () => {
  let client: Client;
  let tools: Array<{
    name: string;
    description?: string;
    inputSchema: { type: string; properties?: Record<string, object> };
  }>;

  beforeAll(async () => {
    const server = createMcpServer();
    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    tools = result.tools;
  });

  afterAll(async () => {
    await client.close();
  });

  // AC01: MCP server starts and accepts connections via stdio or SSE transport
  describe('AC01 – server starts and accepts connections', () => {
    it('creates a server and connects via in-memory transport', () => {
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  // AC02: Server responds to tools/list with all registered tools and their JSON schemas
  describe('AC02 – tools/list returns all registered tools', () => {
    it('returns exactly four tools', () => {
      expect(tools).toHaveLength(4);
    });

    it('registers the expected tool names', () => {
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'add_to_queue',
        'generate_audio',
        'get_queue',
        'set_song_parameters',
      ]);
    });

    it('each tool has a JSON input schema with type "object"', () => {
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  // AC03: Each tool has a clear name, description, and input schema
  describe('AC03 – each tool has name, description, and input schema', () => {
    it('every tool has a non-empty name', () => {
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(typeof tool.name).toBe('string');
      }
    });

    it('every tool has a non-empty description', () => {
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    });

    it('set_song_parameters schema defines mood, tempo, style, duration properties', () => {
      const tool = tools.find((t) => t.name === 'set_song_parameters');
      expect(tool).toBeDefined();
      const props = tool!.inputSchema.properties ?? {};
      expect(props).toHaveProperty('mood');
      expect(props).toHaveProperty('tempo');
      expect(props).toHaveProperty('style');
      expect(props).toHaveProperty('duration');
    });

    it('generate_audio schema defines imagePrompt property', () => {
      const tool = tools.find((t) => t.name === 'generate_audio');
      expect(tool).toBeDefined();
      const props = tool!.inputSchema.properties ?? {};
      expect(props).toHaveProperty('imagePrompt');
    });

    it('add_to_queue has an input schema (may be empty object)', () => {
      const tool = tools.find((t) => t.name === 'add_to_queue');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.type).toBe('object');
    });

    it('get_queue has an input schema (may be empty object)', () => {
      const tool = tools.find((t) => t.name === 'get_queue');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.type).toBe('object');
    });
  });
});
