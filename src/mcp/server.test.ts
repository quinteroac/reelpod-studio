import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './server.js';
import { ParameterStore } from './parameter-store.js';

type ToolResultContent = Array<{ type: string; text: string }>;

function parseToolResult(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as ToolResultContent;
  return JSON.parse(content[0].text);
}

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

  // US-001 AC01: MCP server starts and accepts connections via stdio or SSE transport
  describe('AC01 – server starts and accepts connections', () => {
    it('creates a server and connects via in-memory transport', () => {
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  // US-001 AC02: Server responds to tools/list with all registered tools and their JSON schemas
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

  // US-001 AC03: Each tool has a clear name, description, and input schema
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

// US-002: Agent sets song parameters
describe('US-002 – set_song_parameters tool', () => {
  let client: Client;
  let parameterStore: ParameterStore;

  beforeAll(async () => {
    parameterStore = new ParameterStore();
    const server = createMcpServer({ parameterStore });
    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  // US-002-AC01: Tool accepts genre, lyrics, tempo, and other relevant fields
  describe('AC01 – tool accepts mood, style, tempo, duration, mode, prompt', () => {
    it('accepts all parameters and returns success', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'upbeat',
          tempo: 100,
          style: 'hip-hop',
          duration: 120,
          mode: 'text-and-parameters',
          prompt: 'energetic hip-hop beat',
        },
      });

      expect(result.content).toHaveLength(1);
      const parsed = parseToolResult(result);
      expect(parsed.parameters.mood).toBe('upbeat');
      expect(parsed.parameters.tempo).toBe(100);
      expect(parsed.parameters.style).toBe('hip-hop');
      expect(parsed.parameters.duration).toBe(120);
      expect(parsed.parameters.mode).toBe('text-and-parameters');
      expect(parsed.parameters.prompt).toBe('energetic hip-hop beat');
    });

    it('accepts only required parameters (mode and prompt are optional)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'chill',
          tempo: 80,
          style: 'ambient',
          duration: 60,
        },
      });

      const parsed = parseToolResult(result);
      expect(parsed.status).toBe('parameters_set');
      expect(parsed.parameters.mood).toBe('chill');
      expect(parsed.parameters.style).toBe('ambient');
    });
  });

  // US-002-AC02: Parameters are applied to the application state
  describe('AC02 – parameters are applied to the parameter store', () => {
    it('updates the parameter store when tool is called', async () => {
      const listener = vi.fn();
      parameterStore.on('update', listener);

      await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'melancholic',
          tempo: 70,
          style: 'jazz',
          duration: 200,
          mode: 'text',
          prompt: 'sad piano melody',
        },
      });

      expect(listener).toHaveBeenCalledOnce();
      const storedParams = parameterStore.get();
      expect(storedParams).toEqual({
        mood: 'melancholic',
        tempo: 70,
        style: 'jazz',
        duration: 200,
        mode: 'text',
        prompt: 'sad piano melody',
      });

      parameterStore.off('update', listener);
    });
  });

  // US-002-AC03: Tool returns confirmation with the parameters that were set
  describe('AC03 – tool returns confirmation with parameters', () => {
    it('returns status "parameters_set" and echoes all parameters', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'upbeat',
          tempo: 110,
          style: 'hip-hop',
          duration: 45,
        },
      });

      const parsed = parseToolResult(result);
      expect(parsed.status).toBe('parameters_set');
      expect(parsed.parameters).toEqual({
        mood: 'upbeat',
        tempo: 110,
        style: 'hip-hop',
        duration: 45,
        mode: undefined,
        prompt: undefined,
      });
    });
  });

  // US-002-AC04: Invalid parameters return a clear error message
  describe('AC04 – invalid parameters return clear error', () => {
    it('rejects invalid mood value', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'angry',
          tempo: 80,
          style: 'jazz',
          duration: 60,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects tempo below minimum (60)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'chill',
          tempo: 30,
          style: 'jazz',
          duration: 60,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects tempo above maximum (120)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'chill',
          tempo: 200,
          style: 'jazz',
          duration: 60,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects duration below minimum (40)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'chill',
          tempo: 80,
          style: 'jazz',
          duration: 10,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects duration above maximum (300)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'chill',
          tempo: 80,
          style: 'jazz',
          duration: 500,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects invalid style value', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'chill',
          tempo: 80,
          style: 'rock',
          duration: 60,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects non-integer tempo', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          mood: 'chill',
          tempo: 80.5,
          style: 'jazz',
          duration: 60,
        },
      });
      expect(result.isError).toBe(true);
    });
  });
});
