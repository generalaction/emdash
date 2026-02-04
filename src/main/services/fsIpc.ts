import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import { Worker } from "worker_threads";

type ListArgs = {
  root: string;
  includeDirs?: boolean;
  maxEntries?: number;
  timeBudgetMs?: number;
};

type Item = {
  path: string; // relative to root
  type: "file" | "dir";
};

type ListWorkerResponse =
  | {
      taskId: number;
      ok: true;
      items: Item[];
      truncated: boolean;
      reason?: "maxEntries" | "timeBudget";
      durationMs: number;
    }
  | {
      taskId: number;
      ok: false;
      error: string;
    };

type ListWorkerState = {
  worker: Worker;
  requestId: number;
  canceled: boolean;
};

const listWorkersBySender = new Map<number, ListWorkerState>();
const DEFAULT_TIME_BUDGET_MS = 2000;
const MIN_TIME_BUDGET_MS = 250;
const MAX_TIME_BUDGET_MS = 10000;
const MAX_FILES_TO_SEARCH = 10000;
const DEFAULT_BATCH_SIZE = 250;

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

export function registerFsIpc(): void {
  ipcMain.handle("fs:list", async (_event, args: ListArgs) => {
    try {
      const root = args.root;
      const includeDirs = args.includeDirs ?? true;
      const maxEntries = Math.min(
        Math.max(args.maxEntries ?? 5000, 100),
        MAX_FILES_TO_SEARCH,
      );
      const timeBudgetMs = Math.min(
        Math.max(
          args.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
          MIN_TIME_BUDGET_MS,
        ),
        MAX_TIME_BUDGET_MS,
      );
      if (!root || !fs.existsSync(root)) {
        return { success: false, error: "Invalid root path" };
      }
      const senderId = _event.sender.id;
      const prev = listWorkersBySender.get(senderId);
      if (prev) {
        prev.canceled = true;
        prev.worker.terminate().catch(() => {});
      }

      const requestId = (prev?.requestId ?? 0) + 1;
      const workerPath = path.join(
        __dirname,
        "..",
        "workers",
        "fsListWorker.js",
      );
      const worker = new Worker(workerPath);
      const state: ListWorkerState = { worker, requestId, canceled: false };
      listWorkersBySender.set(senderId, state);

      const result = await new Promise<ListWorkerResponse>(
        (resolve, reject) => {
          const cleanup = () => {
            worker.removeAllListeners("message");
            worker.removeAllListeners("error");
            worker.removeAllListeners("exit");
          };

          worker.once("message", (message) => {
            cleanup();
            worker.terminate().catch(() => {});
            resolve(message as ListWorkerResponse);
          });
          worker.once("error", (error) => {
            cleanup();
            reject(error);
          });
          worker.once("exit", (code) => {
            cleanup();
            if (state.canceled) {
              resolve({ taskId: requestId, ok: false, error: "Canceled" });
              return;
            }
            if (code !== 0) {
              reject(new Error(`fs:list worker exited with code ${code}`));
            }
          });

          worker.postMessage({
            taskId: requestId,
            root,
            includeDirs,
            maxEntries,
            timeBudgetMs,
            batchSize: DEFAULT_BATCH_SIZE,
          });
        },
      );

      const latest = listWorkersBySender.get(senderId);
      if (!latest || latest.requestId !== requestId || state.canceled) {
        return { success: true, canceled: true };
      }

      listWorkersBySender.delete(senderId);

      if (!result.ok) {
        if (result.error === "Canceled")
          return { success: true, canceled: true };
        return { success: false, error: result.error };
      }

      return {
        success: true,
        items: result.items,
        truncated: result.truncated,
        reason: result.reason,
        durationMs: result.durationMs,
      };
    } catch (error) {
      console.error("fs:list failed:", error);
      return { success: false, error: "Failed to list files" };
    }
  });

  ipcMain.handle(
    "fs:read",
    async (
      _event,
      args: { root: string; relPath: string; maxBytes?: number },
    ) => {
      try {
        const { root, relPath } = args;
        const maxBytes = Math.min(
          Math.max(args.maxBytes ?? 200 * 1024, 1024),
          5 * 1024 * 1024,
        ); // 200KB default, clamp 1KB..5MB
        if (!root || !fs.existsSync(root))
          return { success: false, error: "Invalid root path" };
        if (!relPath) return { success: false, error: "Invalid relPath" };

        // Resolve and ensure within root
        const abs = path.resolve(root, relPath);
        const normRoot = path.resolve(root) + path.sep;
        if (!abs.startsWith(normRoot))
          return { success: false, error: "Path escapes root" };

        const st = safeStat(abs);
        if (!st) return { success: false, error: "Not found" };
        if (st.isDirectory())
          return { success: false, error: "Is a directory" };

        const size = st.size;
        let truncated = false;
        let content: string;
        const fd = fs.openSync(abs, "r");
        try {
          const bytesToRead = Math.min(size, maxBytes);
          const buf = Buffer.alloc(bytesToRead);
          fs.readSync(fd, buf, 0, bytesToRead, 0);
          content = buf.toString("utf8");
          truncated = size > bytesToRead;
        } finally {
          fs.closeSync(fd);
        }

        return { success: true, path: relPath, size, truncated, content };
      } catch (error) {
        console.error("fs:read failed:", error);
        return { success: false, error: "Failed to read file" };
      }
    },
  );
}
