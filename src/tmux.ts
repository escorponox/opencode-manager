import { execSync } from "node:child_process";
import { basename } from "node:path";
import { createLogger } from "./logger.ts";

const logger = createLogger({ module: "tmux" });
const TMUX_SESSION = "dev";

export interface TmuxPane {
  session: string;
  window: string;
  pane: string;
  paneId: string;
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

export function isTmuxRunning(): boolean {
  const output = run("tmux list-sessions 2>/dev/null");
  logger.debug({ sessions: output }, "Tmux sessions");
  return output.includes(TMUX_SESSION);
}

export function listWindows(): string[] {
  const output = run(
    `tmux list-windows -t ${TMUX_SESSION} -F '#{window_name}' 2>/dev/null`,
  );
  return output ? output.split("\n").filter(Boolean) : [];
}

export function windowExists(windowName: string): boolean {
  return listWindows().includes(windowName);
}

export function getWindowIndex(windowName: string): string | null {
  const output = run(
    `tmux list-windows -t ${TMUX_SESSION} -F '#{window_index}:#{window_name}' 2>/dev/null`,
  );
  if (!output) return null;

  for (const line of output.split("\n")) {
    const [index, name] = line.split(":");
    if (name === windowName) {
      return index;
    }
  }
  return null;
}

export async function createWindow(projectPath: string): Promise<TmuxPane> {
  const windowName = basename(projectPath);

  // Create new window with the project name, cd to project path
  run(
    `tmux new-window -t ${TMUX_SESSION} -n '${windowName}' -c '${projectPath}'`,
  );

  // Get the pane ID of the newly created window
  const paneId = run(
    `tmux list-panes -t '${TMUX_SESSION}:${windowName}' -F '#{pane_id}' 2>/dev/null | head -1`,
  );

  return {
    session: TMUX_SESSION,
    window: windowName,
    pane: "0",
    paneId,
  };
}

export async function createPaneInWindow(
  windowName: string,
  projectPath: string,
): Promise<TmuxPane> {
  // Create a vertical split in the existing window
  const windowIndex = getWindowIndex(windowName);
  if (!windowIndex) {
    throw new Error(`Window ${windowName} not found`);
  }

  run(
    `tmux split-window -h -t '${TMUX_SESSION}:${windowIndex}' -c '${projectPath}'`,
  );

  // Get the pane ID of the newly created pane (last one)
  const paneId = run(
    `tmux list-panes -t '${TMUX_SESSION}:${windowName}' -F '#{pane_id}' 2>/dev/null | tail -1`,
  );

  const paneIndex = run(
    `tmux list-panes -t '${TMUX_SESSION}:${windowName}' -F '#{pane_index}' 2>/dev/null | tail -1`,
  );

  return {
    session: TMUX_SESSION,
    window: windowName,
    pane: paneIndex,
    paneId,
  };
}

export function sendCommand(paneId: string, command: string): void {
  // Escape single quotes in the command
  const escapedCommand = command.replace(/'/g, "'\\''");
  run(`tmux send-keys -t '${paneId}' '${escapedCommand}' Enter`);
}

export function focusPane(paneId: string): void {
  run(`tmux select-pane -t '${paneId}'`);
}

export function zoomPane(paneId: string): void {
  // First select the pane, then toggle zoom
  run(`tmux select-pane -t '${paneId}'`);
  run(`tmux resize-pane -Z -t '${paneId}'`);
}

export function selectWindow(windowName: string): void {
  run(`tmux select-window -t '${TMUX_SESSION}:${windowName}'`);
}

export function getWindowNameFromPane(paneId: string): string {
  return run(`tmux display-message -p -t '${paneId}' '#{window_name}'`);
}

export async function attachTUI(
  projectPath: string,
  port: number,
  sessionId?: string,
): Promise<TmuxPane> {
  const windowName = basename(projectPath);

  let pane: TmuxPane;

  if (!isTmuxRunning()) {
    throw new Error("Tmux session 'dev' is not running");
  }

  if (windowExists(windowName)) {
    // Window exists, create a new pane
    pane = await createPaneInWindow(windowName, projectPath);
  } else {
    // Create new window
    pane = await createWindow(projectPath);
  }

  // Send the opencode attach command with session ID if available
  const attachCmd = getAttachCommand(port, sessionId);
  sendCommand(pane.paneId, attachCmd);

  return pane;
}

export function focusTUI(paneId: string): void {
  const windowName = getWindowNameFromPane(paneId);
  if (windowName) {
    selectWindow(windowName);
  }
  focusPane(paneId);
  zoomPane(paneId);
}

export function getAttachCommand(port: number, sessionId?: string): string {
  let cmd = `opencode attach http://localhost:${port}`;
  if (sessionId) {
    cmd += ` --session ${sessionId}`;
  }
  return cmd;
}

export function getCurrentPane(): string | null {
  // Get the current pane ID from TMUX environment
  const paneId = run("tmux display-message -p '#{pane_id}'");
  return paneId || null;
}

export async function attachTUIInPlace(
  projectPath: string,
  port: number,
  sessionId?: string,
): Promise<TmuxPane> {
  const windowName = basename(projectPath);
  const paneId = getCurrentPane();

  if (!paneId) {
    throw new Error("Not running in a tmux pane");
  }

  // Send the opencode attach command to the current pane with session ID if available
  const attachCmd = getAttachCommand(port, sessionId);
  sendCommand(paneId, attachCmd);

  // Get window info for the current pane
  const _windowIndex = run(
    `tmux display-message -p -t '${paneId}' '#{window_index}'`,
  );
  const paneIndex = run(
    `tmux display-message -p -t '${paneId}' '#{pane_index}'`,
  );

  return {
    session: TMUX_SESSION,
    window: windowName,
    pane: paneIndex,
    paneId,
  };
}
