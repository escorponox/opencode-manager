# OpenCode Manager

**POC Global OpenCode Server Manager for Multi-Project Workflows**

**Note: This is a just for my personal use and tailored to my specific workflow in my current enviroment. But maybe it can be useful for others as well, so I'm sharing it here.**

Global OpenCode server manager for multi-project workflows. Manage multiple OpenCode AI assistant servers across different projects with a unified REST API and MCP server.

## Features

- **Multi-Project Management**: Start, stop, and manage OpenCode servers for multiple projects simultaneously
- **REST API**: Complete HTTP API for programmatic control
- **Status page**: View all registered projects, their server status, and TUI attachment status and logs in `/status`
- **Interactive API Documentation**: Swagger UI documentation at `/docs`
- **MCP Server**: Model Context Protocol server to help AI agents discover and build REST API clients
- **Tmux TUI Integration**: Attach and manage Terminal User Interfaces in tmux sessions
- **Server-Sent Events**: Real-time event streaming from OpenCode servers
- **Automatic Server Lifecycle**: Smart server startup and health checking
- **CLI Wrapper**: `oc` script for quick access from any project directory
- **Neovim Plugin**: POC Neovim plugin for sending prompts and focusing TUIs in tmux

## Prerequisites

- Node.js (latest LTS recommended)
- [OpenCode CLI](https://opencode.ai) installed and accessible in PATH
- tmux (required for TUI features)
- A tmux session named `dev` (for TUI features)

### Environment Requirements

The OpenCode Manager service requires the following binaries to be in the system PATH:

- **tmux** - Typically `/opt/homebrew/bin/tmux` on macOS with Homebrew (Apple Silicon) or `/usr/local/bin/tmux` (Intel Mac)
- **opencode** - Typically `~/.opencode/bin/opencode`

If running as a launchd service, ensure the `PATH` environment variable in the plist file includes:

- `/opt/homebrew/bin` (for Homebrew-installed binaries on Apple Silicon)
- `/usr/local/bin` (for Homebrew-installed binaries on Intel Mac)
- `~/.opencode/bin` (for OpenCode CLI)

Example launchd PATH configuration in `~/Library/LaunchAgents/com.opencode.manager.plist`:

```xml
<key>PATH</key>
<string>/opt/homebrew/bin:/Users/USERNAME/.opencode/bin:/Users/USERNAME/.volta/bin:/usr/local/bin:/usr/bin:/bin</string>
```

## Installation

```bash
npm install
```

## Usage

### Start the Manager Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server runs on `http://127.0.0.1:4095`

### Quick CLI Access (oc script)

The `oc` script in `scripts/oc` provides a convenient command-line wrapper for quickly accessing OpenCode in the current directory:

```bash
# Add to your PATH for easy access
ln -s "$(pwd)/scripts/oc" /usr/local/bin/oc

# Then use from any project directory:
cd /path/to/your/project
oc
```

**What it does:**

- Automatically detects the current project directory
- Checks if OpenCode Manager is running (port 4095)
- If no server exists for the project: starts one and attaches a TUI
- If server exists without TUI: attaches a TUI to the existing server
- If TUI already attached: focuses the existing TUI window

**Requirements:**

- OpenCode Manager must be running (via launchd service)
- tmux session named `dev` must be active
- Hammerspoon optional (for automatic window focusing via `hs -c 'focusGhostty()'`)

This eliminates the need to manually manage server lifecycle or remember port numbers - just run `oc` from any project directory.

### Neovim Plugin (POC)

The `opencode.lua` file in `scripts/opencode.lua` is a proof-of-concept Neovim plugin that integrates with OpenCode Manager:

**Features:**

- Send prompts to OpenCode from Neovim with file context (file, line, column)
- Automatically focus the corresponding TUI in tmux session
- SSE (Server-Sent Events) integration for real-time notifications
- Auto-connect SSE when sending prompts
- Idle timeout disconnection to conserve resources
- Debounced notifications for message updates

**Setup:**

```lua
-- In your Neovim config (e.g., lazy.nvim)
{
  dir = "~/.movidas/manager/scripts",
  name = "opencode-manager",
  config = function()
    require("opencode").setup({
      sse_enabled = true,
      sse_idle_timeout = 300, -- 5 minutes
      sse_debug = false,
      sse_debounce_interval = 2, -- seconds
    })
  end,
}
```

**Usage:**

- `,eo` - Focus OpenCode TUI in tmux (starts server and attaches TUI if needed)
- `,ep` - Send custom prompt with file context

**Requirements:**

- OpenCode Manager running (via launchd service)
- tmux session named `dev`
- [plenary.nvim](https://github.com/nvim-lua/plenary.nvim) for SSE support
- Hammerspoon (optional) for terminal window focusing

The plugin automatically ensures the server is running, sends prompts with context, and focuses the tmux window containing the OpenCode TUI.

### API Documentation

Once the server is running, visit the interactive API documentation:

```
http://127.0.0.1:4095/docs
```

### MCP Documentation Endpoint

The manager provides a **read-only MCP documentation endpoint** (MCP 2025-06-18 spec compliant):

- `POST /mcp` - MCP protocol requests (resources/list, resources/read)
- `GET /mcp` - Open SSE stream (if needed)
- `DELETE /mcp` - Terminate session

**Purpose: Help AI Agents Build REST API Clients**

- ✅ Exposes REST API documentation as MCP Resources
- ✅ Provides OpenAPI spec, examples, and architecture docs
- ❌ **NO executable actions** - use REST API for operations
- ✅ AI agents discover the API, then build clients using REST endpoints

The MCP server exists **only to help AI agents understand the API** and generate proper REST API client code. It does not execute actions directly.

**Features:**

- Full MCP 2025-06-18 specification compliance
- Session management with secure session IDs
- SSE streaming with resumability
- Protocol version negotiation (2025-06-18, 2025-03-26, 2024-11-05)

No separate MCP server process needed - fully integrated into the HTTP server!

## API Overview

### Health & Status

- `GET /health` - Health check
- `GET /projects` - List all registered projects

### Project Management

- `GET /project/:path` - Get project status
- `POST /project/:path/ensure` - Start server if not running
- `DELETE /project/:path` - Stop server

### Prompts

- `POST /project/:path/prompt` - Send prompt to OpenCode server

### TUI Management

- `POST /project/:path/attach-tui-cli` - Attach TUI in current pane
- `POST /project/:path/attach-tui-neovim` - Attach TUI from Neovim
- `POST /project/:path/focus-tui` - Focus existing TUI

### Events

- `GET /project/:path/events` - Server-Sent Events stream

### MCP (Model Context Protocol) - Documentation Only

- `POST /mcp` - MCP protocol requests (JSON-RPC 2.0)
- `GET /mcp` - Open SSE stream
- `DELETE /mcp` - Terminate session

**MCP Resources (Read-Only):**

- `resource://opencode-manager/openapi` - Full OpenAPI spec
- `resource://opencode-manager/api/endpoints` - Endpoint summary
- `resource://opencode-manager/api/examples` - Usage examples
- `resource://opencode-manager/architecture` - System architecture

**Required Headers:**

- `MCP-Protocol-Version`: Protocol version (e.g., "2025-06-18")
- `Accept`: Must include "application/json" and/or "text/event-stream"
- `Mcp-Session-Id`: Session ID (after initialization)

**Important**: MCP is read-only documentation to help agents build clients. Use REST API for operations.

**Note**: Project paths in URLs must be base64url-encoded.

## MCP Resources (Documentation)

The MCP endpoint exposes read-only documentation resources for AI agents to discover the REST API:

- `openapi` - Complete OpenAPI 3.0 specification (YAML)
- `api/endpoints` - Summary of all REST endpoints (JSON)
- `api/examples` - curl examples for common operations (Markdown)
- `architecture` - System architecture and design (Markdown)

**Purpose:** Help AI agents understand the REST API structure and build proper REST API clients. The MCP server does not execute actions - agents read the documentation, then implement REST API clients for actual operations.

## Configuration

### Port Allocation

- Manager server: `4095`
- Project servers: Starting from `4097` (auto-incremented)

### Tmux Integration

The manager integrates deeply with tmux to provide Terminal User Interface (TUI) features:

**Features:**

- Attach OpenCode TUI to tmux windows and panes
- Focus existing TUIs by switching to the correct tmux window
- Track tmux session, window, and pane information for each project
- Support for both CLI and Neovim TUI attachment

**Requirements:**

- tmux must be installed and in PATH
- A tmux session named `dev` must be running
- tmux binary location must be in launchd service PATH (see Troubleshooting)

**How it works:**

1. When attaching a TUI, the manager creates a new tmux window in the `dev` session
2. The TUI is launched in that window with the project name as the window title
3. Window and pane IDs are stored in the project registry
4. Focusing a TUI switches to the corresponding tmux window
5. The `oc` script and Neovim plugin use this to seamlessly switch between projects

## Examples

### Start a Server and Send a Prompt

```bash
# Encode project path
PROJECT_PATH="/path/to/project"
ENCODED=$(echo -n "$PROJECT_PATH" | base64 | tr '+/' '-_' | tr -d '=')

# Ensure server is running
curl -X POST "http://127.0.0.1:4095/project/$ENCODED/ensure"

# Send a prompt
curl -X POST "http://127.0.0.1:4095/project/$ENCODED/prompt" \
  -H "Content-Type: application/json" \
  -d '{"text": "Add authentication to the API"}'
```

### Subscribe to Events

```bash
# Listen for events
curl -N "http://127.0.0.1:4095/project/$ENCODED/events"
```

### Using MCP for API Discovery

AI agents can connect to the MCP endpoint to discover the REST API:

**For OpenCode or Claude Desktop:**

```json
{
  "mcpServers": {
    "opencode-manager-docs": {
      "transport": {
        "type": "http",
        "url": "http://127.0.0.1:4095/mcp"
      }
    }
  }
}
```

**Agent Workflow:**

1. Connect via MCP to discover the API
2. Call `resources/list` to see available documentation
3. Call `resources/read` to get OpenAPI spec and examples
4. **Build a REST API client** based on the documentation
5. **Use the REST API client** for all operations (not MCP)

**Example MCP Request (documentation discovery):**

```bash
# 1. Initialize MCP session
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {"protocolVersion": "2025-06-18"},
    "id": 1
  }' -i

# 2. List available documentation resources
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/list",
    "params": {},
    "id": 2
  }'

# 3. Read API endpoints documentation
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {"uri": "resource://opencode-manager/api/endpoints"},
    "id": 3
  }'
```

See [MCP_EXAMPLES.md](./MCP_EXAMPLES.md) for comprehensive examples.

**Then use the REST API:**

```bash
# Now use REST API for actual operations
PROJECT_PATH="/path/to/project"
ENCODED=$(echo -n "$PROJECT_PATH" | base64 | tr '+/' '-_' | tr -d '=')

# Start server
curl -X POST "http://127.0.0.1:4095/project/$ENCODED/ensure"

# Send prompt
curl -X POST "http://127.0.0.1:4095/project/$ENCODED/prompt" \
  -H "Content-Type: application/json" \
  -d '{"text": "Review authentication code"}'
```

## Architecture

```
┌─────────────────────────────────────────────┐
│         OpenCode Manager (Port 4095)        │
│                                             │
│  ┌──────────────────────────────────┐      │
│  │     HTTP Server (Express)        │      │
│  │  • REST API                      │      │
│  │  • MCP Endpoints (/mcp, /mcp/sse)│      │
│  │  • API Docs (/docs)              │      │
│  │  • SSE Streams                   │      │
│  └──────────┬───────────────────────┘      │
│             │                               │
│     ┌───────▼────────┐                      │
│     │  Project       │                      │
│     │  Registry      │                      │
│     └───────┬────────┘                      │
│             │                               │
└─────────────┼───────────────────────────────┘
              │
   ┌──────────┼──────────┐
   │          │          │
┌──▼─────┐ ┌──▼─────┐ ┌──▼─────┐
│OpenCode│ │OpenCode│ │OpenCode│
│Server  │ │Server  │ │Server  │
│:4097   │ │:4098   │ │:4099   │
└────────┘ └────────┘ └────────┘
 Project A  Project B  Project C
```

## Development

### Type Checking

```bash
npm run type-check
```

### Project Structure

```
.
├── src/
│   ├── index.ts       # Main server entry point
│   ├── api.ts         # REST API routes and MCP routing
│   ├── mcp-handler.ts # MCP protocol handler (HTTP/SSE)
│   ├── registry.ts    # Project registry
│   ├── opencode.ts    # OpenCode server lifecycle
│   ├── tmux.ts        # Tmux integration
│   └── events.ts      # SSE event handling
├── openapi.yaml       # OpenAPI specification
└── package.json       # Dependencies and scripts
```

## Troubleshooting

### "Tmux session 'dev' is not running" Error

**Symptom:** API calls to `/attach-tui-cli` or `/attach-tui-neovim` return 400 error:

```json
{ "error": "Tmux session 'dev' is not running" }
```

**Cause:** The launchd service PATH doesn't include the directory where tmux is installed, preventing the manager from finding the `tmux` binary.

**Solution:**

1. Verify where tmux is installed:

   ```bash
   which tmux
   # Usually /opt/homebrew/bin/tmux (Apple Silicon) or /usr/local/bin/tmux (Intel)
   ```

2. Edit the launchd plist file:

   ```bash
   nano ~/Library/LaunchAgents/com.opencode.manager.plist
   ```

3. Add the tmux directory to the PATH. For Apple Silicon Macs with Homebrew:

   ```xml
   <key>PATH</key>
   <string>/opt/homebrew/bin:/Users/USERNAME/.opencode/bin:/Users/USERNAME/.volta/bin:/usr/local/bin:/usr/bin:/bin</string>
   ```

4. Restart the service:

   ```bash
   launchctl unload ~/Library/LaunchAgents/com.opencode.manager.plist
   launchctl load ~/Library/LaunchAgents/com.opencode.manager.plist
   ```

5. Verify the fix:
   ```bash
   curl -s http://localhost:4095/health
   # Should return {"healthy":true,"version":"1.0.0"}
   ```

### OpenCode Server Fails to Start

**Symptom:** Servers fail to start with "spawn opencode ENOENT" error in logs.

**Cause:** The `opencode` binary is not in the launchd service PATH.

**Solution:** Same as above - ensure `~/.opencode/bin` (or wherever opencode is installed) is in the PATH in the plist file.

### Check Service Logs

View manager logs:

```bash
tail -f ~/.local/state/opencode/manager.log
tail -f ~/.local/state/opencode/manager.error.log
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or submit a pull request.
