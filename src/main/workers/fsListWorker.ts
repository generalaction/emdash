import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { FsListItem, FsListWorkerResponse } from '../types/fsListWorker';

type ListWorkerRequest = {
  taskId: number;
  root: string;
  includeDirs: boolean;
  maxEntries: number;
  timeBudgetMs: number;
  batchSize: number;
};

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.DS_Store',
]);

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

const yieldImmediate = () => new Promise<void>((resolve) => setImmediate(resolve));

async function listFiles(request: ListWorkerRequest): Promise<FsListWorkerResponse> {
  const items: FsListItem[] = [];
  const stack: string[] = ['.'];
  const start = Date.now();
  const deadline = start + request.timeBudgetMs;
  let truncated = false;
  let reason: 'maxEntries' | 'timeBudget' | undefined;
  let visited = 0;

  while (stack.length > 0) {
    if (items.length >= request.maxEntries) {
      truncated = true;
      reason = 'maxEntries';
      break;
    }
    if (Date.now() >= deadline) {
      truncated = true;
      reason = 'timeBudget';
      break;
    }

    const rel = stack.pop() as string;
    const abs = path.join(request.root, rel);

    const stat = safeStat(abs);
    if (!stat) continue;

    if (stat.isDirectory()) {
      const name = path.basename(abs);
      if (rel !== '.' && DEFAULT_IGNORES.has(name)) continue;

      if (rel !== '.' && request.includeDirs) {
        items.push({ path: rel, type: 'dir' });
        if (items.length >= request.maxEntries) {
          truncated = true;
          reason = 'maxEntries';
          break;
        }
      }

      let entries: string[] = [];
      try {
        entries = fs.readdirSync(abs);
      } catch {
        continue;
      }

      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (DEFAULT_IGNORES.has(entry)) continue;
        const nextRel = rel === '.' ? entry : path.join(rel, entry);
        stack.push(nextRel);
      }
    } else if (stat.isFile()) {
      items.push({ path: rel, type: 'file' });
      if (items.length >= request.maxEntries) {
        truncated = true;
        reason = 'maxEntries';
        break;
      }
    }

    visited += 1;
    if (visited % request.batchSize === 0) {
      await yieldImmediate();
    }
  }

  return {
    taskId: request.taskId,
    ok: true,
    items,
    truncated,
    reason,
    durationMs: Date.now() - start,
  };
}

if (!parentPort) {
  throw new Error('fsListWorker must be run as a worker thread');
}

parentPort.on('message', async (request: ListWorkerRequest) => {
  try {
    const result = await listFiles(request);
    parentPort?.postMessage(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    parentPort?.postMessage({
      taskId: request.taskId,
      ok: false,
      error: message,
    });
  }
});
