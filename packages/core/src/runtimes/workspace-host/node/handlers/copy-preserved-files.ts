import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BoundExec } from '@services/exec/api';

export async function copyPreservedFiles(input: {
  repoPath: string;
  worktreePath: string;
  patterns: readonly string[];
  git: BoundExec;
  signal?: AbortSignal;
}): Promise<string[]> {
  const warnings: string[] = [];
  for (const pattern of input.patterns) {
    if (!isSafePattern(pattern)) {
      warnings.push(`Skipped unsafe preserve pattern "${pattern}"`);
      continue;
    }
    try {
      const sourceFiles = await matchPattern(input.repoPath, pattern);
      for (const sourcePath of sourceFiles) {
        const relativePath = toPosixPath(path.relative(input.repoPath, sourcePath));
        if (!relativePath || relativePath.startsWith('.git/')) continue;
        if (await isTracked(relativePath, input.git, input.signal)) continue;
        const targetPath = path.resolve(input.worktreePath, relativePath);
        if (!isContainedBy(path.resolve(input.worktreePath), targetPath)) {
          warnings.push(`Skipped unsafe preserve destination "${relativePath}"`);
          continue;
        }
        await mkdir(path.dirname(targetPath), { recursive: true });
        await copyFile(sourcePath, targetPath);
      }
    } catch (error) {
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
    const sourceStat = await stat(sourcePath).catch(() => undefined);
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

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
