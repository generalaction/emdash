import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { log } from '@main/lib/logger';

export type JsonTrustConfig<TConfig extends object> = {
  configName: string;
  maxBytes: number;
  serviceName: string;
  parseConfig: (raw: string | null) => TConfig | null;
  serializeConfig?: (config: TConfig) => string;
  withTrustedPath: (config: TConfig, worktreePath: string) => TConfig | null;
  localPath?: (cwd: string) => Promise<string> | string;
  useFileLock?: boolean;
};

type RemoteFs = Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>;

type LockStore = Map<string, Promise<void>>;

const LOCK_RETRY_ATTEMPTS = 10;
const LOCK_RETRY_DELAY_MS = 20;

export async function ensureLocalJsonWorkspaceTrust<TConfig extends object>({
  cwd,
  homedir,
  trustConfig,
  locks,
}: {
  cwd: string;
  homedir: string;
  trustConfig: JsonTrustConfig<TConfig>;
  locks: LockStore;
}): Promise<void> {
  const normalizedPath = trustConfig.localPath
    ? await trustConfig.localPath(cwd)
    : path.resolve(cwd);
  const configPath = path.join(homedir, trustConfig.configName);

  await withTrustLock(trustConfig, configPath, locks, {
    acquireFileLock: () => acquireLocalFileLock(configPath),
    run: () =>
      ensureTrusted(normalizedPath, trustConfig, {
        readConfig: () => readLocalConfig(configPath),
        writeConfig: (content) => writeLocalConfigAtomic(configPath, content),
      }),
  });
}

export async function ensureSshJsonWorkspaceTrust<TConfig extends object>({
  cwd,
  ctx,
  remoteFs,
  trustConfig,
  locks,
}: {
  cwd: string;
  ctx: IExecutionContext;
  remoteFs: RemoteFs;
  trustConfig: JsonTrustConfig<TConfig>;
  locks: LockStore;
}): Promise<void> {
  const normalizedPath = await remoteFs.realPath(cwd).catch(() => path.posix.resolve('/', cwd));
  const homeDir = await resolveRemoteHome(ctx);
  const configPath = path.posix.join(homeDir, trustConfig.configName);

  await withTrustLock(trustConfig, configPath, locks, {
    acquireFileLock: () => acquireRemoteFileLock(ctx, configPath),
    run: () =>
      ensureTrusted(normalizedPath, trustConfig, {
        readConfig: () => readRemoteConfig(remoteFs, configPath, trustConfig.maxBytes),
        writeConfig: (content) => writeRemoteConfigAtomic(remoteFs, ctx, configPath, content),
      }),
  });
}

async function withTrustLock<TConfig extends object>(
  trustConfig: JsonTrustConfig<TConfig>,
  configPath: string,
  locks: LockStore,
  options: {
    acquireFileLock: () => Promise<() => Promise<void>>;
    run: () => Promise<void>;
  }
): Promise<void> {
  if (trustConfig.useFileLock) {
    const release = await options.acquireFileLock();
    try {
      await options.run();
    } finally {
      await release();
    }
    return;
  }

  const previous = locks.get(configPath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(options.run);
  locks.set(configPath, next);
  try {
    await next;
  } finally {
    if (locks.get(configPath) === next) {
      locks.delete(configPath);
    }
  }
}

async function ensureTrusted<TConfig extends object>(
  normalizedPath: string,
  trustConfig: JsonTrustConfig<TConfig>,
  io: {
    readConfig: () => Promise<string | null>;
    writeConfig: (content: string) => Promise<void>;
  }
): Promise<void> {
  try {
    const rawConfig = await io.readConfig();
    const config = trustConfig.parseConfig(rawConfig);
    if (!config) return;

    const nextConfig = trustConfig.withTrustedPath(config, normalizedPath);
    if (!nextConfig) return;

    const serialized =
      trustConfig.serializeConfig?.(nextConfig) ?? JSON.stringify(nextConfig, null, 2);
    await io.writeConfig(serialized.endsWith('\n') ? serialized : `${serialized}\n`);
  } catch (error: unknown) {
    log.warn(`${trustConfig.serviceName}: failed to auto-trust worktree`, {
      path: normalizedPath,
      error: String(error),
    });
  }
}

async function readLocalConfig(configPath: string): Promise<string | null> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeNotFound(error)) return null;
    throw error;
  }
}

async function writeLocalConfigAtomic(configPath: string, content: string): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, configPath);
  } catch (error: unknown) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

async function readRemoteConfig(
  remoteFs: Pick<FileSystemProvider, 'read'>,
  configPath: string,
  maxBytes: number
): Promise<string | null> {
  try {
    const result = await remoteFs.read(configPath, maxBytes);
    return result.content;
  } catch (error: unknown) {
    if (isFsNotFound(error)) return null;
    throw error;
  }
}

async function writeRemoteConfigAtomic(
  remoteFs: Pick<FileSystemProvider, 'write'>,
  ctx: IExecutionContext,
  configPath: string,
  content: string
): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await ctx.exec('mkdir', ['-p', path.posix.dirname(configPath)]);
    await remoteFs.write(tmpPath, content);
    await ctx.exec('mv', [tmpPath, configPath]);
  } catch (error: unknown) {
    try {
      await ctx.exec('rm', ['-f', tmpPath]);
    } catch {}
    throw error;
  }
}

async function acquireLocalFileLock(configPath: string): Promise<() => Promise<void>> {
  const lockPath = `${configPath}.lock`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await retryLock(() => fs.mkdir(lockPath));
  return async () => {
    await fs.rmdir(lockPath).catch(() => undefined);
  };
}

async function acquireRemoteFileLock(
  ctx: IExecutionContext,
  configPath: string
): Promise<() => Promise<void>> {
  const lockPath = `${configPath}.lock`;
  await ctx.exec('mkdir', ['-p', path.posix.dirname(configPath)]);
  await retryLock(() => ctx.exec('mkdir', [lockPath]).then(() => undefined));
  return async () => {
    await ctx.exec('rmdir', [lockPath]).catch(() => undefined);
  };
}

async function retryLock(acquire: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await acquire();
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt === LOCK_RETRY_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

function isNodeNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isFsNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === FileSystemErrorCodes.NOT_FOUND;
}
