---
name: install-mcp
description: "Explains how to install and configure the reelpod-ui-mcp server for any MCP-compatible client (Claude Code, Cursor, Windsurf, VS Code, custom agents, etc.). Use when an agent or user asks how to set up the MCP, connect an AI client to the UI, configure the MCP server, or troubleshoot MCP connection issues."
user-invocable: true
---

# Install the ReelPod MCP Server

This skill explains how to install and configure the `reelpod-ui-mcp` server so any MCP-compatible AI client can control the ReelPod Studio UI.

---

## What the MCP server exposes

The server (`src/mcp/stdio.ts`) implements the [Model Context Protocol](https://modelcontextprotocol.io) and exposes four tools:

| Tool | What it does |
|------|-------------|
| `set_song_parameters` | Sets mood, tempo, style, duration, mode, and prompt |
| `generate_audio` | Triggers audio + image generation |
| `add_to_queue` | Adds the last generated song to the playback queue |
| `get_queue` | Returns the current playback queue |

It communicates with the running frontend via an SSE bridge on port **3100**.

---

## Prerequisites

- Node.js ≥ 18 with `npx`
- Project dependencies installed: `npm install` or `bun install`
- The full dev stack running: `npm run dev`
  (starts Vite + backend + SSE bridge on port 3100)

---

## Transport modes

The server supports two transports depending on what your client requires:

### stdio (recommended for local clients)

Most AI editors and CLI tools use stdio. The client launches the server as a subprocess:

```
command: npx tsx src/mcp/stdio.ts
```

### SSE (for browser-based or remote clients)

Run the SSE server separately and connect via HTTP:

```
npm run dev:mcp        # starts http://127.0.0.1:3100
```

SSE endpoint: `http://127.0.0.1:3100/sse`

---

## Client configuration

All MCP clients use the same JSON config shape. Place it wherever your client expects it.

### Generic MCP config block

```json
{
  "mcpServers": {
    "reelpod-ui-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/reelpod-studio/src/mcp/stdio.ts"],
      "env": {
        "MCP_SSE_BASE_URL": "http://127.0.0.1:3100"
      }
    }
  }
}
```

Replace `/absolute/path/to/reelpod-studio` with the actual path on disk.

---

### Claude Code

The `.mcp.json` at the repo root is already checked in. Claude Code picks it up automatically when you open the project directory — **no manual setup needed**.

```json
// .mcp.json (already in repo)
{
  "mcpServers": {
    "reelpod-ui-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"]
    }
  }
}
```

To add it globally: paste the generic config block into `~/.claude.json` under `mcpServers`.

Verify with: `claude --mcp-debug`

---

### Cursor

Open **Settings → MCP** (or edit `~/.cursor/mcp.json`) and add the generic config block.

---

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` and add the generic config block.

---

### VS Code (GitHub Copilot / Continue)

For **Continue**: edit `~/.continue/config.json` under `"mcpServers"`.

For **GitHub Copilot** (MCP preview): use `.vscode/mcp.json` in the workspace:

```json
{
  "servers": {
    "reelpod-ui-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"]
    }
  }
}
```

---

### Custom agent / SDK

Use the `@modelcontextprotocol/sdk` client and connect via stdio:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', '/path/to/reelpod-studio/src/mcp/stdio.ts'],
  env: { MCP_SSE_BASE_URL: 'http://127.0.0.1:3100' },
});

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);
```

Or connect via SSE if the bridge is already running:

```ts
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const transport = new SSEClientTransport(new URL('http://127.0.0.1:3100/sse'));
await client.connect(transport);
```

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_SSE_BASE_URL` | `http://127.0.0.1:3100` | SSE bridge URL (override if port 3100 is taken) |
| `MCP_PORT` | `3100` | Port the SSE server listens on |

---

## Architecture

```
AI Client (any MCP host)
    │  stdio or SSE
    ▼
src/mcp/stdio.ts  OR  src/mcp/sse.ts   ← MCP server
    │  HTTP POST to SSE bridge
    ▼
src/mcp/sse.ts :3100                   ← SSE bridge
    │  SSE stream
    ▼
React frontend                         ← UI reacts in real time
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Server not listed by client | Config file not found or wrong path | Check the config location for your client; use absolute paths |
| Tool calls return errors | SSE bridge not running | Run `npm run dev` or `npm run dev:mcp` separately |
| Port 3100 already in use | Another process | Set `MCP_PORT` and `MCP_SSE_BASE_URL` to a free port |
| `tsx` not found | Missing dependencies | Run `npm install` in the project root |
| Parameters set but UI doesn't update | Browser tab not connected | Refresh the tab, then retry |
| SSE connection refused | Server not started | Run `npm run dev:mcp` before connecting |
