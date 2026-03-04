import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
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

// US-003: Agent triggers audio generation
describe('US-003 – generate_audio tool', () => {
  let client: Client;
  let parameterStore: ParameterStore;
  const mockFetch = vi.fn();
  const BACKEND_BASE_URL = 'http://test-backend:9999';

  beforeAll(async () => {
    parameterStore = new ParameterStore();
    const server = createMcpServer({
      parameterStore,
      backendBaseUrl: BACKEND_BASE_URL,
    });
    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    vi.stubGlobal('fetch', mockFetch);
  });

  afterAll(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  // US-003-AC01: generate_audio triggers the same flow as clicking the Generate button
  describe('AC01 – triggers the same generation flow as the Generate button', () => {
    it('POSTs to /api/generate with parameters from the store', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(new Blob(), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      );

      await client.callTool({
        name: 'generate_audio',
        arguments: { imagePrompt: 'sunset beach' },
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BACKEND_BASE_URL}/api/generate`);
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.mood).toBe('chill');
      expect(body.tempo).toBe(80);
      expect(body.style).toBe('jazz');
      expect(body.duration).toBe(60);
      expect(body.imagePrompt).toBe('sunset beach');
      expect(body.targetWidth).toBe(1920);
      expect(body.targetHeight).toBe(1080);
    });

    it('uses default image prompt when none provided', async () => {
      parameterStore.set({
        mood: 'upbeat',
        tempo: 100,
        style: 'hip-hop',
        duration: 45,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(new Blob(), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      );

      await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.imagePrompt).toBe('lofi artwork, warm colors');
    });

    it('returns error when no parameters have been set', async () => {
      const freshStore = new ParameterStore();
      const freshServer = createMcpServer({
        parameterStore: freshStore,
        backendBaseUrl: BACKEND_BASE_URL,
      });
      const freshClient = new Client({
        name: 'test-client-fresh',
        version: '1.0.0',
      });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await freshServer.connect(st);
      await freshClient.connect(ct);

      const result = await freshClient.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain('set_song_parameters');

      await freshClient.close();
    });
  });

  // US-003-AC02: Tool returns a result indicating success or failure
  describe('AC02 – returns success or failure result', () => {
    it('returns status "completed" on successful generation', async () => {
      parameterStore.set({
        mood: 'melancholic',
        tempo: 70,
        style: 'ambient',
        duration: 120,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(new Blob(), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      );

      const result = await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const parsed = parseToolResult(result);
      expect(parsed.status).toBe('completed');
    });

    it('returns status "failed" on backend error', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'ACEStep timeout' }), {
          status: 504,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.status).toBe('failed');
    });
  });

  // US-003-AC03: If generation fails, the error message from the backend is forwarded
  describe('AC03 – backend error message is forwarded to the agent', () => {
    it('forwards the error field from a JSON error response', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'Audio generation timed out after 60s' }),
          {
            status: 504,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      const result = await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toBe('Audio generation timed out after 60s');
    });

    it('forwards the detail field from a JSON error response', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: 'Image model out of memory' }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      const result = await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      const parsed = parseToolResult(result);
      expect(parsed.error).toBe('Image model out of memory');
    });

    it('provides a fallback message for non-JSON error responses', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      });

      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      const parsed = parseToolResult(result);
      expect(parsed.error).toContain('500');
    });

    it('forwards network errors', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      });

      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const result = await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toBe('fetch failed');
    });
  });
});

// US-004: Agent adds generated song to the queue
describe('US-004 – add_to_queue tool', () => {
  let client: Client;
  let parameterStore: ParameterStore;
  const mockFetch = vi.fn();
  const BACKEND_BASE_URL = 'http://test-backend:9999';

  beforeAll(async () => {
    parameterStore = new ParameterStore();
    const server = createMcpServer({
      parameterStore,
      backendBaseUrl: BACKEND_BASE_URL,
    });
    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    vi.stubGlobal('fetch', mockFetch);
  });

  afterAll(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  // US-004-AC03: Adding to the queue when no audio has been generated returns a clear error
  describe('AC03 – error when no audio has been generated', () => {
    it('returns an error when add_to_queue is called before any generation', async () => {
      const freshStore = new ParameterStore();
      const freshServer = createMcpServer({
        parameterStore: freshStore,
        backendBaseUrl: BACKEND_BASE_URL,
      });
      const freshClient = new Client({
        name: 'test-client-fresh',
        version: '1.0.0',
      });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await freshServer.connect(st);
      await freshClient.connect(ct);
      vi.stubGlobal('fetch', mockFetch);

      const result = await freshClient.callTool({
        name: 'add_to_queue',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toBeTruthy();

      await freshClient.close();
    });

    it('returns an error when the last generation failed', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'ACEStep timeout' }), {
          status: 504,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await client.callTool({
        name: 'generate_audio',
        arguments: {},
      });

      const result = await client.callTool({
        name: 'add_to_queue',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toBeTruthy();
    });
  });

  // US-004-AC01: add_to_queue adds the current song (with its parameters and audio) to the existing queue
  describe('AC01 – adds current song to the queue', () => {
    it('adds a successfully generated song to the queue', async () => {
      parameterStore.set({
        mood: 'chill',
        tempo: 80,
        style: 'jazz',
        duration: 60,
        prompt: 'mellow jazz vibes',
      });

      mockFetch.mockResolvedValueOnce(
        new Response(new Blob(), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      );

      await client.callTool({
        name: 'generate_audio',
        arguments: { imagePrompt: 'sunset cafe' },
      });

      const result = await client.callTool({
        name: 'add_to_queue',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const parsed = parseToolResult(result);
      expect(parsed.status).toBe('added_to_queue');
      expect(parsed.queue.length).toBe(1);
      expect(parsed.queue[0].parameters.mood).toBe('chill');
      expect(parsed.queue[0].parameters.tempo).toBe(80);
      expect(parsed.queue[0].parameters.style).toBe('jazz');
      expect(parsed.queue[0].parameters.prompt).toBe('mellow jazz vibes');
    });
  });

  // US-004-AC02: Tool returns the updated queue with song count and song metadata
  describe('AC02 – returns updated queue with song count and metadata', () => {
    it('returns songCount and queue metadata after adding', async () => {
      // Generate a second song and add it
      parameterStore.set({
        mood: 'upbeat',
        tempo: 110,
        style: 'hip-hop',
        duration: 45,
        prompt: 'energetic beat',
      });

      mockFetch.mockResolvedValueOnce(
        new Response(new Blob(), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      );

      await client.callTool({
        name: 'generate_audio',
        arguments: { imagePrompt: 'neon city' },
      });

      const result = await client.callTool({
        name: 'add_to_queue',
        arguments: {},
      });

      const parsed = parseToolResult(result);
      expect(parsed.songCount).toBe(2);
      expect(parsed.queue).toHaveLength(2);

      // Verify metadata of the second song
      const second = parsed.queue[1];
      expect(second.parameters.mood).toBe('upbeat');
      expect(second.parameters.tempo).toBe(110);
      expect(second.parameters.style).toBe('hip-hop');
      expect(second.parameters.prompt).toBe('energetic beat');
      expect(second.imagePrompt).toBe('neon city');
      expect(typeof second.id).toBe('number');
    });

    it('prevents adding the same generation twice', async () => {
      const result = await client.callTool({
        name: 'add_to_queue',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toBeTruthy();
    });
  });
});
