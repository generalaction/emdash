import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { BoundExec } from '#services/exec/api';

/**
 * Called only while the create-worktree operation holds exclusive repository and worktree claims.
 * No-follow file descriptors close the remaining final-component symlink race inside that lock.
 */
export async function copyPreservedFiles(input: {
  repoPath: string;
  worktreePath: string;
  patterns: readonly string[];
  git: BoundExec;
  signal?: AbortSignal;
}): Promise<string[]> {
  const warnings: string[] = [];
  const copied = new Set<string>();
  const repoRoot = await realpath(input.repoPath);
  const worktreeRoot = await realpath(input.worktreePath);
  const stagingPrefix = path.join(
    path.dirname(worktreeRoot),
    `.${path.basename(worktreeRoot)}.emdash-preserve-`
  );
  await cleanupStaleStagingFiles(stagingPrefix);
  for (const pattern of input.patterns) {
    if (!isSafePattern(pattern)) {
      warnings.push(`Skipped unsafe preserve pattern "${pattern}"`);
      continue;
    }
    try {
      const sourceFiles = await matchPattern(repoRoot, pattern);
      for (const sourcePath of sourceFiles) {
        const relativePath = toPosixPath(path.relative(repoRoot, sourcePath));
        if (!relativePath || relativePath === '.emdash.json' || relativePath.startsWith('.git/')) {
          continue;
        }
        if (copied.has(relativePath)) continue;
        if (await isTracked(relativePath, input.git, input.signal)) continue;
        if (await containsSymlink(repoRoot, sourcePath)) {
          warnings.push(`Skipped symlinked preserve source "${relativePath}"`);
          continue;
        }
        const sourceRealPath = await realpath(sourcePath);
        if (!isContainedBy(repoRoot, sourceRealPath)) {
          warnings.push(`Skipped unsafe preserve source "${relativePath}"`);
          continue;
        }
        const targetPath = path.resolve(worktreeRoot, relativePath);
        if (!isContainedBy(worktreeRoot, targetPath)) {
          warnings.push(`Skipped unsafe preserve destination "${relativePath}"`);
          continue;
        }
        if (await containsSymlink(worktreeRoot, path.dirname(targetPath), true)) {
          warnings.push(`Skipped symlinked preserve destination "${relativePath}"`);
          continue;
        }
        await mkdir(path.dirname(targetPath), { recursive: true });
        const targetParent = await realpath(path.dirname(targetPath));
        if (!isContainedBy(worktreeRoot, targetParent)) {
          warnings.push(`Skipped symlinked preserve destination "${relativePath}"`);
          continue;
        }
        const existingTarget = await lstat(targetPath).catch(() => undefined);
        if (existingTarget) {
          if (existingTarget.isSymbolicLink()) {
            warnings.push(`Skipped symlinked preserve destination "${relativePath}"`);
          }
          continue;
        }
        await copyRegularFileNoFollow(sourceRealPath, targetPath, stagingPrefix, input.signal);
        copied.add(relativePath);
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      warnings.push(
        `Failed to copy preserved files for "${pattern}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return warnings;
}

async function isTracked(
  relativePath: string,
  git: BoundExec,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    await git.exec(['ls-files', '--error-unmatch', '--', relativePath], { signal });
    return true;
  } catch {
    return false;
  }
}

function isSafePattern(pattern: string): boolean {
  if (!pattern || path.isAbsolute(pattern)) return false;
  return !toPosixPath(pattern)
    .split('/')
    .some((part) => part === '..');
}

async function matchPattern(repoPath: string, pattern: string): Promise<string[]> {
  if (!pattern.includes('*') && !pattern.includes('?')) {
    const sourcePath = path.resolve(repoPath, pattern);
    if (!isContainedBy(path.resolve(repoPath), sourcePath)) return [];
    const sourceStat = await lstat(sourcePath).catch(() => undefined);
    return sourceStat?.isFile() ? [sourcePath] : [];
  }
  const matcher = globMatcher(pattern);
  const files: string[] = [];
  for await (const filePath of walkFiles(repoPath)) {
    if (matcher(toPosixPath(path.relative(repoPath, filePath)))) files.push(filePath);
  }
  return files;
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(entryPath);
    else if (entry.isFile()) yield entryPath;
  }
}

function globMatcher(pattern: string): (relativePath: string) => boolean {
  const normalized = toPosixPath(pattern);
  let regex = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      index += 1;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
  }
  const matcher = new RegExp(`^${regex}$`, 'u');
  return (relativePath) => matcher.test(relativePath);
}

function isContainedBy(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function containsSymlink(
  root: string,
  target: string,
  allowMissing = false
): Promise<boolean> {
  const relative = path.relative(root, target);
  if (!relative) return false;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return true;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return false;
}

async function copyRegularFileNoFollow(
  sourcePath: string,
  targetPath: string,
  stagingPrefix: string,
  signal?: AbortSignal
): Promise<void> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const source = await open(sourcePath, constants.O_RDONLY | noFollow);
  const stagingPath = `${stagingPrefix}${randomUUID()}.tmp`;
  let target: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const sourceStat = await source.stat();
    if (!sourceStat.isFile()) throw new Error('Preserve source is not a regular file');
    target = await open(
      stagingPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let readPosition = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await source.read(buffer, 0, buffer.length, readPosition);
      if (bytesRead === 0) break;
      let bytesWritten = 0;
      while (bytesWritten < bytesRead) {
        const result = await target.write(
          buffer,
          bytesWritten,
          bytesRead - bytesWritten,
          readPosition + bytesWritten
        );
        bytesWritten += result.bytesWritten;
      }
      readPosition += bytesRead;
    }
    await target.sync();
    await target.close();
    target = undefined;
    signal?.throwIfAborted();
    await link(stagingPath, targetPath);
    await chmod(targetPath, sourceStat.mode & 0o777);
  } finally {
    await target?.close();
    await source.close();
    await unlink(stagingPath).catch(() => undefined);
  }
}

async function cleanupStaleStagingFiles(stagingPrefix: string): Promise<void> {
  const directory = path.dirname(stagingPrefix);
  const prefix = path.basename(stagingPrefix);
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name.startsWith(prefix) && !entry.isDirectory())
      .map((entry) => unlink(path.join(directory, entry.name)).catch(() => undefined))
  );
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
