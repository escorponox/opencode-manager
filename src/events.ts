import type { Response } from "express";
import { createLogger } from "./logger.ts";
import { getClient } from "./opencode.ts";
import { registry } from "./registry.ts";

const logger = createLogger({ module: "events" });

// Track active SSE connections per project
const connections: Map<string, Set<Response>> = new Map();

// Track active event streams per project
const activeStreams: Map<string, AbortController> = new Map();

export function addConnection(projectPath: string, res: Response): void {
  if (!connections.has(projectPath)) {
    connections.set(projectPath, new Set());
  }
  connections.get(projectPath)?.add(res);

  // Start forwarding if not already active
  if (!activeStreams.has(projectPath)) {
    startEventForwarding(projectPath);
  }

  res.on("close", () => {
    connections.get(projectPath)?.delete(res);
    if (connections.get(projectPath)?.size === 0) {
      connections.delete(projectPath);
      // Stop the event stream if no more listeners
      const controller = activeStreams.get(projectPath);
      if (controller) {
        controller.abort();
        activeStreams.delete(projectPath);
      }
    }
  });
}

function broadcast(projectPath: string, event: string, data: unknown): void {
  const projectConnections = connections.get(projectPath);
  if (!projectConnections) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of projectConnections) {
    try {
      res.write(message);
    } catch (error) {
      logger.error(
        { error, projectPath, event },
        "Failed to write to SSE connection",
      );
    }
  }
}

async function startEventForwarding(projectPath: string): Promise<void> {
  const entry = registry.get(projectPath);
  if (!entry || entry.status !== "running") {
    logger.warn(
      { projectPath },
      "Cannot start event forwarding: no running server",
    );
    return;
  }

  const controller = new AbortController();
  activeStreams.set(projectPath, controller);

  const client = getClient(entry.port);

  logger.info({ projectPath }, "Starting event forwarding");

  try {
    const events = await client.event.subscribe();

    for await (const event of events.stream) {
      // Check if we should stop
      if (controller.signal.aborted) {
        break;
      }

      // Filter and forward relevant events
      const eventObj = event as { type?: string; properties?: unknown };
      const eventType = eventObj.type;
      const properties = eventObj.properties;

      if (
        eventType === "message.created" ||
        eventType === "message.updated" ||
        eventType === "message.completed" ||
        eventType === "part.updated" ||
        eventType === "permission.requested" ||
        eventType === "session.updated"
      ) {
        broadcast(projectPath, eventType, properties);
      }

      // Check if project still has connections
      if (!connections.has(projectPath)) {
        break;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      logger.error({ error, projectPath }, "Event forwarding error");
      // Retry after a delay if we still have connections
      setTimeout(() => {
        if (connections.has(projectPath) && !activeStreams.has(projectPath)) {
          startEventForwarding(projectPath);
        }
      }, 5000);
    }
  } finally {
    activeStreams.delete(projectPath);
  }
}

export function stopEventForwarding(projectPath: string): void {
  const controller = activeStreams.get(projectPath);
  if (controller) {
    controller.abort();
    activeStreams.delete(projectPath);
  }
}
