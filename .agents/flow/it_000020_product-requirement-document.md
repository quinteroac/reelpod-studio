# Requirement: MCP Server for Agent-Controlled UI

## Context
ReelPod Studio currently requires manual interaction through the browser UI to configure songs, generate audio, and manage content. There is no programmatic interface for AI agents to control the application. By exposing the UI capabilities through an MCP (Model Context Protocol) server, AI agents can autonomously create playlists — setting parameters, triggering generation, and organizing songs — without human intervention.

## Goals
- Enable AI agents to discover and invoke UI actions via the MCP protocol
- Allow agents to autonomously compose playlists by generating and organizing songs
- Provide a frontend-only MCP server using the official `@modelcontextprotocol/sdk`

## User Stories

### US-001: Agent discovers available tools
**As an** AI agent, **I want** to connect to the MCP server and list all available tools **so that** I know which UI actions I can perform.

**Acceptance Criteria:**
- [ ] MCP server starts and accepts connections via stdio or SSE transport
- [ ] Server responds to `tools/list` with all registered tools and their JSON schemas
- [ ] Each tool has a clear name, description, and input schema
- [ ] Typecheck / lint passes

### US-002: Agent sets song parameters
**As an** AI agent, **I want** to set song parameters (genre, lyrics, tempo, etc.) via an MCP tool call **so that** I can configure a song before generation.

**Acceptance Criteria:**
- [ ] A `set_song_parameters` tool accepts genre, lyrics, tempo, and other relevant fields
- [ ] Parameters are applied to the application state (same effect as filling the UI form)
- [ ] Tool returns confirmation with the parameters that were set
- [ ] Invalid parameters return a clear error message
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser (parameter controls reflect the values set by the agent)

### US-003: Agent triggers audio generation
**As an** AI agent, **I want** to trigger audio generation and know when it completes **so that** I can proceed to the next step in playlist creation.

**Acceptance Criteria:**
- [ ] A `generate_audio` tool triggers the same flow as clicking the Generate button
- [ ] Tool returns a result indicating success or failure once generation completes
- [ ] If generation fails, the error message from the backend is forwarded to the agent
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser (generation starts and audio becomes available)

### US-004: Agent adds generated song to the queue
**As an** AI agent, **I want** to add the most recently generated song to the existing generation queue **so that** I can build a collection of songs.

**Acceptance Criteria:**
- [ ] A `add_to_queue` tool adds the current song (with its parameters and audio) to the existing queue
- [ ] Tool returns the updated queue with song count and song metadata
- [ ] Adding to the queue when no audio has been generated returns a clear error
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser (existing queue UI reflects the added song)

### US-005: Agent retrieves current queue state
**As an** AI agent, **I want** to retrieve the current queue **so that** I can see what songs have been added and in what order.

**Acceptance Criteria:**
- [ ] A `get_queue` tool returns the full queue (ordered list of songs with metadata)
- [ ] Each song entry includes: title/name, genre, tempo, duration, and position in the queue
- [ ] Returns an empty list if no songs have been added
- [ ] Typecheck / lint passes

## Functional Requirements
- FR-1: The MCP server MUST use the official `@modelcontextprotocol/sdk` package
- FR-2: The MCP server MUST be frontend-only (TypeScript, no backend integration required)
- FR-3: The MCP server MUST support the standard MCP tool discovery and invocation protocol
- FR-4: The MCP server MUST expose tools: `set_song_parameters`, `generate_audio`, `add_to_queue`, `get_queue`
- FR-5: The MCP server MUST interact with the existing React application state (not bypass it)
- FR-6: Queue state uses the existing queue mechanism in the frontend (no new persistence required for MVP)
- FR-7: The MCP server MUST run as a separate process or endpoint that the agent can connect to

## Non-Goals (Out of Scope)
- Backend/FastAPI integration for MCP
- Queue persistence (database, file system)
- Queue playback controls (play all, shuffle, skip)
- Song reordering or removal from queue
- Authentication or authorization for MCP connections
- Multiple simultaneous agent sessions
- Video/visual configuration via MCP (visualizer/effect selection)

## Open Questions
All resolved:
- **Transport:** Stdio for MVP. Claude Code is the primary agent and uses stdio natively. SSE can be added in a future iteration for network-based agents.
- **Playlist:** "Playlist" refers to the existing generation queue in the app, not a new component. The MCP server interacts with the current queue state.
