import { BrowserWindow, ipcMain } from "electron";
import { codexService } from "./CodexService";
import { exec, execFile } from "child_process";
import * as fs from "fs";
import { promisify } from "util";
import * as path from "path";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const MAX_UNTRACKED_LINECOUNT_BYTES = 512 * 1024;
const MAX_UNTRACKED_DIFF_BYTES = 512 * 1024;

const GIT_STATUS_DEBOUNCE_MS = 500;

type GitStatusWatchEntry = {
  watcher: fs.FSWatcher;
  refCount: number;
  debounceTimer?: NodeJS.Timeout;
};

const gitStatusWatchers = new Map<string, GitStatusWatchEntry>();

const broadcastGitStatusChange = (workspacePath: string) => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    window.webContents.send("git:status-changed", { workspacePath });
  });
};

const ensureGitStatusWatcher = (workspacePath: string) => {
  const existing = gitStatusWatchers.get(workspacePath);
  if (existing) {
    existing.refCount += 1;
    return { success: true as const };
  }
  if (!fs.existsSync(workspacePath)) {
    return { success: false as const, error: "Workspace path does not exist" };
  }
  try {
    const watcher = fs.watch(workspacePath, { recursive: true }, () => {
      const entry = gitStatusWatchers.get(workspacePath);
      if (!entry) return;
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        broadcastGitStatusChange(workspacePath);
      }, GIT_STATUS_DEBOUNCE_MS);
    });
    watcher.on("error", (error) => {
      console.warn("[git:watch-status] watcher error", error);
    });
    gitStatusWatchers.set(workspacePath, { watcher, refCount: 1 });
    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Failed to watch workspace",
    };
  }
};

const releaseGitStatusWatcher = (workspacePath: string) => {
  const entry = gitStatusWatchers.get(workspacePath);
  if (!entry) return { success: true as const };
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher.close();
    gitStatusWatchers.delete(workspacePath);
  }
  return { success: true as const };
};

async function countFileNewlinesCapped(
  filePath: string,
  maxBytes: number,
): Promise<number | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }

  if (!stat.isFile() || stat.size > maxBytes) {
    return null;
  }

  return await new Promise<number | null>((resolve) => {
    let count = 0;
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) count++;
      }
    });
    stream.on("error", () => resolve(null));
    stream.on("end", () => resolve(count));
  });
}

async function readFileTextCapped(
  filePath: string,
  maxBytes: number,
): Promise<string | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }

  if (!stat.isFile() || stat.size > maxBytes) {
    return null;
  }

  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export function setupCodexIpc() {
  // Check if Codex is installed
  ipcMain.handle("codex:check-installation", async () => {
    try {
      const isInstalled = await codexService.getInstallationStatus();
      return { success: true, isInstalled };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Create a new agent for a workspace
  ipcMain.handle(
    "codex:create-agent",
    async (event, workspaceId: string, worktreePath: string) => {
      try {
        const agent = await codexService.createAgent(workspaceId, worktreePath);
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Send a message to Codex
  ipcMain.handle(
    "codex:send-message",
    async (event, workspaceId: string, message: string) => {
      try {
        const response = await codexService.sendMessage(workspaceId, message);
        return { success: true, response };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Send a message to Codex with streaming
  ipcMain.handle(
    "codex:send-message-stream",
    async (
      event,
      workspaceId: string,
      message: string,
      conversationId?: string,
    ) => {
      try {
        await codexService.sendMessageStream(
          workspaceId,
          message,
          conversationId,
        );
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Get current streaming tail for a workspace (if running)
  ipcMain.handle(
    "codex:get-stream-tail",
    async (_event, workspaceId: string) => {
      try {
        const info = codexService.getStreamInfo(workspaceId);
        return { success: true, ...info };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  ipcMain.handle("codex:stop-stream", async (event, workspaceId: string) => {
    try {
      console.log("[codex:stop-stream] request received", workspaceId);
      const stopped = await codexService.stopMessageStream(workspaceId);
      console.log("[codex:stop-stream] result", { workspaceId, stopped });
      return { success: stopped, stopped };
    } catch (error) {
      console.error("[codex:stop-stream] failed", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get agent status
  ipcMain.handle(
    "codex:get-agent-status",
    async (event, workspaceId: string) => {
      try {
        const agent = codexService.getAgentStatus(workspaceId);
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Get all agents
  ipcMain.handle("codex:get-all-agents", async () => {
    try {
      const agents = codexService.getAllAgents();
      return { success: true, agents };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Remove an agent
  ipcMain.handle("codex:remove-agent", async (event, workspaceId: string) => {
    try {
      const removed = codexService.removeAgent(workspaceId);
      return { success: true, removed };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get installation instructions
  ipcMain.handle("codex:get-installation-instructions", async () => {
    try {
      const instructions = codexService.getInstallationInstructions();
      return { success: true, instructions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Set up event listeners for streaming
  codexService.on("codex:output", (data) => {
    // Broadcast to all renderer processes
    const windows = require("electron").BrowserWindow.getAllWindows();
    windows.forEach((window: any) => {
      window.webContents.send("codex:stream-output", data);
    });
  });

  codexService.on("codex:error", (data) => {
    // Broadcast to all renderer processes
    const windows = require("electron").BrowserWindow.getAllWindows();
    windows.forEach((window: any) => {
      window.webContents.send("codex:stream-error", data);
    });
  });

  codexService.on("codex:complete", (data) => {
    // Broadcast to all renderer processes
    const windows = require("electron").BrowserWindow.getAllWindows();
    windows.forEach((window: any) => {
      window.webContents.send("codex:stream-complete", data);
    });
  });

  // Get git status for a workspace
  ipcMain.handle("git:get-status", async (event, workspacePath: string) => {
    try {
      const gitStatus = await getGitStatus(workspacePath);
      return { success: true, changes: gitStatus };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("git:watch-status", async (_event, workspacePath: string) => {
    if (!workspacePath) {
      return { success: false, error: "workspace-unavailable" };
    }
    return ensureGitStatusWatcher(workspacePath);
  });

  ipcMain.handle(
    "git:unwatch-status",
    async (_event, workspacePath: string) => {
      if (!workspacePath) {
        return { success: false, error: "workspace-unavailable" };
      }
      return releaseGitStatusWatcher(workspacePath);
    },
  );

  // Get per-file diff
  ipcMain.handle(
    "git:get-file-diff",
    async (event, args: { workspacePath: string; filePath: string }) => {
      try {
        const { workspacePath, filePath } = args;
        const diff = await getFileDiff(workspacePath, filePath);
        return { success: true, diff };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  console.log("✅ Codex IPC handlers registered");
}

// Helper function to get git status
async function getGitStatus(workspacePath: string): Promise<
  Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    diff?: string;
  }>
> {
  try {
    // Check if the directory is a git repository
    try {
      await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: workspacePath,
      });
    } catch (error) {
      // Not a git repository
      return [];
    }

    // Get git status in porcelain format (tracks staged + unstaged in a single 2-char code)
    const { stdout: statusOutput } = await execFileAsync(
      "git",
      ["status", "--porcelain"],
      { cwd: workspacePath },
    );

    if (!statusOutput.trim()) {
      return [];
    }

    const changes: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
      diff?: string;
    }> = [];
    // Preserve leading spaces in porcelain output; they are significant
    const statusLines = statusOutput
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter((l) => l.length > 0);

    for (const line of statusLines) {
      const statusCode = line.substring(0, 2);
      let filePath = line.substring(3);
      // Handle rename lines like: "R  old/path -> new/path"
      if (statusCode.includes("R") && filePath.includes("->")) {
        const parts = filePath.split("->");
        filePath = parts[parts.length - 1].trim();
      }

      // Parse status code
      let status = "modified";
      if (statusCode.includes("A") || statusCode.includes("?")) {
        status = "added";
      } else if (statusCode.includes("D")) {
        status = "deleted";
      } else if (statusCode.includes("R")) {
        status = "renamed";
      } else if (statusCode.includes("M")) {
        status = "modified";
      }

      // Ignore internal log files that should never be surfaced
      if (filePath.endsWith("codex-stream.log")) {
        continue;
      }

      // Get diff statistics for the file using --numstat (sum staged + unstaged for consistency)
      let additions = 0;
      let deletions = 0;

      // Helper to parse and sum all numstat lines (handles rare multi-line outputs)
      const sumNumstat = (stdout: string) => {
        const lines = stdout
          .trim()
          .split("\n")
          .filter((l) => l.trim().length > 0);
        for (const l of lines) {
          const p = l.split("\t");
          if (p.length >= 2) {
            const addStr = p[0];
            const delStr = p[1];
            const a = addStr === "-" ? 0 : parseInt(addStr, 10) || 0;
            const d = delStr === "-" ? 0 : parseInt(delStr, 10) || 0;
            additions += a;
            deletions += d;
          }
        }
      };

      try {
        // Staged changes relative to HEAD
        const staged = await execFileAsync(
          "git",
          ["diff", "--numstat", "--cached", "--", filePath],
          { cwd: workspacePath },
        );
        if (staged.stdout && staged.stdout.trim()) {
          sumNumstat(staged.stdout);
        }
      } catch (e) {
        console.warn(`Failed to get staged numstat for ${filePath}:`, e);
      }

      try {
        // Unstaged changes relative to index
        const unstaged = await execFileAsync(
          "git",
          ["diff", "--numstat", "--", filePath],
          { cwd: workspacePath },
        );
        if (unstaged.stdout && unstaged.stdout.trim()) {
          sumNumstat(unstaged.stdout);
        }
      } catch (e) {
        console.warn(`Failed to get unstaged numstat for ${filePath}:`, e);
      }

      // If still nothing and file is untracked, approximate additions as total lines
      // Only attempt for existing regular files; skip directories or missing paths.
      if (additions === 0 && deletions === 0 && statusCode.includes("?")) {
        const absPath = path.join(workspacePath, filePath);
        const count = await countFileNewlinesCapped(
          absPath,
          MAX_UNTRACKED_LINECOUNT_BYTES,
        );
        if (typeof count === "number") {
          additions = count;
        }
      }

      changes.push({ path: filePath, status, additions, deletions });
    }

    return changes;
  } catch (error) {
    console.error("Error getting git status:", error);
    throw error;
  }
}

// Note: --numstat parsing moved inline above for accuracy.

// Get per-file diff (HEAD vs working tree) for a specific file
export async function getFileDiff(
  workspacePath: string,
  filePath: string,
): Promise<{
  lines: Array<{
    left?: string;
    right?: string;
    type: "context" | "add" | "del";
  }>;
}> {
  // Use unified diff from HEAD to working tree to include staged + unstaged
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--no-color", "--unified=2000", "HEAD", "--", filePath],
      { cwd: workspacePath },
    );
    const linesRaw = stdout.split("\n");
    const result: Array<{
      left?: string;
      right?: string;
      type: "context" | "add" | "del";
    }> = [];

    // Parse unified diff: skip headers (diff --, index, ---/+++), parse hunks @@
    for (const line of linesRaw) {
      if (!line) continue;
      if (
        line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@")
      ) {
        continue;
      }
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === " ") {
        result.push({ left: content, right: content, type: "context" });
      } else if (prefix === "-") {
        result.push({ left: content, type: "del" });
      } else if (prefix === "+") {
        result.push({ right: content, type: "add" });
      } else {
        // Fallback treat as context
        result.push({ left: line, right: line, type: "context" });
      }
    }

    // If parsing yielded no content (e.g., brand-new file or edge case), fall back gracefully
    if (result.length === 0) {
      try {
        const abs = path.join(workspacePath, filePath);
        const content = await readFileTextCapped(abs, MAX_UNTRACKED_DIFF_BYTES);
        if (content !== null) {
          return {
            lines: content
              .split("\n")
              .map((l: string) => ({ right: l, type: "add" as const })),
          };
        }
        // File missing in working tree: try to show previous content from HEAD as deletions
        try {
          const { stdout: prev } = await execFileAsync(
            "git",
            ["show", `HEAD:${filePath}`],
            { cwd: workspacePath },
          );
          return {
            lines: prev
              .split("\n")
              .map((l: string) => ({ left: l, type: "del" as const })),
          };
        } catch {
          return { lines: [] };
        }
      } catch {
        // ignore and return empty
      }
    }

    return { lines: result };
  } catch (error) {
    // If the file is untracked, show full content as additions (best-effort)
    const abs = path.join(workspacePath, filePath);
    const content = await readFileTextCapped(abs, MAX_UNTRACKED_DIFF_BYTES);
    if (content !== null) {
      const lines = content.split("\n");
      return { lines: lines.map((l) => ({ right: l, type: "add" as const })) };
    }
    // Deleted file or inaccessible: try diff cached vs HEAD
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--no-color", "--unified=2000", "HEAD", "--", filePath],
        { cwd: workspacePath },
      );
      const linesRaw = stdout.split("\n");
      const result: Array<{
        left?: string;
        right?: string;
        type: "context" | "add" | "del";
      }> = [];
      for (const line of linesRaw) {
        if (!line) continue;
        if (
          line.startsWith("diff ") ||
          line.startsWith("index ") ||
          line.startsWith("--- ") ||
          line.startsWith("+++ ") ||
          line.startsWith("@@")
        )
          continue;
        const prefix = line[0];
        const content = line.slice(1);
        if (prefix === " ")
          result.push({ left: content, right: content, type: "context" });
        else if (prefix === "-") result.push({ left: content, type: "del" });
        else if (prefix === "+") result.push({ right: content, type: "add" });
        else result.push({ left: line, right: line, type: "context" });
      }
      if (result.length === 0) {
        // As a last resort, try to show HEAD content as deletions
        try {
          const { stdout: prev } = await execFileAsync(
            "git",
            ["show", `HEAD:${filePath}`],
            { cwd: workspacePath },
          );
          return {
            lines: prev
              .split("\n")
              .map((l: string) => ({ left: l, type: "del" as const })),
          };
        } catch {
          return { lines: [] };
        }
      }
      return { lines: result };
    } catch {
      return { lines: [] };
    }
  }
}
