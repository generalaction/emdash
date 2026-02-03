import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { log } from '../lib/logger';
import type { TerminalSnapshotPayload } from '../types/terminalSnapshot';
import { TERMINAL_SNAPSHOT_VERSION } from '../types/terminalSnapshot';

interface StoredSnapshot extends TerminalSnapshotPayload {
  bytes: number;
}

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function resolveBaseDir(): string {
  const override = process.env.EMDASH_TERMINAL_SNAPSHOT_DIR;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  try {
    return path.join(app.getPath('userData'), 'terminal-snapshots');
  } catch (error) {
    log.warn('terminalSnapshotService: unable to resolve userData path, using cwd fallback', {
      error,
    });
    return path.join(process.cwd(), '.emdash-terminal-snapshots');
  }
}

const BASE_DIR = resolveBaseDir();

function snapshotPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(BASE_DIR, `${safe}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.promises.mkdir(BASE_DIR, { recursive: true });
}

async function readSnapshotFile(filePath: string): Promise<StoredSnapshot | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('terminalSnapshotService: failed to read snapshot', { filePath, error });
    }
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as TerminalSnapshotPayload;
    if (parsed.version !== TERMINAL_SNAPSHOT_VERSION) {
      return null;
    }
    const bytes = Buffer.byteLength(raw, 'utf8');
    return { ...parsed, bytes };
  } catch (error) {
    log.warn('terminalSnapshotService: invalid snapshot JSON', {
      filePath,
      error,
      bytes: Buffer.byteLength(raw, 'utf8'),
    });
    await removeFile(filePath);
    return null;
  }
}

async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('terminalSnapshotService: failed to delete snapshot', { filePath, error });
    }
  }
}

async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tmpPath, contents, 'utf8');
  try {
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EEXIST' || code === 'EPERM') {
      await fs.promises.rm(filePath, { force: true });
      await fs.promises.rename(tmpPath, filePath);
      return;
    }
    await fs.promises.rm(tmpPath, { force: true });
    throw error;
  }
}

async function listSnapshots(): Promise<
  Array<{ id: string; path: string; stats: StoredSnapshot }>
> {
  try {
    const entries = await fs.promises.readdir(BASE_DIR);
    const result: Array<{ id: string; path: string; stats: StoredSnapshot }> = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const filePath = path.join(BASE_DIR, entry);
      const stats = await readSnapshotFile(filePath);
      if (stats) {
        const id = entry.replace(/\.json$/, '');
        result.push({ id, path: filePath, stats });
      }
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    log.warn('terminalSnapshotService: failed to list snapshots', { error });
    return [];
  }
}

class TerminalSnapshotService {
  async getSnapshot(id: string): Promise<TerminalSnapshotPayload | null> {
    const record = await readSnapshotFile(snapshotPath(id));
    return record ? { ...record } : null;
  }

  async saveSnapshot(
    id: string,
    payload: TerminalSnapshotPayload
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      if (payload.version !== TERMINAL_SNAPSHOT_VERSION) {
        return { ok: false, error: 'Unsupported snapshot version' };
      }

      const json = JSON.stringify(payload);
      const bytes = Buffer.byteLength(json, 'utf8');
      if (bytes > MAX_SNAPSHOT_BYTES) {
        return { ok: false, error: 'Snapshot size exceeds per-task limit' };
      }

      await ensureDir();
      await atomicWriteFile(snapshotPath(id), json);
      await this.pruneIfNeeded(id);
      return { ok: true };
    } catch (error) {
      log.error('terminalSnapshotService: failed to save snapshot', { id, error });
      return { ok: false, error: (error as Error)?.message ?? String(error) };
    }
  }

  async deleteSnapshot(id: string): Promise<void> {
    await removeFile(snapshotPath(id));
  }

  private async pruneIfNeeded(recentId: string): Promise<void> {
    const records = await listSnapshots();
    if (records.length === 0) return;

    let total = records.reduce((sum, rec) => sum + rec.stats.bytes, 0);
    if (total <= MAX_TOTAL_BYTES) return;
    // Sort by oldest first, prefer to keep the most recent snapshot we just wrote
    const ordered = records
      .filter((rec) => rec.id !== recentId)
      .sort((a, b) => Date.parse(a.stats.createdAt) - Date.parse(b.stats.createdAt));

    for (const entry of ordered) {
      if (total <= MAX_TOTAL_BYTES) break;
      await removeFile(entry.path);
      total -= entry.stats.bytes;
    }

    // As a last resort, keep only the recent snapshot
    if (total > MAX_TOTAL_BYTES) {
      for (const entry of records) {
        if (entry.id === recentId) continue;
        await removeFile(entry.path);
      }
    }
  }
}

export const terminalSnapshotService = new TerminalSnapshotService();
