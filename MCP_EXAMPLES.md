# MCP Documentation Endpoint Examples

This document shows how to use the **MCP documentation endpoint** to discover the OpenCode Manager REST API.

## Important: MCP is Read-Only

The MCP endpoint at `/mcp` is **documentation only**. It exposes:
- ✅ API structure and available endpoints (as MCP Resources)
- ✅ Usage examples and documentation
- ✅ OpenAPI specification
- ❌ **NO executable actions** - use the REST API for operations

AI agents should:
1. Use MCP to **discover** what the REST API can do
2. Use the **REST API** (not MCP tools) to actually perform operations

## MCP Resources Available

- `resource://opencode-manager/openapi` - Full OpenAPI spec (YAML)
- `resource://opencode-manager/api/endpoints` - Endpoint summary (JSON)
- `resource://opencode-manager/api/examples` - Usage examples (Markdown)
- `resource://opencode-manager/architecture` - System architecture (Markdown)

## Session Lifecycle

### 1. Initialize Session

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "clientInfo": {
        "name": "example-client",
        "version": "1.0.0"
      },
      "capabilities": {}
    },
    "id": 1
  }' \
  -i
```

**Response:**
```
HTTP/1.1 200 OK
Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "serverInfo": {
      "name": "opencode-manager",
      "version": "1.0.0"
    },
    "capabilities": {
      "resources": {}
    }
  }
}
```

Note: **Only resources** capability - no tools, no prompts!

### 2. Send Initialized Notification

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  }'
```

**Response:**
```
HTTP/1.1 202 Accepted
```

## Discovering the REST API

### 3. List Available Resources

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/list",
    "params": {},
    "id": 2
  }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "resources": [
      {
        "uri": "resource://opencode-manager/openapi",
        "name": "OpenAPI Specification",
        "description": "Complete OpenAPI 3.0 specification for the REST API",
        "mimeType": "application/yaml"
      },
      {
        "uri": "resource://opencode-manager/api/endpoints",
        "name": "API Endpoints Summary",
        "description": "Overview of all available REST API endpoints with descriptions",
        "mimeType": "application/json"
      },
      {
        "uri": "resource://opencode-manager/api/examples",
        "name": "REST API Usage Examples",
        "description": "Example curl commands for common operations",
        "mimeType": "text/markdown"
      },
      {
        "uri": "resource://opencode-manager/architecture",
        "name": "Architecture Overview",
        "description": "System architecture and how components interact",
        "mimeType": "text/markdown"
      }
    ]
  }
}
```

### 4. Read API Endpoints Summary

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "resource://opencode-manager/api/endpoints"
    },
    "id": 3
  }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "contents": [
      {
        "uri": "resource://opencode-manager/api/endpoints",
        "mimeType": "application/json",
        "text": "{\n  \"baseUrl\": \"http://127.0.0.1:4095\",\n  \"endpoints\": {\n    \"health\": {...},\n    \"projects\": {...},\n    ...\n  }\n}"
      }
    ]
  }
}
```

### 5. Read Usage Examples

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "resource://opencode-manager/api/examples"
    },
    "id": 4
  }'
```

Returns markdown with curl examples for all REST operations.

### 6. Read OpenAPI Specification

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "resource://opencode-manager/openapi"
    },
    "id": 5
  }'
```

Returns the complete OpenAPI 3.0 specification in YAML format.

### 7. Read Architecture Documentation

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "resource://opencode-manager/architecture"
    },
    "id": 6
  }'
```

Returns markdown with system architecture details.

## SSE Streaming

You can request SSE responses by preferring `text/event-stream` in the Accept header:

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: text/event-stream, application/json" \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/list",
    "params": {},
    "id": 2
  }' \
  -N
```

**Response (SSE):**
```
HTTP/1.1 200 OK
Content-Type: text/event-stream

id: 550e8400-e29b-41d4-a716-446655440000-0
data: {"jsonrpc":"2.0","id":2,"result":{"resources":[...]}}

```

## Session Termination

```bash
curl -X DELETE http://127.0.0.1:4095/mcp \
  -H "Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000"
```

**Response:**
```
HTTP/1.1 200 OK

Session terminated
```

## Using MCP with AI Agents

Configure your AI agent to connect to the MCP documentation endpoint:

**For OpenCode / Claude Desktop:**

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

The AI agent will:
1. Connect via MCP and discover available resources
2. Read the API documentation resources
3. Learn how to use the REST API
4. **Use the REST API directly** for actual operations (not MCP)

## Workflow for AI Agents

```
1. Connect to MCP endpoint
   ↓
2. Call resources/list
   ↓
3. Read resource://opencode-manager/api/endpoints
   ↓
4. Learn REST API structure
   ↓
5. Disconnect from MCP
   ↓
6. Use REST API directly for operations:
   - POST /project/{path}/ensure (start server)
   - POST /project/{path}/prompt (send prompt)
   - GET /project/{path}/events (listen for responses)
```

## Why Read-Only?

The MCP endpoint is intentionally read-only because:

1. **Clear separation**: MCP is for discovery, REST is for operations
2. **Standard compliance**: Follows MCP spec properly with Resources
3. **Simplicity**: AI agents don't need two ways to do the same thing
4. **Documentation**: Single source of truth for API capabilities
5. **Flexibility**: REST API can evolve independently

## What You Cannot Do via MCP

❌ Start OpenCode servers
❌ Stop servers  
❌ Send prompts
❌ Attach TUIs
❌ Any write operations

## What You CAN Do via MCP

✅ List available resources
✅ Read API documentation
✅ Read usage examples
✅ Read OpenAPI specification
✅ Read architecture docs

## Summary

The MCP endpoint provides **documentation as a service** - AI agents discover what the REST API can do, then use the REST API for actual operations. This keeps MCP focused on its strength (standardized discovery) while letting the REST API handle the actual work.
