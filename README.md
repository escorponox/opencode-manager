# OpenCode Manager

Manages multiple OpenCode AI assistant instances from Neovim and tmux.

**Note: This is a just for my personal use and tailored to my specific workflow in my current enviroment. But maybe it can be useful for others as well, so I'm sharing it here.**

## Components

### Server (port 4095)

HTTP API that starts/stops OpenCode servers per-project and manages their TUI windows in tmux.

### oc script

CLI wrapper in `scripts/oc`. Run `oc` from any project directory to:

1. Start OpenCode server if not running
2. Attach TUI in tmux if not attached
3. Focus existing TUI if already running

```bash
ln -s "$(pwd)/scripts/oc" /usr/local/bin/oc
```

### Neovim plugin

Plugin in `lua/opencode/init.lua` provides:

- `,ee` - Send prompt with current file context, starts server if not running
- `,eo` - Focus TUI in TMUX or start TUI for current project

```lua
{ dir = "~/.movidas/manager/lua", name = "opencode-manager" }
```

### tmux

OpenCode TUIs run in a tmux session named `dev`. The manager creates a window per project and tracks window/pane IDs to switch between projects.

## Server Endpoints

- `GET /health` - Health check
- `GET /projects` - List all registered projects
- `GET /status` - HTML status page
- `GET /docs` - Swagger API docs
- `GET /project/:path` - Get project status (port, PID, TUI state)
- `POST /project/:path/ensure` - Start server if not running
- `DELETE /project/:path` - Stop server
- `POST /project/:path/prompt` - Send prompt to OpenCode
- `POST /project/:path/attach-tui-cli` - Attach TUI in current shell
- `POST /project/:path/attach-tui-neovim` - Attach TUI from Neovim
- `POST /project/:path/focus-tui` - Focus existing TUI

Project paths must be base64url-encoded in URLs.

## MCP (Read-Only Documentation)

`POST /mcp` - MCP protocol endpoint. Provides REST API documentation as resources (OpenAPI spec, endpoints, examples). **Does not execute actions** - use REST API for operations. Helps AI agents build REST clients.

## Example launchd plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.opencode.manager</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/USERNAME/.volta/bin/node</string>
    <string>--experimental-strip-types</string>
    <string>/Users/USERNAME/.movidas/manager/src/index.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>PATH</key>
  <string>/opt/homebrew/bin:/Users/USERNAME/.opencode/bin:/Users/USERNAME/.volta/bin:/usr/local/bin:/usr/bin:/bin</string>
</dict>
</plist>
```

Restart with `launchctl unload && load ~/Library/LaunchAgents/com.opencode.manager.plist`.

## Architecture

```
┌─────────────────────────────────────────────┐
│         OpenCode Manager (Port 4095)        │
│                                             │
│  ┌──────────────────────────────────┐      │
│  │     HTTP Server (Express)        │      │
│  │  • REST API                      │      │
│  │  • MCP Endpoints (/mcp)          │      │
│  │  • Status Page (/status)         │      │
│  └──────────┬───────────────────────┘      │
│             │                               │
│     ┌───────▼────────┐                      │
│     │  Project        │                      │
│     │  Registry       │                      │
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
