import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { router } from "./api.ts";
import { logger } from "./logger.ts";
import {
  forceKillAll,
  killAllAttachProcesses,
  stopAllServers,
} from "./opencode.ts";
import { registry } from "./registry.ts";

const PORT = 4095;
const HOST = "127.0.0.1";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path }, "HTTP request");
  next();
});

// API routes
app.use("/", router);

// Error handling
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: err.message });
});

// Initialize port allocation before starting server
await registry.initializePortAllocation();

// Start server
const server = app.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, "OpenCode Manager started");
});

// Cleanup function: stop all OpenCode servers and attach processes
async function cleanup(): Promise<void> {
  logger.info("Cleaning up OpenCode servers and attach processes");

  try {
    // Try graceful shutdown with 10-second timeout (increased from 3s)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Cleanup timeout")), 10000),
    );

    await Promise.race([stopAllServers(), timeoutPromise]);

    // Ensure all attach processes are killed
    killAllAttachProcesses();

    logger.info("Cleanup completed successfully");
  } catch (error) {
    logger.error({ error }, "Graceful cleanup failed, forcing kill");
    forceKillAll();
  }
}

// Handle graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal");

  // Clean up OpenCode servers first
  await cleanup();

  // Close HTTP server and exit immediately
  // Note: We don't wait for the callback as launchctl may kill us first
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // Give server.close() a moment to complete, then exit
  setTimeout(() => {
    logger.info("Shutdown complete");
    process.exit(0);
  }, 100);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGQUIT", () => shutdown("SIGQUIT"));

// Handle uncaught errors - cleanup before exit
process.on("uncaughtException", async (error) => {
  logger.fatal({ error }, "Uncaught exception");
  await cleanup();
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  logger.fatal({ reason, promise }, "Unhandled rejection");
  await cleanup();
  process.exit(1);
});
