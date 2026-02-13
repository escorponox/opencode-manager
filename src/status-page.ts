import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import { registry } from "./registry.ts";

// Helper function to format ISO timestamps
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleString();
}

// Note: getServerLogs removed - logs are fetched via API endpoint instead

export function handleStatusPage(_req: Request, res: Response): void {
  const projects = registry.getAll();
  const projectCount = Object.keys(projects).length;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Manager - Status</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
      color: #333;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      margin-bottom: 2rem;
    }

    h1 {
      font-size: 2rem;
      color: #667eea;
      margin-bottom: 0.5rem;
    }

    .subtitle {
      font-size: 1rem;
      color: #666;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(640px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: box-shadow 0.2s;
    }

    .card:hover {
      box-shadow: 0 8px 12px rgba(0, 0, 0, 0.15);
    }

    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.75rem 1rem;
      align-items: start;
    }

    dt {
      font-weight: 600;
      color: #555;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    dd {
      color: #333;
      font-size: 0.875rem;
      word-break: break-word;
    }

    .project-path {
      font-family: "Monaco", "Courier New", monospace;
      font-size: 0.8rem;
      background: #f5f5f5;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-running {
      background: #d4edda;
      color: #155724;
    }

    .status-starting {
      background: #fff3cd;
      color: #856404;
    }

    .status-stopped {
      background: #e2e3e5;
      color: #383d41;
    }

    .status-error {
      background: #f8d7da;
      color: #721c24;
    }

    .mono {
      font-family: "Monaco", "Courier New", monospace;
      font-size: 0.85rem;
      background: #f5f5f5;
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
    }

    .yes {
      color: #28a745;
      font-weight: 600;
    }

    .no {
      color: #6c757d;
    }

    .empty-state {
      background: white;
      border-radius: 12px;
      padding: 3rem;
      text-align: center;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .empty-state h2 {
      color: #667eea;
      margin-bottom: 0.5rem;
    }

    .empty-state p {
      color: #666;
    }

    .timestamp {
      font-size: 0.8rem;
      color: #666;
    }

    .logs-section {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #e0e0e0;
    }

    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .logs-title {
      font-weight: 600;
      color: #555;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .view-logs-btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 0.375rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .view-logs-btn:hover {
      background: #5568d3;
    }

    .logs-container {
      display: none;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: "Monaco", "Courier New", monospace;
      font-size: 0.75rem;
      padding: 1rem;
      border-radius: 6px;
      max-height: 400px;
      overflow-y: auto;
      margin-top: 0.5rem;
    }

    .logs-container.visible {
      display: block;
    }

    .log-line {
      padding: 0.125rem 0;
      line-height: 1.5;
    }

    .log-line.debug {
      color: #6796e6;
    }

    .log-line.info {
      color: #4ec9b0;
    }

    .log-line.warn {
      color: #dcdcaa;
    }

    .log-line.error {
      color: #f48771;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 OpenCode Manager</h1>
      <p class="subtitle">Active Servers: <strong>${projectCount}</strong></p>
    </header>

    <div class="card" style="margin-bottom: 2rem;">
      <div class="logs-section">
        <div class="logs-header">
          <span class="logs-title">Manager Logs</span>
          <button class="view-logs-btn" onclick="toggleManagerLogs()">View Logs</button>
        </div>
        <div id="manager-logs" class="logs-container">
          <div class="log-line info">Loading logs...</div>
        </div>
      </div>
    </div>

    ${
      projectCount === 0
        ? `
    <div class="empty-state">
      <h2>No Active Servers</h2>
      <p>No OpenCode servers are currently running. Start a project to see it here.</p>
    </div>
    `
        : `
    <div class="grid">
      ${Object.entries(projects)
        .map(
          ([projectPath, entry]) => `
        <article class="card">
          <dl>
            <dt>Project</dt>
            <dd><span class="project-path" title="${projectPath}">${projectPath}</span></dd>

            <dt>Status</dt>
            <dd><span class="status-badge status-${entry.status}">${entry.status}</span></dd>

            <dt>Port</dt>
            <dd><span class="mono">${entry.port}</span></dd>

            <dt>PID</dt>
            <dd><span class="mono">${entry.pid}</span></dd>

            <dt>Started</dt>
            <dd class="timestamp">${formatTimestamp(entry.startedAt)}</dd>

            <dt>Last Activity</dt>
            <dd class="timestamp">${formatTimestamp(entry.lastActivity)}</dd>

            ${
              entry.hasTUI
                ? `
            <dt>TUI</dt>
            <dd><span class="yes">✓ Attached</span></dd>

            <dt>Tmux Session</dt>
            <dd><span class="mono">${entry.tmuxSession || "N/A"}</span></dd>

            <dt>Tmux Window</dt>
            <dd><span class="mono">${entry.tmuxWindow || "N/A"}</span></dd>

            <dt>Tmux Pane</dt>
            <dd><span class="mono">${entry.tmuxPane || "N/A"}</span></dd>
            `
                : `
            <dt>TUI</dt>
            <dd><span class="no">✗ Not attached</span></dd>
            `
            }
          </dl>
        </article>
      `,
        )
        .join("")}
    </div>
    `
    }
  </div>

  <script>
    let managerLogsLoaded = false;

    function toggleManagerLogs() {
      const logsContainer = document.getElementById('manager-logs');
      const isVisible = logsContainer.classList.contains('visible');

      if (isVisible) {
        logsContainer.classList.remove('visible');
      } else {
        logsContainer.classList.add('visible');
        if (!managerLogsLoaded) {
          loadManagerLogs();
          managerLogsLoaded = true;
        }
      }
    }

    async function loadManagerLogs() {
      const logsContainer = document.getElementById('manager-logs');
      try {
        const response = await fetch('/manager-logs');
        const logs = await response.json();

        if (logs.length === 0) {
          logsContainer.innerHTML = '<div class="log-line info">No logs available</div>';
          return;
        }

        logsContainer.innerHTML = logs.map(line => {
          // Strip ANSI color codes before processing
          const cleanLine = stripAnsiCodes(line);
          let logClass = 'log-line';
          if (cleanLine.includes('ERROR') || cleanLine.includes('"level":"error"') || cleanLine.includes('Error')) {
            logClass += ' error';
          } else if (cleanLine.includes('WARN') || cleanLine.includes('"level":"warn"')) {
            logClass += ' warn';
          } else if (cleanLine.includes('INFO') || cleanLine.includes('"level":"info"')) {
            logClass += ' info';
          } else if (cleanLine.includes('DEBUG') || cleanLine.includes('"level":"debug"')) {
            logClass += ' debug';
          }
          return '<div class="' + logClass + '">' + escapeHtml(cleanLine) + '</div>';
        }).join('');

        // Auto-scroll to bottom
        logsContainer.scrollTop = logsContainer.scrollHeight;
      } catch (error) {
        logsContainer.innerHTML = '<div class="log-line error">Error loading logs: ' + escapeHtml(error.message) + '</div>';
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function stripAnsiCodes(text) {
      // Remove ANSI escape codes (color codes, etc.)
      // Pattern matches: ESC [ ... m
      return text.replace(/\x1b[[0-9;]*m/g, '');
    }
  </script>
</body>
</html>
  `;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
}

// API endpoint to get manager logs
export async function handleManagerLogs(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    // Read logs from the manager log directory
    const logDir = `${process.env.HOME}/.local/state/opencode`;
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    try {
      const stdoutLog = path.join(logDir, "manager.log");
      const stderrLog = path.join(logDir, "manager.error.log");

      // Read both log files
      const allLines: string[] = [];

      // Try to read stdout log
      try {
        const stdoutContent = await fs.readFile(stdoutLog, "utf-8");
        allLines.push(
          ...stdoutContent.split("\n").filter((line) => line.trim()),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      // Try to read stderr log
      try {
        const stderrContent = await fs.readFile(stderrLog, "utf-8");
        allLines.push(
          ...stderrContent.split("\n").filter((line) => line.trim()),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      if (allLines.length === 0) {
        res.json([]);
        return;
      }

      // Return last 200 lines
      res.json(allLines.slice(-200));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res.json([]);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error("Error loading logs:", error);
    res.status(500).json({ error: String(error) });
  }
}
