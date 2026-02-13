import { createLogger } from "./logger.ts";

const logger = createLogger({ module: "registry" });

export interface ProjectEntry {
  port: number;
  pid: number;
  status: "starting" | "running" | "stopped" | "error";
  hasTUI: boolean;
  tmuxSession: string | null;
  tmuxWindow: string | null;
  tmuxPane: string | null;
  sessionId: string | null;
  startedAt: string;
  lastActivity: string;
}

export type Registry = Record<string, ProjectEntry>;

class ProjectRegistry {
  private registry: Registry = {};
  private nextPort = 4097;

  get(projectPath: string): ProjectEntry | undefined {
    return this.registry[projectPath];
  }

  getAll(): Registry {
    return { ...this.registry };
  }

  async allocatePort(): Promise<number> {
    // Dynamically import to avoid circular dependency
    const { findAvailablePort } = await import("./opencode.ts");
    const allocatedPort = await findAvailablePort(this.nextPort);
    this.nextPort = allocatedPort + 1;
    return allocatedPort;
  }

  async initializePortAllocation(): Promise<void> {
    // Dynamically import to avoid circular dependency
    const { scanExistingOpenCodePorts } = await import("./opencode.ts");
    const existingPorts = scanExistingOpenCodePorts();

    if (existingPorts.length > 0) {
      const highestPort = Math.max(...existingPorts);
      this.nextPort = Math.max(4097, highestPort + 1);
      logger.info(
        {
          count: existingPorts.length,
          ports: existingPorts,
          nextPort: this.nextPort,
        },
        "Found existing OpenCode processes",
      );
    } else {
      logger.info(
        "No existing OpenCode processes found. Starting at port 4097",
      );
    }
  }

  add(
    projectPath: string,
    entry: Omit<ProjectEntry, "startedAt" | "lastActivity">,
  ): ProjectEntry {
    const now = new Date().toISOString();
    const fullEntry: ProjectEntry = {
      ...entry,
      startedAt: now,
      lastActivity: now,
    };
    this.registry[projectPath] = fullEntry;
    return fullEntry;
  }

  update(
    projectPath: string,
    updates: Partial<ProjectEntry>,
  ): ProjectEntry | undefined {
    const existing = this.registry[projectPath];
    if (!existing) return undefined;

    const updated: ProjectEntry = {
      ...existing,
      ...updates,
      lastActivity: new Date().toISOString(),
    };
    this.registry[projectPath] = updated;
    return updated;
  }

  remove(projectPath: string): boolean {
    if (this.registry[projectPath]) {
      delete this.registry[projectPath];
      return true;
    }
    return false;
  }

  setTUI(
    projectPath: string,
    tmuxSession: string,
    tmuxWindow: string,
    tmuxPane: string,
  ): ProjectEntry | undefined {
    return this.update(projectPath, {
      hasTUI: true,
      tmuxSession,
      tmuxWindow,
      tmuxPane,
    });
  }

  clearTUI(projectPath: string): ProjectEntry | undefined {
    return this.update(projectPath, {
      hasTUI: false,
      tmuxSession: null,
      tmuxWindow: null,
      tmuxPane: null,
    });
  }
}

export const registry = new ProjectRegistry();
