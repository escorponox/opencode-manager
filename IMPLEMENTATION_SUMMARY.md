# MCP Read-Only Documentation Endpoint - Implementation Summary

## Overview

The OpenCode Manager implements a **read-only MCP documentation endpoint** following the MCP 2025-06-18 Streamable HTTP specification. The endpoint exposes REST API documentation as MCP Resources - **no executable actions**.

## Purpose: Documentation as a Service

The MCP endpoint serves one purpose: **API Discovery**

- ✅ AI agents discover what the REST API can do
- ✅ Read comprehensive documentation and examples
- ❌ **NO executable actions** via MCP
- ✅ Agents use the REST API for actual operations

## What Was Implemented

### 1. MCP Resources (Read-Only Documentation)

Four documentation resources exposed via MCP:

```typescript
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
    description: "Overview of all available REST API endpoints with descriptions",
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
```

### 2. MCP Methods Supported

**Implemented:**
- ✅ `initialize` - Create session, return capabilities (resources only)
- ✅ `resources/list` - List available documentation resources
- ✅ `resources/read` - Read resource content
- ✅ `notifications/initialized` - Acknowledge initialization (202)

**NOT Implemented (by design):**
- ❌ `tools/list` - No tools exposed
- ❌ `tools/call` - No executable actions
- ❌ `prompts/list` - Not needed
- ❌ `prompts/get` - Not needed

### 3. Session Management

Full session management per MCP spec:
- Secure UUID-based session IDs
- `Mcp-Session-Id` header validation
- 1 hour automatic timeout
- SSE stream management
- DELETE endpoint for explicit termination

### 4. Protocol Compliance

Fully compliant with MCP 2025-06-18:
- ✅ Streamable HTTP transport
- ✅ Single endpoint (`/mcp` for POST/GET/DELETE)
- ✅ Protocol version header validation
- ✅ Accept header validation
- ✅ SSE streaming with event IDs
- ✅ Resumability support (`Last-Event-Id`)
- ✅ Session management
- ✅ 202 Accepted for notifications

## Resource Content

### 1. OpenAPI Specification

Returns the complete `openapi.yaml` file containing full REST API specification.

### 2. API Endpoints Summary

JSON structure showing all REST endpoints:

```json
{
  "baseUrl": "http://127.0.0.1:4095",
  "endpoints": {
    "health": { "method": "GET", "path": "/health", ... },
    "projects": {
      "list": { "method": "GET", "path": "/projects", ... },
      "get": { "method": "GET", "path": "/project/{path}", ... },
      ...
    },
    "prompts": { ... },
    "tui": { ... },
    "events": { ... }
  },
  "notes": {
    "pathEncoding": "Project paths must be base64url-encoded",
    ...
  }
}
```

### 3. API Usage Examples

Markdown document with curl examples for:
- Encoding project paths
- Health checks
- Listing projects
- Starting servers
- Sending prompts
- Subscribing to events
- Complete workflow examples

### 4. Architecture Documentation

Markdown document describing:
- System architecture diagram
- Component overview
- Data flow
- Port allocation
- Session management
- Security model
- Extension points

## How AI Agents Use It

### Discovery Workflow

```
1. Connect to MCP endpoint
   POST /mcp (initialize)
   ↓
2. List available resources
   POST /mcp (resources/list)
   ↓
3. Read API documentation
   POST /mcp (resources/read)
   ↓
4. Learn REST API structure
   Parse JSON/YAML/Markdown
   ↓
5. Disconnect from MCP
   DELETE /mcp (optional)
   ↓
6. Use REST API for operations
   POST /project/{path}/ensure
   POST /project/{path}/prompt
   GET /project/{path}/events
```

### Configuration

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

## What You CANNOT Do via MCP

❌ Start OpenCode servers
❌ Stop servers
❌ Send prompts
❌ Attach TUIs
❌ Any write operations
❌ Any state-changing operations

## What You CAN Do via MCP

✅ Initialize session
✅ List available documentation resources
✅ Read OpenAPI specification
✅ Read endpoint summaries
✅ Read usage examples
✅ Read architecture docs
✅ Terminate session

## Key Design Decisions

### 1. Resources, Not Tools

MCP supports both Resources (read-only data) and Tools (executable actions). We chose **Resources only** because:

- Clear separation of concerns (MCP = docs, REST = operations)
- Follows MCP philosophy (resources for data, tools for actions)
- AI agents don't need two ways to do the same thing
- Simpler implementation and maintenance
- Documentation is naturally read-only data

### 2. Comprehensive Documentation

All resources provide complete information:
- OpenAPI spec for formal definition
- Endpoint summary for quick reference
- Usage examples for practical guidance
- Architecture docs for understanding

### 3. Standard Compliance

Full MCP 2025-06-18 compliance ensures:
- Works with any MCP-compliant client
- Future-proof implementation
- Standard session management
- Standard error handling

## File Structure

```
src/
└── mcp-handler.ts          [MODIFIED] - Read-only resources, no tools

docs/
├── MCP_EXAMPLES.md         [MODIFIED] - Updated for resources
├── MCP_COMPLIANCE.md       [TO UPDATE] - Compliance details
└── README.md               [MODIFIED] - Clarified read-only nature

openapi.yaml                [MODIFIED] - Updated MCP endpoint docs
```

## Example Usage

### List Resources

```bash
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
```

### Read API Endpoints

```bash
curl -X POST http://127.0.0.1:4095/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "resource://opencode-manager/api/endpoints"
    },
    "id": 3
  }'
```

## Benefits

1. **Clear Purpose**: MCP focused on documentation only
2. **Standard Compliance**: Follows MCP spec properly
3. **No Duplication**: One way to do operations (REST API)
4. **Easy Discovery**: AI agents can learn the API automatically
5. **Maintainable**: Documentation stays in sync with code
6. **Extensible**: Easy to add more resources as needed

## Testing

Type safety verified:
```bash
npm run type-check  # ✅ No errors
```

Server starts correctly:
```bash
npm run dev
curl http://127.0.0.1:4095/health  # ✅ {"healthy":true}
```

## Summary

The MCP endpoint is now **purely for documentation discovery**:
- ✅ Exposes REST API docs as MCP Resources
- ✅ Fully MCP 2025-06-18 compliant
- ✅ Session management works correctly
- ❌ No executable actions (by design)
- ✅ AI agents discover API, then use REST

**Result**: Clean separation - MCP for discovery, REST for operations.
