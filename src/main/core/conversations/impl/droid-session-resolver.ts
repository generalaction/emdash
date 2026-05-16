import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';

type ConversationConfig = {
  autoApprove?: boolean;
  providerSessionId?: string;
};

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function droidSessionDirName(cwd: string) {
  return cwd.replace(/\//g, '-');
}

function parseConfig(config: string | null): ConversationConfig {
  if (!config) return {};
  try {
    const parsed = JSON.parse(config) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const candidate = parsed as ConversationConfig;
    return {
      ...(typeof candidate.autoApprove === 'boolean' ? { autoApprove: candidate.autoApprove } : {}),
      ...(typeof candidate.providerSessionId === 'string'
        ? { providerSessionId: candidate.providerSessionId }
        : {}),
    };
  } catch {
    return {};
  }
}

export function getProviderSessionId(config: string | null | undefined): string | undefined {
  const providerSessionId = parseConfig(config ?? null).providerSessionId;
  return providerSessionId && SESSION_ID_RE.test(providerSessionId) ? providerSessionId : undefined;
}

type DroidSessionStart = {
  id: string;
  title?: string;
  sessionTitle?: string;
};

type DroidSessionFile = {
  filePath: string;
  mtimeMs: number;
};

type DroidSessionStore = {
  home(): Promise<string>;
  joinPath(...parts: string[]): string;
  realpath(filePath: string): Promise<string>;
  listSessionFiles(dir: string): Promise<DroidSessionFile[]>;
  readFirstLine(filePath: string): Promise<string | null>;
};

export type DroidSessionStoreForTest = DroidSessionStore;

function parseDroidSessionStart(
  firstLine: string,
  cwd: string,
  realCwd: string
): DroidSessionStart | null {
  try {
    const event = JSON.parse(firstLine) as {
      type?: unknown;
      id?: unknown;
      cwd?: unknown;
      title?: unknown;
      sessionTitle?: unknown;
    };
    if (event.type !== 'session_start') return null;
    if (event.cwd !== cwd && event.cwd !== realCwd) return null;
    if (typeof event.id !== 'string' || !SESSION_ID_RE.test(event.id)) return null;
    return {
      id: event.id,
      ...(typeof event.title === 'string' ? { title: event.title } : {}),
      ...(typeof event.sessionTitle === 'string' ? { sessionTitle: event.sessionTitle } : {}),
    };
  } catch {
    return null;
  }
}

const localDroidSessionStore: DroidSessionStore = {
  async home() {
    return process.env.HOME ?? '';
  },

  joinPath(...parts: string[]) {
    return path.join(...parts);
  },

  async realpath(filePath: string) {
    return fs.realpath(filePath).catch(() => filePath);
  },

  async listSessionFiles(dir: string) {
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

  async readFirstLine(filePath: string) {
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

function remoteDroidSessionStore({
  ctx,
  fs,
}: {
  ctx: IExecutionContext;
  fs: FileSystemProvider;
}): DroidSessionStore {
  return {
    async home() {
      return resolveRemoteHome(ctx);
    },

    joinPath(...parts: string[]) {
      return path.posix.join(...parts);
    },

    async realpath(filePath: string) {
      return fs.realPath(filePath).catch(() => filePath);
    },

    async listSessionFiles(dir: string) {
      const result = await fs.list(dir, { includeHidden: true });
      return result.entries
        .filter((entry) => entry.type === 'file' && entry.path.endsWith('.jsonl'))
        .map((entry) => ({
          filePath: entry.path,
          mtimeMs: entry.mtime?.getTime() ?? 0,
        }));
    },

    async readFirstLine(filePath: string) {
      try {
        const result = await fs.read(filePath, 4096);
        return result.content.split('\n')[0] ?? null;
      } catch {
        return null;
      }
    },
  };
}

async function readDroidSessionStarts(
  cwd: string,
  store: DroidSessionStore
): Promise<Array<DroidSessionStart & { mtimeMs: number }>> {
  const realCwd = await store.realpath(cwd);
  const dir = store.joinPath(
    await store.home(),
    '.factory',
    'sessions',
    droidSessionDirName(realCwd)
  );
  let entries: DroidSessionFile[] = [];
  try {
    entries = await store.listSessionFiles(dir);
  } catch {
    return [];
  }

  const starts: Array<DroidSessionStart & { mtimeMs: number }> = [];
  for (const entry of entries) {
    const firstLine = await store.readFirstLine(entry.filePath);
    if (!firstLine) continue;

    const start = parseDroidSessionStart(firstLine, cwd, realCwd);
    if (start) starts.push({ ...start, mtimeMs: entry.mtimeMs });
  }

  return starts;
}

async function getCurrentDroidSessionIds(cwd: string, store: DroidSessionStore): Promise<string[]> {
  return (await readDroidSessionStarts(cwd, store)).map((start) => start.id);
}

async function findNewestDroidSessionId(
  cwd: string,
  startedAt: number,
  expectedTitle: string | undefined,
  existingSessionIds: readonly string[],
  store: DroidSessionStore
): Promise<string | null> {
  const existingIds = new Set(existingSessionIds);
  const starts = (await readDroidSessionStarts(cwd, store))
    .filter((start) => !existingIds.has(start.id) && start.mtimeMs >= startedAt - 1000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (expectedTitle) {
    const matchingStart = starts.find(
      (start) => start.title === expectedTitle || start.sessionTitle === expectedTitle
    );
    if (matchingStart) return matchingStart.id;
  }

  return starts[0]?.id ?? null;
}

async function rememberDroidSessionIdFromStore({
  conversationId,
  cwd,
  startedAt,
  initialPrompt,
  existingSessionIds,
  store,
}: {
  conversationId: string;
  cwd: string;
  startedAt: number;
  initialPrompt?: string;
  existingSessionIds: readonly string[];
  store: DroidSessionStore;
}): Promise<boolean> {
  const [row] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) return false;

  const config = parseConfig(row.config);
  if (config.providerSessionId) return true;

  const id = await findNewestDroidSessionId(
    cwd,
    startedAt,
    initialPrompt,
    existingSessionIds,
    store
  );
  if (!id) return false;

  await db
    .update(conversations)
    .set({ config: JSON.stringify({ ...config, providerSessionId: id }) })
    .where(eq(conversations.id, conversationId));

  log.debug('rememberDroidSessionId: stored Droid provider session id', {
    conversationId,
    providerSessionId: id,
  });
  return true;
}

export async function findDroidSessionIdForTest({
  cwd,
  startedAt,
  expectedTitle,
  existingSessionIds,
  store,
}: {
  cwd: string;
  startedAt: number;
  expectedTitle?: string;
  existingSessionIds: readonly string[];
  store: DroidSessionStoreForTest;
}): Promise<string | null> {
  return findNewestDroidSessionId(cwd, startedAt, expectedTitle, existingSessionIds, store);
}

export async function getCurrentLocalDroidSessionIds(cwd: string): Promise<string[]> {
  return getCurrentDroidSessionIds(cwd, localDroidSessionStore);
}

export async function rememberDroidSessionId({
  conversationId,
  cwd,
  startedAt,
  initialPrompt,
  existingSessionIds,
}: {
  conversationId: string;
  cwd: string;
  startedAt: number;
  initialPrompt?: string;
  existingSessionIds: readonly string[];
}): Promise<boolean> {
  return rememberDroidSessionIdFromStore({
    conversationId,
    cwd,
    startedAt,
    initialPrompt,
    existingSessionIds,
    store: localDroidSessionStore,
  });
}

export async function getCurrentRemoteDroidSessionIds({
  cwd,
  ctx,
  fs,
}: {
  cwd: string;
  ctx: IExecutionContext;
  fs: FileSystemProvider;
}): Promise<string[]> {
  return getCurrentDroidSessionIds(cwd, remoteDroidSessionStore({ ctx, fs }));
}

export async function rememberRemoteDroidSessionId({
  conversationId,
  cwd,
  startedAt,
  initialPrompt,
  existingSessionIds,
  ctx,
  fs,
}: {
  conversationId: string;
  cwd: string;
  startedAt: number;
  initialPrompt?: string;
  existingSessionIds: readonly string[];
  ctx: IExecutionContext;
  fs: FileSystemProvider;
}): Promise<boolean> {
  return rememberDroidSessionIdFromStore({
    conversationId,
    cwd,
    startedAt,
    initialPrompt,
    existingSessionIds,
    store: remoteDroidSessionStore({ ctx, fs }),
  });
}
