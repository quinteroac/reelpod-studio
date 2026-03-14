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

    it('set_song_parameters schema defines duration and optional prompt', () => {
      const tool = tools.find((t) => t.name === 'set_song_parameters');
      expect(tool).toBeDefined();
      const props = tool!.inputSchema.properties ?? {};
      expect(props).toHaveProperty('duration');
      expect(props).toHaveProperty('prompt');
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

  describe('AC01 – tool accepts duration and optional prompt', () => {
    it('accepts duration and prompt and returns success', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          duration: 120,
          prompt: 'energetic hip-hop beat',
        },
      });

      expect(result.content).toHaveLength(1);
      const parsed = parseToolResult(result);
      expect(parsed.parameters.duration).toBe(120);
      expect(parsed.parameters.prompt).toBe('energetic hip-hop beat');
      expect(parsed.parameters.mode).toBe('llm');
    });

    it('accepts only required duration (prompt optional)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: { duration: 60 },
      });

      const parsed = parseToolResult(result);
      expect(parsed.status).toBe('parameters_set');
      expect(parsed.parameters.duration).toBe(60);
    });
  });

  describe('AC02 – parameters are applied to the parameter store', () => {
    it('updates the parameter store when tool is called', async () => {
      const listener = vi.fn();
      parameterStore.on('update', listener);

      await client.callTool({
        name: 'set_song_parameters',
        arguments: {
          duration: 200,
          prompt: 'sad piano melody',
        },
      });

      expect(listener).toHaveBeenCalledOnce();
      const storedParams = parameterStore.get();
      expect(storedParams).toEqual({
        duration: 200,
        mode: 'llm',
        prompt: 'sad piano melody',
      });

      parameterStore.off('update', listener);
    });
  });

  describe('AC03 – tool returns confirmation with parameters', () => {
    it('returns status "parameters_set" and echoes parameters', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: { duration: 45, prompt: 'short clip' },
      });

      const parsed = parseToolResult(result);
      expect(parsed.status).toBe('parameters_set');
      expect(parsed.parameters).toEqual({
        duration: 45,
        mode: 'llm',
        prompt: 'short clip',
      });
    });
  });

  describe('AC04 – invalid parameters return clear error', () => {
    it('rejects duration below minimum (40)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: { duration: 10 },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects duration above maximum (300)', async () => {
      const result = await client.callTool({
        name: 'set_song_parameters',
        arguments: { duration: 500 },
      });
      expect(result.isError).toBe(true);
    });
  });
});

// SSE Bridge: generate_audio delegates to SSE server when sseBaseUrl is set
describe('SSE Bridge – generate_audio with sseBaseUrl', () => {
  let client: Client;
  let parameterStore: ParameterStore;
  const mockFetch = vi.fn();
  const SSE_BASE_URL = 'http://127.0.0.1:3100';

  beforeAll(async () => {
    parameterStore = new ParameterStore();
    const server = createMcpServer({
      parameterStore,
      sseBaseUrl: SSE_BASE_URL,
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

  it('POSTs to /mcp/generate on the SSE server instead of /api/generate', async () => {
    parameterStore.set({
      duration: 60,
      mode: 'llm',
      prompt: 'chill lofi',
    });

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await client.callTool({
      name: 'generate_audio',
      arguments: { imagePrompt: 'sunset beach' },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${SSE_BASE_URL}/mcp/generate`);
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.parameters.duration).toBe(60);
    expect(body.parameters.prompt).toBe('chill lofi');
    expect(body.imagePrompt).toBe('sunset beach');
    expect(body.targetWidth).toBe(1920);
    expect(body.targetHeight).toBe(1080);

    expect(result.isError).toBeFalsy();
    const parsed = parseToolResult(result);
    expect(parsed.status).toBe('queued');
  });

  it('returns error when SSE bridge is unreachable', async () => {
    parameterStore.set({
      duration: 60,
      mode: 'llm',
    });

    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await client.callTool({
      name: 'generate_audio',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const parsed = parseToolResult(result);
    expect(parsed.error).toContain('Connection refused');
  });

  it('also POSTs parameters to /mcp/parameters when set_song_parameters is called', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await client.callTool({
      name: 'set_song_parameters',
      arguments: { duration: 45, prompt: 'upbeat hip-hop' },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${SSE_BASE_URL}/mcp/parameters`);
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.duration).toBe(45);
    expect(body.prompt).toBe('upbeat hip-hop');
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

  describe('AC01 – triggers the same generation flow as the Generate button', () => {
    it('POSTs to /api/generate-requests with parameters from the store', async () => {
      parameterStore.set({
        duration: 60,
        mode: 'llm',
        prompt: 'chill jazz',
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
      expect(url).toBe(`${BACKEND_BASE_URL}/api/generate-requests`);
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.duration).toBe(60);
      expect(body.prompt).toBe('chill jazz');
      expect(body.mode).toBe('llm');
      expect(body.imagePrompt).toBe('sunset beach');
      expect(body.targetWidth).toBe(1920);
      expect(body.targetHeight).toBe(1080);
    });

    it('uses default image prompt when none provided', async () => {
      parameterStore.set({
        duration: 45,
        mode: 'llm',
        prompt: 'upbeat beat',
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
      parameterStore.set({ duration: 120, mode: 'llm' });

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
      parameterStore.set({ duration: 60, mode: 'llm' });

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
      parameterStore.set({ duration: 60, mode: 'llm' });

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
      parameterStore.set({ duration: 60, mode: 'llm' });

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
      parameterStore.set({ duration: 60, mode: 'llm' });

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
      parameterStore.set({ duration: 60, mode: 'llm' });

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
      parameterStore.set({ duration: 60, mode: 'llm' });

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
        duration: 60,
        mode: 'llm',
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
      expect(parsed.queue[0].parameters.duration).toBe(60);
      expect(parsed.queue[0].parameters.prompt).toBe('mellow jazz vibes');
    });
  });

  // US-004-AC02: Tool returns the updated queue with song count and song metadata
  describe('AC02 – returns updated queue with song count and metadata', () => {
    it('returns songCount and queue metadata after adding', async () => {
      parameterStore.set({
        duration: 45,
        mode: 'llm',
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

      const second = parsed.queue[1];
      expect(second.parameters.duration).toBe(45);
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

// US-005: Agent retrieves current queue state
describe('US-005 – get_queue tool', () => {
  // US-005-AC03: Returns an empty list if no songs have been added
  describe('AC03 – returns empty list when no songs added', () => {
    let client: Client;

    beforeAll(async () => {
      const server = createMcpServer();
      client = new Client({ name: 'test-client', version: '1.0.0' });

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();

      await server.connect(serverTransport);
      await client.connect(clientTransport);
    });

    afterAll(async () => {
      await client.close();
    });

    it('returns songCount 0 and an empty queue array', async () => {
      const result = await client.callTool({
        name: 'get_queue',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const parsed = parseToolResult(result);
      expect(parsed.songCount).toBe(0);
      expect(parsed.queue).toEqual([]);
    });
  });

  // US-005-AC01 & AC02: get_queue returns full queue with metadata per entry
  describe('AC01/AC02 – returns full queue with name, genre, tempo, duration, position', () => {
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

      // Add two songs to the queue
      parameterStore.set({
        duration: 60,
        mode: 'llm',
        prompt: 'mellow jazz vibes',
      });
      mockFetch.mockResolvedValueOnce(
        new Response(new Blob(), { status: 200 }),
      );
      await client.callTool({ name: 'generate_audio', arguments: { imagePrompt: 'sunset cafe' } });
      await client.callTool({ name: 'add_to_queue', arguments: {} });

      parameterStore.set({
        duration: 45,
        mode: 'llm',
      });
      mockFetch.mockResolvedValueOnce(
        new Response(new Blob(), { status: 200 }),
      );
      await client.callTool({ name: 'generate_audio', arguments: { imagePrompt: 'neon city' } });
      await client.callTool({ name: 'add_to_queue', arguments: {} });
    });

    afterAll(async () => {
      await client.close();
      vi.unstubAllGlobals();
    });

    it('returns the full ordered queue', async () => {
      const result = await client.callTool({
        name: 'get_queue',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const parsed = parseToolResult(result);
      expect(parsed.songCount).toBe(2);
      expect(parsed.queue).toHaveLength(2);
    });

    it('each entry includes name, duration, and position', async () => {
      const result = await client.callTool({
        name: 'get_queue',
        arguments: {},
      });

      const parsed = parseToolResult(result);
      const first = parsed.queue[0];
      expect(first.position).toBe(1);
      expect(first.name).toBe('mellow jazz vibes');
      expect(first.duration).toBe(60);

      const second = parsed.queue[1];
      expect(second.position).toBe(2);
      expect(second.name).toBe('Creative brief');
      expect(second.duration).toBe(45);
    });

    it('uses prompt as name when available, falls back to Creative brief', async () => {
      const result = await client.callTool({
        name: 'get_queue',
        arguments: {},
      });

      const parsed = parseToolResult(result);
      expect(parsed.queue[0].name).toBe('mellow jazz vibes');
      expect(parsed.queue[1].name).toBe('Creative brief');
    });

    it('preserves queue order (first added is position 1)', async () => {
      const result = await client.callTool({
        name: 'get_queue',
        arguments: {},
      });

      const parsed = parseToolResult(result);
      const positions = parsed.queue.map((e: { position: number }) => e.position);
      expect(positions).toEqual([1, 2]);
    });
  });
});
