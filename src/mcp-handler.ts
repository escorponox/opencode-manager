/**
 * MCP Handler - Streamable HTTP Protocol Implementation
 *
 * Documentation server following MCP Specification 2025-06-18
 * Exposes API documentation as MCP Resources and provides search tool
 * AI agents discover the REST API structure, then use REST endpoints for operations
 *
 * Capabilities:
 * - Resources: Read-only documentation (OpenAPI spec, endpoints, examples, architecture)
 * - Tools: search_api_docs - Search through documentation with keyword matching
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { createLogger } from "./logger.ts";

const logger = createLogger({ module: "mcp-handler" });

const PROTOCOL_VERSION = "2025-06-18";
const FALLBACK_VERSION = "2025-03-26"; // For clients without version header

// Get paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Session storage
interface McpSession {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  eventCounter: number;
  pendingStreams: Map<string, SseStream>;
}

interface SseStream {
  res: Response;
  eventCounter: number;
  lastEventId: string | null;
}

const sessions = new Map<string, McpSession>();

// Cleanup sessions older than 1 hour of inactivity
setInterval(
  () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [sessionId, session] of sessions.entries()) {
      if (session.lastActivity.getTime() < oneHourAgo) {
        for (const stream of session.pendingStreams.values()) {
          stream.res.end();
        }
        sessions.delete(sessionId);
        logger.info({ sessionId }, "Cleaned up expired MCP session");
      }
    }
  },
  5 * 60 * 1000,
);

// Validate protocol version header
function validateProtocolVersion(req: Request): string | null {
  const version = req.header("MCP-Protocol-Version");

  if (!version) {
    return FALLBACK_VERSION;
  }

  if (["2025-06-18", "2025-03-26", "2024-11-05"].includes(version)) {
    return version;
  }

  return null;
}

// Validate Accept header
function validateAcceptHeader(
  req: Request,
  requireSSE: boolean = false,
): boolean {
  const accept = req.header("Accept");
  if (!accept) return false;

  const hasJson = accept.includes("application/json");
  const hasSSE = accept.includes("text/event-stream");

  if (requireSSE) {
    return hasSSE;
  }

  return hasJson || hasSSE;
}

// Get or create session
function getSession(sessionId: string | undefined): McpSession | null {
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivity = new Date();
    return session;
  }

  return null;
}

// Create new session
function createSession(): McpSession {
  const session: McpSession = {
    id: randomUUID(),
    createdAt: new Date(),
    lastActivity: new Date(),
    eventCounter: 0,
    pendingStreams: new Map(),
  };

  sessions.set(session.id, session);
  return session;
}

// Send SSE event with ID
function sendSseEvent(
  res: Response,
  data: unknown,
  eventId: string,
  eventType?: string,
): void {
  if (eventType) {
    res.write(`event: ${eventType}\n`);
  }
  res.write(`id: ${eventId}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// MCP Resource definitions (read-only documentation)
const MCP_RESOURCES = [
  {
    uri: "resource://opencode-manager/openapi",
    name: "OpenAPI Specification",
    description: "Complete OpenAPI 3.0 specification for the REST API",
    mimeType: "application/yaml",
  },
  {
    uri: "resource://opencode-manager/api/endpoints",
    name: "API Endpoints Summary",
    description:
      "Overview of all available REST API endpoints with descriptions",
    mimeType: "application/json",
  },
  {
    uri: "resource://opencode-manager/api/examples",
    name: "REST API Usage Examples",
    description: "Example curl commands for common operations",
    mimeType: "text/markdown",
  },
  {
    uri: "resource://opencode-manager/architecture",
    name: "Architecture Overview",
    description: "System architecture and how components interact",
    mimeType: "text/markdown",
  },
];

// MCP Tool definitions
const MCP_TOOLS = [
  {
    name: "search_api_docs",
    description:
      "Search through OpenCode Manager API documentation including endpoints, examples, and architecture. Returns full context for matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query or keywords to find in the documentation",
        },
        scope: {
          type: "string",
          enum: ["all", "endpoints", "examples", "architecture", "openapi"],
          description: "Scope of search (default: all)",
          default: "all",
        },
      },
      required: ["query"],
    },
  },
];

// Read MCP resource content
function readResource(uri: string): { content: string; mimeType: string } {
  switch (uri) {
    case "resource://opencode-manager/openapi": {
      const openapiPath = join(__dirname, "..", "openapi.yaml");
      const content = readFileSync(openapiPath, "utf-8");
      return { content, mimeType: "application/yaml" };
    }

    case "resource://opencode-manager/api/endpoints":
      return {
        content: JSON.stringify(
          {
            baseUrl: "http://127.0.0.1:4095",
            endpoints: {
              health: {
                method: "GET",
                path: "/health",
                description: "Health check endpoint",
              },
              projects: {
                list: {
                  method: "GET",
                  path: "/projects",
                  description: "List all registered projects",
                },
                get: {
                  method: "GET",
                  path: "/project/{path}",
                  description:
                    "Get project status (path must be base64url-encoded)",
                },
                ensure: {
                  method: "POST",
                  path: "/project/{path}/ensure",
                  description: "Start or ensure OpenCode server is running",
                },
                stop: {
                  method: "DELETE",
                  path: "/project/{path}",
                  description: "Stop OpenCode server for project",
                },
              },
              prompts: {
                send: {
                  method: "POST",
                  path: "/project/{path}/prompt",
                  description: "Send prompt to OpenCode server",
                  body: {
                    text: "string (required)",
                    file: "string (optional)",
                    line: "number (optional)",
                    col: "number (optional)",
                  },
                },
              },
              tui: {
                attachCli: {
                  method: "POST",
                  path: "/project/{path}/attach-tui-cli",
                  description: "Attach TUI in current tmux pane",
                },
                attachNeovim: {
                  method: "POST",
                  path: "/project/{path}/attach-tui-neovim",
                  description:
                    "Attach TUI from Neovim (focuses existing or creates new)",
                },
                focus: {
                  method: "POST",
                  path: "/project/{path}/focus-tui",
                  description: "Focus existing TUI pane",
                },
              },
              events: {
                stream: {
                  method: "GET",
                  path: "/project/{path}/events",
                  description: "Subscribe to Server-Sent Events for project",
                },
              },
              documentation: {
                swagger: {
                  method: "GET",
                  path: "/docs",
                  description: "Interactive API documentation (Swagger UI)",
                },
                mcp: {
                  method: "POST, GET, DELETE",
                  path: "/mcp",
                  description:
                    "MCP documentation endpoint (read-only discovery)",
                },
              },
            },
            notes: {
              pathEncoding: "Project paths must be base64url-encoded in URLs",
              baseUrl: "Server runs on http://127.0.0.1:4095",
              sse: "Use /project/{path}/events for real-time updates",
            },
          },
          null,
          2,
        ),
        mimeType: "application/json",
      };

    case "resource://opencode-manager/api/examples":
      return {
        content: `# OpenCode Manager REST API Examples

## Encode Project Path

Project paths must be base64url-encoded for use in URLs:

\`\`\`bash
# Example encoding
PROJECT_PATH="/path/to/your/project"
ENCODED=$(echo -n "$PROJECT_PATH" | base64 | tr '+/' '-_' | tr -d '=')
echo $ENCODED
\`\`\`

## Health Check

\`\`\`bash
curl http://127.0.0.1:4095/health
\`\`\`

## List All Projects

\`\`\`bash
curl http://127.0.0.1:4095/projects
\`\`\`

## Get Project Status

\`\`\`bash
# First encode the project path
ENCODED="L3BhdGgvdG8vcHJvamVjdA"

curl http://127.0.0.1:4095/project/$ENCODED
\`\`\`

## Start OpenCode Server

\`\`\`bash
ENCODED="L3BhdGgvdG8vcHJvamVjdA"

curl -X POST http://127.0.0.1:4095/project/$ENCODED/ensure
\`\`\`

**Response:**
\`\`\`json
{
  "port": 4097,
  "status": "running"
}
\`\`\`

## Send Prompt to OpenCode

\`\`\`bash
ENCODED="L3BhdGgvdG8vcHJvamVjdA"

curl -X POST http://127.0.0.1:4095/project/$ENCODED/prompt \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "Add error handling to the authentication module",
    "file": "/path/to/project/src/auth.ts",
    "line": 42
  }'
\`\`\`

**Note:** Returns 204 No Content. Listen to events endpoint for responses.

## Subscribe to Events (SSE)

\`\`\`bash
ENCODED="L3BhdGgvdG8vcHJvamVjdA"

curl -N http://127.0.0.1:4095/project/$ENCODED/events
\`\`\`

Streams real-time events:
- \`message.created\` - New message from OpenCode
- \`message.updated\` - Message content updated
- \`message.completed\` - Message fully completed
- \`part.updated\` - Message part updated

## Stop OpenCode Server

\`\`\`bash
ENCODED="L3BhdGgvdG8vcHJvamVjdA"

curl -X DELETE http://127.0.0.1:4095/project/$ENCODED
\`\`\`

## Attach TUI (Neovim)

\`\`\`bash
ENCODED="L3BhdGgvdG8vcHJvamVjdA"

curl -X POST http://127.0.0.1:4095/project/$ENCODED/attach-tui-neovim
\`\`\`

Focuses existing TUI or creates new tmux pane.

## Complete Workflow Example

\`\`\`bash
#!/bin/bash

PROJECT_PATH="/Users/you/projects/myapp"
ENCODED=$(echo -n "$PROJECT_PATH" | base64 | tr '+/' '-_' | tr -d '=')

# 1. Ensure server is running
echo "Starting server..."
curl -X POST "http://127.0.0.1:4095/project/$ENCODED/ensure"

# 2. Send a prompt
echo "Sending prompt..."
curl -X POST "http://127.0.0.1:4095/project/$ENCODED/prompt" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Review the authentication code for security issues"}'

# 3. Monitor events (in another terminal)
echo "Listening for events..."
curl -N "http://127.0.0.1:4095/project/$ENCODED/events"
\`\`\`

## Interactive API Documentation

Visit http://127.0.0.1:4095/docs for full Swagger UI documentation.
`,
        mimeType: "text/markdown",
      };

    case "resource://opencode-manager/architecture":
      return {
        content: `# OpenCode Manager Architecture

## Overview

OpenCode Manager is a global server manager for multi-project OpenCode workflows. It manages multiple OpenCode AI assistant servers across different projects from a single HTTP API.

## System Architecture

\`\`\`
┌─────────────────────────────────────────────┐
│         OpenCode Manager (Port 4095)        │
│                                             │
│  ┌──────────────────────────────────┐      │
│  │     HTTP Server (Express)        │      │
│  │  • REST API                      │      │
│  │  • MCP Documentation (/mcp)      │      │
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
\`\`\`

## Components

### HTTP Server (Express)
- Runs on \`http://127.0.0.1:4095\`
- Provides REST API for all operations
- Serves interactive API documentation
- Handles Server-Sent Events for real-time updates
- Exposes MCP endpoint for API discovery

### Project Registry
- In-memory store of all registered projects
- Tracks OpenCode server port, PID, status
- Manages TUI (Terminal UI) attachment state
- Records timestamps for activity tracking

### OpenCode Server Lifecycle Manager
- Spawns OpenCode server processes per project
- Health checking and automatic recovery
- Port allocation (starting at 4097)
- Process management and cleanup

### Tmux Integration
- Manages Terminal UI in tmux panes
- Creates/focuses panes for project TUIs
- Supports CLI and Neovim attachment modes
- Window and session management

### Event System
- Server-Sent Events (SSE) for real-time updates
- Forwards events from OpenCode servers to clients
- Per-project event streams
- Automatic connection management

### MCP Documentation Endpoint
- **Read-only** endpoint for API discovery
- Exposes REST API structure as MCP Resources
- No executable actions - documentation only
- AI agents use this to learn the REST API

## Data Flow

### 1. Start Server Request
\`\`\`
Client → POST /project/{path}/ensure
  ↓
Manager checks registry
  ↓
If not running:
  - Allocate port (4097+)
  - Spawn opencode serve process
  - Wait for health check
  - Register in project registry
  ↓
Return port number to client
\`\`\`

### 2. Send Prompt Request
\`\`\`
Client → POST /project/{path}/prompt
  ↓
Manager ensures server is running
  ↓
Send prompt via OpenCode SDK
  ↓
Return 204 No Content
  ↓
Client listens to /project/{path}/events for response
\`\`\`

### 3. Event Streaming
\`\`\`
Client → GET /project/{path}/events (SSE)
  ↓
Manager opens SSE connection
  ↓
OpenCode SDK streams events
  ↓
Manager forwards to client via SSE
  ↓
Events: message.created, message.updated, etc.
\`\`\`

## Port Allocation

- Manager: **4095** (fixed)
- Projects: **4097+** (auto-incrementing)
- Each project gets unique port
- Ports recycled when servers stop

## Session Management

### REST API
- Stateless
- No session management needed
- Each request is independent

### MCP Documentation
- Stateful sessions with UUIDs
- 1 hour inactivity timeout
- Session cleanup every 5 minutes
- Used only for MCP protocol compliance

## Security

- **Localhost only**: Binds to 127.0.0.1
- **No authentication**: Assumes trusted local environment
- **Process isolation**: Each project in separate process
- **Automatic cleanup**: Sessions and servers timeout

## Dependencies

- Node.js (latest LTS)
- Express 5.x
- @opencode-ai/sdk
- OpenCode CLI in PATH
- tmux (for TUI features)

## Configuration

All configuration is hardcoded for simplicity:
- Port: 4095
- Host: 127.0.0.1
- Session timeout: 1 hour
- Health check interval: As needed
- SSE ping interval: 30 seconds

## Extension Points

The manager can be extended with:
- Authentication layer
- Rate limiting
- Metrics and monitoring
- Remote server management
- Multi-user support
- Project configuration persistence
`,
        mimeType: "text/markdown",
      };

    default:
      throw new Error(`Resource not found: ${uri}`);
  }
}

// Search result interface
interface SearchResult {
  score: number;
  resource: string;
  section: string;
  match: string;
  description: string;
  context: string;
  relevance: string;
}

// Calculate similarity between two strings (simple implementation)
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  // Exact match
  if (s1 === s2) return 1.0;

  // Calculate Levenshtein distance
  const matrix: number[][] = [];
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2[i - 1] === s1[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  const distance = matrix[s2.length][s1.length];
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}

// Suggest similar queries based on common documentation terms
function suggestSimilarQueries(query: string): string[] {
  const commonTerms = [
    "start server",
    "stop server",
    "send prompt",
    "list projects",
    "health check",
    "attach tui",
    "events stream",
    "sse",
    "project status",
    "base64 encoding",
    "tmux",
    "openapi",
    "architecture",
    "examples",
    "endpoints",
  ];

  // Calculate similarity for each common term
  const similarities = commonTerms.map((term) => ({
    term,
    similarity: calculateSimilarity(query.toLowerCase(), term),
  }));

  // Sort by similarity and return top 3
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map((item) => item.term);
}

// Search documentation
function searchDocumentation(
  query: string,
  scope: string = "all",
): {
  query: string;
  results: SearchResult[];
  suggestions?: string[];
  total_matches: number;
} {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter((k) => k.length > 0);

  // Helper to calculate match score
  const calculateScore = (text: string, section: string): number => {
    const textLower = text.toLowerCase();
    let score = 0;

    // Exact phrase match (highest priority)
    if (textLower.includes(queryLower)) {
      score += 100;
    }

    // All keywords present
    const allKeywordsPresent = keywords.every((k) => textLower.includes(k));
    if (allKeywordsPresent) {
      score += 50;
    }

    // Count keyword matches
    keywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, "gi");
      const matches = textLower.match(regex);
      if (matches) {
        score += matches.length * 10;
      }
    });

    // Bonus for matches in section name
    if (section.toLowerCase().includes(queryLower)) {
      score += 30;
    }

    return score;
  };

  // Helper to extract context around a match
  const extractContext = (text: string, maxLength: number = 300): string => {
    const lines = text.split("\n");
    const matchingLines: string[] = [];

    for (const line of lines) {
      if (keywords.some((k) => line.toLowerCase().includes(k))) {
        matchingLines.push(line);
        if (matchingLines.join("\n").length > maxLength) {
          break;
        }
      }
    }

    if (matchingLines.length === 0 && lines.length > 0) {
      return lines.slice(0, 3).join("\n");
    }

    return matchingLines.join("\n").substring(0, maxLength);
  };

  // Search OpenAPI spec
  if (scope === "all" || scope === "openapi") {
    try {
      const { content } = readResource("resource://opencode-manager/openapi");
      const score = calculateScore(content, "OpenAPI Specification");

      if (score > 0) {
        results.push({
          score,
          resource: "openapi",
          section: "OpenAPI Specification",
          match: "Complete OpenAPI 3.0 specification",
          description: "Full API specification in YAML format",
          context: extractContext(content),
          relevance:
            score > 100
              ? "exact phrase match"
              : `${keywords.length} keyword(s) found`,
        });
      }
    } catch (_error) {
      // Skip on error
    }
  }

  // Search endpoints
  if (scope === "all" || scope === "endpoints") {
    try {
      const { content } = readResource(
        "resource://opencode-manager/api/endpoints",
      );
      const endpoints = JSON.parse(content);

      const searchEndpoints = (obj: any, path: string = ""): void => {
        for (const [key, value] of Object.entries(obj)) {
          const currentPath = path ? `${path}.${key}` : key;

          if (typeof value === "object" && value !== null) {
            const valueStr = JSON.stringify(value);
            const score = calculateScore(valueStr, currentPath);

            if (score > 0 && "method" in value && "path" in value) {
              const endpoint = value as {
                method: string;
                path: string;
                description?: string;
              };
              results.push({
                score,
                resource: "api/endpoints",
                section: currentPath,
                match: `${endpoint.method} ${endpoint.path}`,
                description: endpoint.description || "",
                context: JSON.stringify(value, null, 2),
                relevance:
                  score > 100
                    ? "exact phrase match"
                    : `${keywords.length} keyword(s) found`,
              });
            } else if (score > 0) {
              searchEndpoints(value, currentPath);
            }
          }
        }
      };

      searchEndpoints(endpoints);
    } catch (_error) {
      // Skip on error
    }
  }

  // Search examples
  if (scope === "all" || scope === "examples") {
    try {
      const { content } = readResource(
        "resource://opencode-manager/api/examples",
      );
      const sections = content
        .split(/^## /gm)
        .filter((s) => s.trim().length > 0);

      for (const section of sections) {
        const lines = section.split("\n");
        const sectionName = lines[0].trim();
        const score = calculateScore(section, sectionName);

        if (score > 0) {
          results.push({
            score,
            resource: "api/examples",
            section: sectionName,
            match: `Example: ${sectionName}`,
            description: `Usage example from documentation`,
            context: extractContext(section, 500),
            relevance:
              score > 100
                ? "exact phrase match"
                : `${keywords.length} keyword(s) found`,
          });
        }
      }
    } catch (_error) {
      // Skip on error
    }
  }

  // Search architecture
  if (scope === "all" || scope === "architecture") {
    try {
      const { content } = readResource(
        "resource://opencode-manager/architecture",
      );
      const sections = content
        .split(/^## /gm)
        .filter((s) => s.trim().length > 0);

      for (const section of sections) {
        const lines = section.split("\n");
        const sectionName = lines[0].trim();
        const score = calculateScore(section, sectionName);

        if (score > 0) {
          results.push({
            score,
            resource: "architecture",
            section: sectionName,
            match: `Architecture: ${sectionName}`,
            description: `Architecture documentation section`,
            context: extractContext(section, 500),
            relevance:
              score > 100
                ? "exact phrase match"
                : `${keywords.length} keyword(s) found`,
          });
        }
      }
    } catch (_error) {
      // Skip on error
    }
  }

  // Sort by score and take top 10
  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, 10);

  // If no results, suggest similar queries
  const suggestions =
    topResults.length === 0 ? suggestSimilarQueries(query) : undefined;

  return {
    query,
    results: topResults,
    suggestions,
    total_matches: results.length,
  };
}

// Handle MCP POST requests
export async function handleMcpPost(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    // Validate protocol version
    const protocolVersion = validateProtocolVersion(req);
    if (!protocolVersion) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid or unsupported MCP-Protocol-Version header",
        },
      });
      return;
    }

    // Validate Accept header
    if (!validateAcceptHeader(req)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message:
            "Accept header must include application/json or text/event-stream",
        },
      });
      return;
    }

    const request = req.body;

    // Validate JSON-RPC
    if (request.jsonrpc !== "2.0") {
      res.status(400).json({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32600, message: "Invalid JSON-RPC version" },
      });
      return;
    }

    const { method, params, id } = request;

    // Get session (except for initialize)
    const sessionId = req.header("Mcp-Session-Id");
    let session: McpSession | null = null;

    if (method !== "initialize") {
      session = getSession(sessionId);

      if (!session && sessionId) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Session not found or expired",
          },
        });
        return;
      }
    }

    // Handle initialize
    if (method === "initialize") {
      const newSession = createSession();

      const response = {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: {
            name: "opencode-manager",
            version: "1.0.0",
          },
          capabilities: {
            resources: {},
            tools: {},
          },
        },
      };

      res.setHeader("Mcp-Session-Id", newSession.id);
      res.json(response);
      return;
    }

    // Handle notifications (return 202)
    if (
      !id ||
      method === "notifications/initialized" ||
      method === "notifications/cancelled"
    ) {
      res.status(202).send();
      return;
    }

    // Handle resources/list
    if (method === "resources/list") {
      const response = {
        jsonrpc: "2.0",
        id,
        result: { resources: MCP_RESOURCES },
      };

      // Check if client prefers SSE
      const accept = req.header("Accept") || "";
      const prefersSSE =
        accept.indexOf("text/event-stream") <
        accept.indexOf("application/json");

      if (prefersSSE && session) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const eventId = `${session.id}-${session.eventCounter++}`;
        sendSseEvent(res, response, eventId);
        res.end();
      } else {
        res.json(response);
      }
      return;
    }

    // Handle resources/read
    if (method === "resources/read") {
      const { uri } = params as { uri: string };

      if (!uri) {
        res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Missing required parameter: uri",
          },
        });
        return;
      }

      try {
        const { content, mimeType } = readResource(uri);

        const response = {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType,
                text: content,
              },
            ],
          },
        };

        // Check if client prefers SSE
        const accept = req.header("Accept") || "";
        const prefersSSE =
          accept.indexOf("text/event-stream") <
          accept.indexOf("application/json");

        if (prefersSSE && session) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders();

          const eventId = `${session.id}-${session.eventCounter++}`;
          sendSseEvent(res, response, eventId);
          res.end();
        } else {
          res.json(response);
        }
      } catch (error) {
        res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return;
    }

    // Handle tools/list
    if (method === "tools/list") {
      const response = {
        jsonrpc: "2.0",
        id,
        result: { tools: MCP_TOOLS },
      };

      // Check if client prefers SSE
      const accept = req.header("Accept") || "";
      const prefersSSE =
        accept.indexOf("text/event-stream") <
        accept.indexOf("application/json");

      if (prefersSSE && session) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const eventId = `${session.id}-${session.eventCounter++}`;
        sendSseEvent(res, response, eventId);
        res.end();
      } else {
        res.json(response);
      }
      return;
    }

    // Handle tools/call
    if (method === "tools/call") {
      const { name, arguments: args } = params as {
        name: string;
        arguments: any;
      };

      if (!name) {
        res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Missing required parameter: name",
          },
        });
        return;
      }

      if (name === "search_api_docs") {
        try {
          const query = args?.query;
          const scope = args?.scope || "all";

          if (!query || typeof query !== "string") {
            res.json({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32602,
                message:
                  "Missing or invalid required parameter: query (must be a string)",
              },
            });
            return;
          }

          const searchResults = searchDocumentation(query, scope);

          const response = {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(searchResults, null, 2),
                },
              ],
            },
          };

          // Check if client prefers SSE
          const accept = req.header("Accept") || "";
          const prefersSSE =
            accept.indexOf("text/event-stream") <
            accept.indexOf("application/json");

          if (prefersSSE && session) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders();

            const eventId = `${session.id}-${session.eventCounter++}`;
            sendSseEvent(res, response, eventId);
            res.end();
          } else {
            res.json(response);
          }
        } catch (error) {
          res.json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
        return;
      }

      // Unknown tool
      res.json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: `Unknown tool: ${name}`,
        },
      });
      return;
    }

    // Unknown method
    res.status(400).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  } catch (error) {
    res.status(500).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal error",
      },
    });
  }
}

// Handle MCP GET requests (SSE stream for server-initiated messages)
export function handleMcpGet(req: Request, res: Response): void {
  const protocolVersion = validateProtocolVersion(req);
  if (!protocolVersion) {
    res.status(400).send("Invalid or unsupported MCP-Protocol-Version header");
    return;
  }

  if (!validateAcceptHeader(req, true)) {
    res
      .status(405)
      .send(
        "Method Not Allowed - Accept header must include text/event-stream",
      );
    return;
  }

  const sessionId = req.header("Mcp-Session-Id");
  const session = getSession(sessionId);

  if (!session) {
    res.status(404).send("Session not found or expired");
    return;
  }

  const lastEventId = req.header("Last-Event-Id") || null;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const streamId = randomUUID();
  const stream: SseStream = {
    res,
    eventCounter: session.eventCounter,
    lastEventId,
  };

  session.pendingStreams.set(streamId, stream);

  const eventId = `${session.id}-${session.eventCounter++}`;
  res.write(`id: ${eventId}\n`);
  res.write(`: connection established\n\n`);

  const pingInterval = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch (_error) {
      clearInterval(pingInterval);
    }
  }, 30000);

  req.on("close", () => {
    clearInterval(pingInterval);
    session.pendingStreams.delete(streamId);
  });
}

// Handle MCP DELETE requests (session termination)
export function handleMcpDelete(req: Request, res: Response): void {
  const sessionId = req.header("Mcp-Session-Id");

  if (!sessionId) {
    res.status(400).send("Mcp-Session-Id header required");
    return;
  }

  const session = getSession(sessionId);

  if (!session) {
    res.status(404).send("Session not found");
    return;
  }

  for (const stream of session.pendingStreams.values()) {
    try {
      stream.res.end();
    } catch (_error) {
      // Stream already closed
    }
  }

  sessions.delete(sessionId);

  res.status(200).send("Session terminated");
}
