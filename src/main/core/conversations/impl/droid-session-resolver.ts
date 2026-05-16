import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REMEMBER_RETRY_DELAYS = [1000, 2000, 4000] as const;

function droidSessionDirName(cwd: string) {
  return cwd.replace(/\//g, '-');
}

function parseRawConfig(config: string | null): Record<string, unknown> {
  if (!config) return {};
  try {
    const parsed = JSON.parse(config) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getProviderSessionId(config: string | null | undefined): string | undefined {
  const value = parseRawConfig(config ?? null).providerSessionId;
  return typeof value === 'string' && SESSION_ID_RE.test(value) ? value : undefined;
}

export type DroidSessionStore = {
  home(): Promise<string>;
  joinPath(...parts: string[]): string;
  realpath(filePath: string): Promise<string>;
  listSessionFiles(dir: string): Promise<Array<{ filePath: string; mtimeMs: number }>>;
  readFirstLine(filePath: string): Promise<string | null>;
};

type DroidSessionEntry = { id: string; mtimeMs: number };

function parseSessionStartId(firstLine: string, cwd: string, realCwd: string): string | null {
  try {
    const event = JSON.parse(firstLine) as { type?: unknown; id?: unknown; cwd?: unknown };
    if (event.type !== 'session_start') return null;
    if (event.cwd !== cwd && event.cwd !== realCwd) return null;
    if (typeof event.id !== 'string' || !SESSION_ID_RE.test(event.id)) return null;
    return event.id;
  } catch {
    return null;
  }
}

async function readSessionEntries(
  cwd: string,
  store: DroidSessionStore
): Promise<DroidSessionEntry[]> {
  const realCwd = await store.realpath(cwd);
  const dir = store.joinPath(
    await store.home(),
    '.factory',
    'sessions',
    droidSessionDirName(realCwd)
  );
  let files: Array<{ filePath: string; mtimeMs: number }> = [];
  try {
    files = await store.listSessionFiles(dir);
  } catch {
    return [];
  }
  const entries: DroidSessionEntry[] = [];
  for (const file of files) {
    const firstLine = await store.readFirstLine(file.filePath);
    if (!firstLine) continue;
    const id = parseSessionStartId(firstLine, cwd, realCwd);
    if (id) entries.push({ id, mtimeMs: file.mtimeMs });
  }
  return entries;
}

async function findNewestSessionId(
  cwd: string,
  existingSessionIds: readonly string[],
  store: DroidSessionStore
): Promise<string | null> {
  const existing = new Set(existingSessionIds);
  const entries = (await readSessionEntries(cwd, store))
    .filter((entry) => !existing.has(entry.id))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0]?.id ?? null;
}

export async function listDroidSessionIds(
  cwd: string,
  store: DroidSessionStore
): Promise<string[]> {
  return (await readSessionEntries(cwd, store)).map((entry) => entry.id);
}

export async function findDroidSessionIdForTest(args: {
  cwd: string;
  existingSessionIds: readonly string[];
  store: DroidSessionStore;
}): Promise<string | null> {
  return findNewestSessionId(args.cwd, args.existingSessionIds, args.store);
}

export async function rememberDroidSessionId({
  conversationId,
  cwd,
  existingSessionIds,
  store,
}: {
  conversationId: string;
  cwd: string;
  existingSessionIds: readonly string[];
  store: DroidSessionStore;
}): Promise<boolean> {
  const [row] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) return false;

  const rawConfig = parseRawConfig(row.config);
  if (typeof rawConfig.providerSessionId === 'string') return true;

  const id = await findNewestSessionId(cwd, existingSessionIds, store);
  if (!id) return false;

  await db
    .update(conversations)
    .set({ config: JSON.stringify({ ...rawConfig, providerSessionId: id }) })
    .where(eq(conversations.id, conversationId));

  log.debug('rememberDroidSessionId: stored Droid provider session id', {
    conversationId,
    providerSessionId: id,
  });
  return true;
}

export const localDroidSessionStore: DroidSessionStore = {
  async home() {
    return process.env.HOME ?? '';
  },
  joinPath(...parts) {
    return path.join(...parts);
  },
  async realpath(filePath) {
    return fs.realpath(filePath).catch(() => filePath);
  },
  async listSessionFiles(dir) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return Promise.all(
      dirents
        .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.jsonl'))
        .map(async (dirent) => {
          const filePath = path.join(dir, dirent.name);
          const stat = await fs.stat(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        })
    );
  },
  async readFirstLine(filePath) {
    try {
      const handle = await fs.open(filePath, 'r');
      try {
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? null;
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  },
};

export function remoteDroidSessionStore({
  ctx,
  fs: remoteFs,
}: {
  ctx: IExecutionContext;
  fs: FileSystemProvider;
}): DroidSessionStore {
  return {
    async home() {
      return resolveRemoteHome(ctx);
    },
    joinPath(...parts) {
      return path.posix.join(...parts);
    },
    async realpath(filePath) {
      return remoteFs.realPath(filePath).catch(() => filePath);
    },
    async listSessionFiles(dir) {
      const result = await remoteFs.list(dir, { includeHidden: true });
      return result.entries
        .filter((entry) => entry.type === 'file' && entry.path.endsWith('.jsonl'))
        .map((entry) => ({ filePath: entry.path, mtimeMs: entry.mtime?.getTime() ?? 0 }));
    },
    async readFirstLine(filePath) {
      try {
        const result = await remoteFs.read(filePath, 4096);
        return result.content.split('\n')[0] ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Serializes fresh Droid starts within a single provider instance so concurrent
 * fresh sessions in the same cwd don't race to claim each other's session id.
 */
export class DroidFreshStartQueue {
  private chain: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    const previous = this.chain;
    let release: () => void = () => {};
    let released = false;
    this.chain = previous.then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await previous;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }
}

export function scheduleDroidSessionRemember({
  remember,
  release,
  logContext,
}: {
  remember: () => Promise<boolean>;
  release: () => void;
  logContext: Record<string, unknown>;
}): void {
  void (async () => {
    try {
      for (const delay of REMEMBER_RETRY_DELAYS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (await remember()) return;
      }
    } catch (error) {
      log.warn('scheduleDroidSessionRemember: failed to remember Droid session id', {
        ...logContext,
        error: String(error),
      });
    } finally {
      release();
    }
  })();
}
