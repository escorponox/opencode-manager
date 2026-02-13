import { type ChildProcess, execSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { createLogger } from "./logger.ts";
import { registry } from "./registry.ts";

const logger = createLogger({ module: "opencode" });

// Simple health check using fetch
async function checkHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/global/health`);
    if (response.ok) {
      const data = (await response.json()) as { healthy?: boolean };
      return data.healthy === true;
    }
    return false;
  } catch {
    return false;
  }
}

// Check if a port is available by attempting to bind to it
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false); // Port is in use
      } else {
        resolve(false); // Other error, treat as unavailable
      }
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true); // Port is available
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

// Find the first available port starting from startPort
export async function findAvailablePort(
  startPort: number,
  maxPort: number = 4196,
): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${maxPort}`);
}

// Scan for existing OpenCode serve processes and extract their ports
export function scanExistingOpenCodePorts(): number[] {
  try {
    const psOutput = execSync("ps aux", { encoding: "utf-8" });
    const ports: number[] = [];

    // Look for lines containing "opencode serve" (exclude grep itself)
    const lines = psOutput.split("\n");
    for (const line of lines) {
      // Skip grep processes and ensure it's actually an opencode serve command
      if (
        line.includes("opencode serve") &&
        line.includes("--port") &&
        !line.includes("grep")
      ) {
        // Extract port number from --port argument
        const match = line.match(/--port\s+(\d+)/);
        if (match?.[1]) {
          const port = parseInt(match[1], 10);
          if (!Number.isNaN(port) && port >= 4000 && port <= 5000) {
            ports.push(port);
          }
        }
      }
    }

    return ports.sort((a, b) => a - b);
  } catch (error) {
    logger.error({ error }, "Error scanning for OpenCode processes");
    return [];
  }
}

// Check if a TUI is actually attached to a specific port
export function isTUIAttached(port: number): boolean {
  try {
    const psOutput = execSync("ps aux", { encoding: "utf-8" });
    const lines = psOutput.split("\n");

    for (const line of lines) {
      // Check for "opencode attach http://localhost:{port}"
      if (
        line.includes("opencode attach") &&
        line.includes(`http://localhost:${port}`) &&
        !line.includes("grep")
      ) {
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error({ error, port }, "Error checking TUI attachment");
    return false;
  }
}

// Get PIDs of all opencode attach processes for a specific port
export function getAttachProcessPIDs(port: number): number[] {
  try {
    const psOutput = execSync("ps aux", { encoding: "utf-8" });
    const lines = psOutput.split("\n");
    const pids: number[] = [];

    for (const line of lines) {
      // Check for "opencode attach http://localhost:{port}"
      if (
        line.includes("opencode attach") &&
        line.includes(`http://localhost:${port}`) &&
        !line.includes("grep")
      ) {
        // Extract PID (second column in ps aux output)
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const pid = parseInt(parts[1], 10);
          if (!Number.isNaN(pid)) {
            pids.push(pid);
          }
        }
      }
    }

    return pids;
  } catch (error) {
    logger.error({ error, port }, "Error getting attach process PIDs");
    return [];
  }
}

// Kill all opencode attach processes for a specific port
export function killAttachProcesses(port: number): void {
  const pids = getAttachProcessPIDs(port);

  if (pids.length === 0) {
    return;
  }

  logger.info({ port, pids }, "Killing attach processes");

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      logger.debug({ pid, port }, "Killed attach process");
    } catch (error) {
      logger.warn({ pid, port, error }, "Failed to kill attach process");
    }
  }
}

// Kill all opencode attach processes for all ports
export function killAllAttachProcesses(): void {
  try {
    const psOutput = execSync("ps aux", { encoding: "utf-8" });
    const lines = psOutput.split("\n");
    const pids: number[] = [];

    for (const line of lines) {
      // Check for any "opencode attach" process
      if (line.includes("opencode attach") && !line.includes("grep")) {
        // Extract PID (second column in ps aux output)
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const pid = parseInt(parts[1], 10);
          if (!Number.isNaN(pid)) {
            pids.push(pid);
          }
        }
      }
    }

    if (pids.length === 0) {
      logger.debug("No attach processes to kill");
      return;
    }

    logger.info({ count: pids.length, pids }, "Killing all attach processes");

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        logger.debug({ pid }, "Killed attach process");
      } catch (error) {
        logger.warn({ pid, error }, "Failed to kill attach process");
      }
    }
  } catch (error) {
    logger.error({ error }, "Error killing all attach processes");
  }
}

// Track spawned processes (exported for cleanup handlers)
export const processes: Map<string, ChildProcess> = new Map();

export async function startServer(projectPath: string): Promise<number> {
  const existing = registry.get(projectPath);
  if (existing && existing.status === "running") {
    // Check if actually running
    if (await isServerHealthy(existing.port)) {
      return existing.port;
    }
    // Server died, clean up
    registry.update(projectPath, { status: "stopped" });
  }

  const port = await registry.allocatePort();

  logger.info({ projectPath, port }, "Starting OpenCode server");

  const proc = spawn("opencode", ["serve", "--port", port.toString()], {
    cwd: projectPath,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: {
      ...process.env,
      // Ensure volta/node paths are available
      PATH: process.env.PATH,
    },
  });

  proc.unref();

  // Log stdout/stderr for debugging
  proc.stdout?.on("data", (data) => {
    logger.debug(
      { projectPath, port, output: data.toString().trim() },
      "OpenCode stdout",
    );
  });

  proc.stderr?.on("data", (data) => {
    logger.warn(
      { projectPath, port, output: data.toString().trim() },
      "OpenCode stderr",
    );
  });

  proc.on("error", (error) => {
    logger.error({ projectPath, port, error }, "OpenCode process error");
    registry.update(projectPath, { status: "error" });
  });

  proc.on("exit", (code) => {
    logger.info(
      { projectPath, port, exitCode: code },
      "OpenCode process exited",
    );
    processes.delete(projectPath);
    registry.update(projectPath, { status: "stopped", sessionId: null });
  });

  if (proc.pid) {
    processes.set(projectPath, proc);

    registry.add(projectPath, {
      port,
      pid: proc.pid,
      status: "starting",
      hasTUI: false,
      tmuxSession: null,
      tmuxWindow: null,
      tmuxPane: null,
      sessionId: null,
    });

    // Wait for server to be ready
    try {
      await waitForServer(port);
      registry.update(projectPath, { status: "running" });
      logger.info({ port, projectPath }, "Server ready");
    } catch (error) {
      logger.error({ error, projectPath, port }, "Server failed to start");
      registry.update(projectPath, { status: "error" });
      throw error;
    }
  }

  return port;
}

export async function stopServer(projectPath: string): Promise<boolean> {
  const entry = registry.get(projectPath);
  if (!entry) return false;

  logger.info({ projectPath, port: entry.port }, "Stopping server");

  // Kill any attach processes first
  killAttachProcesses(entry.port);

  const proc = processes.get(projectPath);
  if (proc) {
    proc.kill("SIGTERM");
    processes.delete(projectPath);
  } else {
    // Try to kill by PID
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {
      // Process might already be dead
    }
  }

  registry.update(projectPath, { status: "stopped" });
  registry.remove(projectPath);
  return true;
}

async function isServerHealthy(port: number): Promise<boolean> {
  return checkHealth(port);
}

async function waitForServer(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerHealthy(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Server on port ${port} did not start within ${timeoutMs}ms`);
}

export function getClient(port: number) {
  return createOpencodeClient({
    baseUrl: `http://localhost:${port}`,
  });
}

export async function sendPrompt(
  projectPath: string,
  text: string,
  context?: { file?: string; line?: number; col?: number },
): Promise<unknown> {
  const entry = registry.get(projectPath);
  if (!entry || entry.status !== "running") {
    throw new Error(`No running server for ${projectPath}`);
  }

  const client = getClient(entry.port);

  // Create or get session
  const sessions = await client.session.list();
  let sessionId: string;

  if (sessions.data && sessions.data.length > 0) {
    // Use the most recent session
    sessionId = sessions.data[0].id;
  } else {
    const newSession = await client.session.create({
      body: { title: "nvim-session" },
    });
    if (!newSession.data) {
      throw new Error("Failed to create session");
    }
    sessionId = newSession.data.id;
  }

  // Build prompt with context
  let fullPrompt = text;
  if (context?.file) {
    fullPrompt = `@${context.file}`;
    if (context.line) {
      fullPrompt += ` line: ${context.line}`;
      if (context.col) {
        fullPrompt += ` col: ${context.col}`;
      }
    }
    fullPrompt += `\n\n${text}`;
  }

  logger.debug(
    { sessionId, promptPreview: fullPrompt.slice(0, 100) },
    "Sending prompt",
  );

  // Send prompt
  const result = await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: fullPrompt }],
    },
  });

  registry.update(projectPath, {}); // Update lastActivity

  return result.data;
}

export async function sendPromptAsync(
  projectPath: string,
  text: string,
  context?: { file?: string; line?: number; col?: number },
): Promise<void> {
  const entry = registry.get(projectPath);
  if (!entry || entry.status !== "running") {
    throw new Error(`No running server for ${projectPath}`);
  }

  const client = getClient(entry.port);

  // Always create a new session for each prompt from Neovim
  const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS format
  const newSession = await client.session.create({
    body: { title: `nvim-${timestamp}` },
  });
  if (!newSession.data) {
    throw new Error("Failed to create session");
  }
  const sessionId = newSession.data.id;

  // Store session ID in registry for TUI attachment
  registry.update(projectPath, { sessionId });

  // Build prompt with context
  let fullPrompt = text;
  if (context?.file) {
    fullPrompt = `@${context.file}`;
    if (context.line) {
      fullPrompt += ` line: ${context.line}`;
      if (context.col) {
        fullPrompt += ` col: ${context.col}`;
      }
    }
    fullPrompt += `\n\n${text}`;
  }

  logger.debug(
    { sessionId, promptPreview: fullPrompt.slice(0, 100) },
    "Sending prompt async",
  );

  // Send prompt asynchronously - returns immediately
  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: fullPrompt }],
    },
  });

  registry.update(projectPath, {}); // Update lastActivity
}

export async function getServerStatus(projectPath: string): Promise<{
  healthy: boolean;
  port?: number;
}> {
  const entry = registry.get(projectPath);
  if (!entry) {
    return { healthy: false };
  }

  const healthy = await isServerHealthy(entry.port);
  return { healthy, port: entry.port };
}

// Stop all managed OpenCode servers gracefully
export async function stopAllServers(): Promise<void> {
  const allProjects = registry.getAll();
  const projectPaths = Object.keys(allProjects);

  if (projectPaths.length === 0) {
    logger.info("No servers to stop");
    return;
  }

  logger.info({ count: projectPaths.length }, "Stopping servers");

  // Stop all servers in parallel
  const stopPromises = projectPaths.map(async (projectPath) => {
    try {
      await stopServer(projectPath);
      logger.info({ projectPath }, "Stopped server");
    } catch (error) {
      logger.error({ projectPath, error }, "Error stopping server");
    }
  });

  await Promise.all(stopPromises);
  logger.info("All servers stopped");
}

// Force kill all processes (fallback for cleanup timeout)
export function forceKillAll(): void {
  logger.warn("Force killing all remaining processes");

  // Kill all attach processes first
  killAllAttachProcesses();

  // Kill tracked processes
  for (const [projectPath, proc] of processes.entries()) {
    try {
      if (proc.pid) {
        process.kill(proc.pid, "SIGKILL");
        logger.warn({ projectPath, pid: proc.pid }, "Force killed process");
      }
    } catch (error) {
      logger.error({ projectPath, error }, "Error force killing process");
    }
  }

  // Fallback: kill by registry PIDs
  const allProjects = registry.getAll();
  for (const [projectPath, entry] of Object.entries(allProjects)) {
    if (!processes.has(projectPath) && entry.pid) {
      try {
        process.kill(entry.pid, "SIGKILL");
        logger.warn({ projectPath, pid: entry.pid }, "Force killed PID");
      } catch (_error) {
        // Process might already be dead, ignore
      }
    }
  }

  processes.clear();
  logger.info("Force kill complete");
}
