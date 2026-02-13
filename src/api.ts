import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import express from "express";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { addConnection } from "./events.ts";
import { createLogger } from "./logger.ts";
import { handleMcpDelete, handleMcpGet, handleMcpPost } from "./mcp-handler.ts";
import {
  isTUIAttached,
  sendPromptAsync,
  startServer,
  stopServer,
} from "./opencode.ts";
import { registry } from "./registry.ts";
import { handleManagerLogs, handleStatusPage } from "./status-page.ts";
import {
  attachTUI,
  attachTUIInPlace,
  focusTUI,
  isTmuxRunning,
} from "./tmux.ts";

const logger = createLogger({ module: "api" });

export const router = express.Router();

// Load OpenAPI spec
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const openapiPath = join(__dirname, "..", "openapi.yaml");
const openapiSpec = YAML.parse(readFileSync(openapiPath, "utf-8"));

// Decode base64url project path from URL
function decodePath(encoded: string): string {
  // Add back padding if needed
  let padded = encoded;
  const padding = encoded.length % 4;
  if (padding === 2) {
    padded += "==";
  } else if (padding === 3) {
    padded += "=";
  }
  // Convert from base64url to base64
  padded = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

// API Documentation
router.use("/docs", swaggerUi.serve);
router.get(
  "/docs",
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: "OpenCode Manager API",
    customCss: ".swagger-ui .topbar { display: none }",
  }),
);

// MCP Protocol endpoints (Streamable HTTP - single endpoint)
router.post("/mcp", handleMcpPost);
router.get("/mcp", handleMcpGet);
router.delete("/mcp", handleMcpDelete);

// Health check
router.get("/health", (_req: Request, res: Response) => {
  res.json({ healthy: true, version: "1.0.0" });
});

// List all projects
router.get("/projects", (_req: Request, res: Response) => {
  res.json(registry.getAll());
});

// Status page (HTML UI)
router.get("/status", handleStatusPage);

// Get manager logs
router.get("/manager-logs", handleManagerLogs);

// Get project status
router.get("/project/:path", (req: Request, res: Response) => {
  try {
    const projectPath = decodePath(String(req.params.path));
    const entry = registry.get(projectPath);
    if (!entry) {
      res.status(404).json({ error: "Project not found" });
    } else {
      res.json(entry);
    }
  } catch (_error) {
    res.status(400).json({ error: "Invalid path encoding" });
  }
});

// Ensure server is running for project
router.post("/project/:path/ensure", async (req: Request, res: Response) => {
  try {
    const projectPath = decodePath(String(req.params.path));
    const port = await startServer(projectPath);
    res.json({ port, status: "running" });
  } catch (error) {
    logger.error(
      { error, projectPath: req.params.path },
      "Error ensuring server",
    );
    res.status(500).json({ error: String(error) });
  }
});

// Send prompt to project
router.post("/project/:path/prompt", async (req: Request, res: Response) => {
  try {
    const projectPath = decodePath(String(req.params.path));
    const { text, file, line, col } = req.body;

    if (!text) {
      res.status(400).json({ error: "Missing 'text' in request body" });
    } else {
      // Ensure server is running
      await startServer(projectPath);

      // Send prompt asynchronously - returns immediately
      await sendPromptAsync(projectPath, text, { file, line, col });

      // Return 204 No Content - client should listen to /project/:path/events for updates
      res.status(204).send();
    }
  } catch (error) {
    logger.error(
      { error, projectPath: req.params.path },
      "Error sending prompt",
    );
    res.status(500).json({ error: String(error) });
  }
});

// Attach TUI in CLI (current shell/pane)
router.post(
  "/project/:path/attach-tui-cli",
  async (req: Request, res: Response) => {
    try {
      const projectPath = decodePath(String(req.params.path));

      if (!isTmuxRunning()) {
        res.status(400).json({ error: "Tmux session 'dev' is not running" });
        return;
      }

      const entry = registry.get(projectPath);

      // If TUI is marked as attached, check if it's actually running
      if (entry && entry.hasTUI && entry.status === "running") {
        if (!isTUIAttached(entry.port)) {
          // TUI has exited, clean up stale data
          logger.info(
            { projectPath, port: entry.port },
            "TUI has exited, cleaning up stale data",
          );
          registry.clearTUI(projectPath);
        }
      }

      // Ensure server is running
      const port = await startServer(projectPath);

      // Get session ID from registry (if available)
      const updatedEntry = registry.get(projectPath);
      const sessionId = updatedEntry?.sessionId ?? undefined;

      // Attach TUI in the current pane (in place)
      const pane = await attachTUIInPlace(projectPath, port, sessionId);

      // Update registry with current pane info
      registry.setTUI(projectPath, pane.session, pane.window, pane.paneId);

      res.json({ success: true, pane });
    } catch (error) {
      logger.error(
        { error, projectPath: req.params.path },
        "Error attaching TUI (CLI)",
      );
      res.status(500).json({ error: String(error) });
    }
  },
);

// Attach TUI from Neovim (focus existing or create new pane)
router.post(
  "/project/:path/attach-tui-neovim",
  async (req: Request, res: Response) => {
    try {
      const projectPath = decodePath(String(req.params.path));

      if (!isTmuxRunning()) {
        res.status(400).json({ error: "Tmux session 'dev' is not running" });
        return;
      }

      const entry = registry.get(projectPath);

      // If server running AND TUI attached, check if TUI is actually running
      if (
        entry &&
        entry.status === "running" &&
        entry.hasTUI &&
        entry.tmuxPane
      ) {
        // Check if TUI process is actually attached
        if (!isTUIAttached(entry.port)) {
          // TUI has exited, clean up stale data
          logger.info(
            { projectPath, port: entry.port },
            "TUI has exited, cleaning up stale data",
          );
          registry.clearTUI(projectPath);
          // Fall through to create new TUI
        } else {
          // TUI is running, try to focus existing pane
          try {
            focusTUI(entry.tmuxPane);
            res.json({ success: true, focused: true, pane: entry.tmuxPane });
            return;
          } catch (_error) {
            // Pane no longer exists, clean up and fall through
            logger.info(
              { projectPath, pane: entry.tmuxPane },
              "Tmux pane no longer exists, cleaning up",
            );
            registry.clearTUI(projectPath);
            // Fall through to create new TUI
          }
        }
      }

      // Otherwise: ensure server running and create new pane
      const port = await startServer(projectPath);

      // Get session ID from registry (if available)
      const updatedEntry = registry.get(projectPath);
      const sessionId = updatedEntry?.sessionId ?? undefined;

      const pane = await attachTUI(projectPath, port, sessionId);

      // Update registry
      registry.setTUI(projectPath, pane.session, pane.window, pane.paneId);

      res.json({ success: true, created: true, pane });
    } catch (error) {
      logger.error(
        { error, projectPath: req.params.path },
        "Error attaching TUI (Neovim)",
      );
      res.status(500).json({ error: String(error) });
    }
  },
);

// Focus existing TUI pane
router.post("/project/:path/focus-tui", (req: Request, res: Response) => {
  try {
    const projectPath = decodePath(String(req.params.path));
    const entry = registry.get(projectPath);

    if (!entry || !entry.hasTUI || !entry.tmuxPane) {
      res.status(404).json({ error: "No TUI attached for this project" });
      return;
    }

    // Check if TUI process is actually attached
    if (!isTUIAttached(entry.port)) {
      // TUI has exited, clean up stale data
      logger.info(
        { projectPath, port: entry.port },
        "TUI has exited, cleaning up stale data",
      );
      registry.clearTUI(projectPath);
      res.status(404).json({ error: "No TUI attached for this project" });
      return;
    }

    // TUI is running, focus the pane
    focusTUI(entry.tmuxPane);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error, projectPath: req.params.path }, "Error focusing TUI");
    res.status(500).json({ error: String(error) });
  }
});

// SSE events for project
router.get("/project/:path/events", (req: Request, res: Response) => {
  try {
    const projectPath = decodePath(String(req.params.path));
    const entry = registry.get(projectPath);

    if (!entry || entry.status !== "running") {
      res.status(404).json({ error: "No running server for this project" });
    } else {
      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
      res.flushHeaders();

      // Send initial connection event
      res.write(
        `event: connected\ndata: ${JSON.stringify({ projectPath })}\n\n`,
      );

      // Add to connections for event forwarding
      addConnection(projectPath, res);
    }
  } catch (error) {
    logger.error(
      { error, projectPath: req.params.path },
      "Error setting up events",
    );
    res.status(400).json({ error: "Invalid path encoding" });
  }
});

// Stop server for project
router.delete("/project/:path", async (req: Request, res: Response) => {
  try {
    const projectPath = decodePath(String(req.params.path));
    const stopped = await stopServer(projectPath);
    res.json({ success: stopped });
  } catch (error) {
    logger.error(
      { error, projectPath: req.params.path },
      "Error stopping server",
    );
    res.status(500).json({ error: String(error) });
  }
});
