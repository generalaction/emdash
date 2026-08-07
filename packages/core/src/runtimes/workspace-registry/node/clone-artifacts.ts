import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, cp, glob, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_EXCLUDE_PATTERNS,
  EMDASH_CONFIG_FILE,
  parseEmdashConfig,
} from '@primitives/emdash-config/api';
import { createRegistryGitExec } from './scan/observe-git';

const execFileAsync = promisify(execFile);

export type CloneArtifactsInput = {
  repositoryPath: string;
  worktreePath: string;
  /** Honored-but-deprecated: applied as a targeted post-clone copy of ignored files. */
  preservePatterns: readonly string[];
};

export type CloneArtifactsOutcome =
  | {
      status: 'succeeded';
      /** 'cow' when every entry cloned on the fast tier; 'copy' when any fell back. */
      engine: 'cow' | 'copy' | 'none';
      entries: number;
      warnings: string[];
    }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; message: string };

/** Staging suffix for entry-level rename idempotency; replays clean and redo these. */
const STAGING_SUFFIX = '.emdash-clone-tmp';

/**
 * The clone-artifacts background step: materializes the parent checkout's entire
 * gitignored set (the `git clean -fdX` complement) into a freshly created worktree so
 * it is runnable without installing dependencies. Copy-on-write where the filesystem
 * supports it (attempt-and-fallback, no probing), plain copy elsewhere. Each top-level
 * ignored entry is staged under a temp name and renamed into place, so a replayed clone
 * redoes only missing entries and never trusts a torn directory. `excludePatterns`
 * (built-ins + the repository's `.emdash.json`) are deleted post-clone; `['**']` opts
 * out of cloning entirely. Deprecated `preservePatterns` ride along as a targeted copy.
 */
export async function executeCloneArtifacts(
  input: CloneArtifactsInput
): Promise<CloneArtifactsOutcome> {
  const warnings: string[] = [];
  let excludePatterns: string[];
  try {
    excludePatterns = await readExcludePatterns(input.repositoryPath);
  } catch {
    excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS];
  }
  const optedOut = excludePatterns.includes('**');

  let engine: 'cow' | 'copy' | 'none' = 'none';
  let entries = 0;
  const errors: string[] = [];

  if (!optedOut) {
    let ignored: string[];
    try {
      ignored = await listIgnoredEntries(input.repositoryPath);
    } catch (error) {
      return { status: 'failed', message: `Could not enumerate ignored files: ${message(error)}` };
    }

    for (const entry of ignored) {
      if (entry === EMDASH_CONFIG_FILE || entry === '.git' || entry.startsWith('.git/')) continue;
      const outcome = await cloneEntry(input.repositoryPath, input.worktreePath, entry);
      if (outcome === 'failed-terminally') {
        errors.push(entry);
        continue;
      }
      if (outcome === 'existing') continue;
      entries += 1;
      if (outcome === 'cloned-cow') {
        engine = engine === 'copy' ? 'copy' : 'cow';
      } else {
        engine = 'copy';
      }
    }

    try {
      await deleteExcluded(input.worktreePath, excludePatterns);
    } catch (error) {
      warnings.push(`Exclude-pattern cleanup failed: ${message(error)}`);
    }
  }

  // The deprecated preservePatterns shim: one enumeration subprocess, no tree walk.
  // Runs even when cloning is opted out, so legacy `.env`-family configs keep working.
  if (input.preservePatterns.length > 0) {
    try {
      warnings.push(...(await copyPreservedIgnoredFiles(input)));
    } catch (error) {
      warnings.push(`Preserved-file copy failed: ${message(error)}`);
    }
  }

  if (errors.length > 0) {
    return {
      status: 'failed',
      message:
        `Could not clone ${errors.length} artifact ${errors.length === 1 ? 'entry' : 'entries'} ` +
        `(first: ${errors[0]}). The workspace works; run your dependency install if needed.`,
    };
  }
  if (optedOut) {
    return { status: 'skipped', reason: 'Artifact cloning is disabled by excludePatterns' };
  }
  return { status: 'succeeded', engine, entries, warnings };
}

async function readExcludePatterns(repositoryPath: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(path.join(repositoryPath, EMDASH_CONFIG_FILE), 'utf8');
  } catch {
    return [...DEFAULT_EXCLUDE_PATTERNS];
  }
  const config = parseEmdashConfig(content).data;
  return [...(config.excludePatterns ?? []), ...DEFAULT_EXCLUDE_PATTERNS];
}

/**
 * The `git clean -fdX` complement: ignored files plus topmost fully-ignored directories
 * (git collapses those, so nested artifacts ride their parent entry). Paths are
 * repo-relative POSIX; directories carry a trailing slash.
 */
async function listIgnoredEntries(repositoryPath: string): Promise<string[]> {
  const git = createRegistryGitExec(repositoryPath);
  const result = await git.exec([
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
  ]);
  return result.stdout.split('\0').filter(Boolean);
}

type CloneEntryOutcome = 'cloned-cow' | 'cloned-copy' | 'existing' | 'failed-terminally';

/**
 * Clones one ignored entry with staged-rename idempotency: an existing destination is
 * trusted (a completed rename is atomic), stale staging is deleted, the best engine is
 * attempted first and a plain copy retried once on any failure.
 */
async function cloneEntry(
  repositoryPath: string,
  worktreePath: string,
  entry: string
): Promise<CloneEntryOutcome> {
  const relative = entry.replace(/\/$/, '');
  const source = path.join(repositoryPath, relative);
  const destination = path.join(worktreePath, relative);
  const staging = destination + STAGING_SUFFIX;

  if (await exists(destination)) return 'existing';
  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
  } catch {
    return 'failed-terminally';
  }

  let tier: 'cow' | 'copy' = 'cow';
  try {
    await cowClone(source, staging);
  } catch {
    // Attempt-and-fallback (EXDEV/ENOTSUP-class failures included): delete the partial
    // destination and retry once as a plain copy.
    tier = 'copy';
    try {
      await rm(staging, { recursive: true, force: true });
      await copyFile(source, staging).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EISDIR') throw error;
        await plainCopyDirectory(source, staging);
      });
    } catch {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      return 'failed-terminally';
    }
  }

  try {
    await rename(staging, destination);
  } catch {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    // A concurrent replay may have landed the entry; that is success, not failure.
    return (await exists(destination)) ? 'existing' : 'failed-terminally';
  }
  return tier === 'cow' ? 'cloned-cow' : 'cloned-copy';
}

/**
 * The best-tier clone: `cp -c` (per-file clonefile) on macOS, `cp -a --reflink=auto`
 * on Linux — the flag already degrades reflink→copy on ext4, so a failure here is a
 * real error. No native code (spec: Node/libuv cannot issue clonefile on Darwin).
 */
async function cowClone(source: string, destination: string): Promise<void> {
  if (process.platform === 'darwin') {
    // Note: modern macOS `cp -c` silently falls back to a plain copy on non-APFS
    // volumes, so the reported 'cow' tier is best-effort on macOS.
    await execFileAsync('cp', ['-c', '-R', source, destination]);
    return;
  }
  if (process.platform === 'linux') {
    await execFileAsync('cp', ['-a', '--reflink=auto', source, destination]);
    return;
  }
  throw new Error(`No copy-on-write tier on ${process.platform}`);
}

async function plainCopyDirectory(source: string, destination: string): Promise<void> {
  // fs.cp is the portable plain tier (Windows included); symlinks copy as links.
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
}

/** Deletes exclude-pattern matches inside the worktree, never following outside it. */
async function deleteExcluded(worktreePath: string, patterns: string[]): Promise<void> {
  const safePatterns = patterns.filter((pattern) => pattern !== '**' && isSafePattern(pattern));
  if (safePatterns.length === 0) return;
  const matches: string[] = [];
  for await (const match of glob(safePatterns, { cwd: worktreePath })) {
    matches.push(match);
  }
  for (const match of matches) {
    if (match === '.git' || match.startsWith(`.git${path.sep}`)) continue;
    const target = path.resolve(worktreePath, match);
    if (!isContainedBy(worktreePath, target)) continue;
    await rm(target, { recursive: true, force: true });
  }
}

/**
 * The preservePatterns shim: matches the deprecated patterns against the ignored file
 * list (one `git ls-files` call — no recursive walk, no per-file subprocesses) and
 * copies missing matches. The old engine's untracked-but-not-ignored edge case is
 * deliberately dropped (spec: artifact selection).
 */
async function copyPreservedIgnoredFiles(input: CloneArtifactsInput): Promise<string[]> {
  const warnings: string[] = [];
  const git = createRegistryGitExec(input.repositoryPath);
  const result = await git.exec(['ls-files', '--others', '--ignored', '--exclude-standard', '-z']);
  const ignoredFiles = result.stdout.split('\0').filter(Boolean);

  const matchers: Array<(relative: string) => boolean> = [];
  for (const pattern of input.preservePatterns) {
    if (!isSafePattern(pattern)) {
      warnings.push(`Skipped unsafe preserve pattern "${pattern}"`);
      continue;
    }
    matchers.push(globMatcher(pattern));
  }
  if (matchers.length === 0) return warnings;

  for (const relative of ignoredFiles) {
    if (relative === EMDASH_CONFIG_FILE || relative.startsWith('.git/')) continue;
    if (!matchers.some((matches) => matches(relative))) continue;
    const source = path.join(input.repositoryPath, relative);
    const destination = path.resolve(input.worktreePath, relative);
    if (!isContainedBy(input.worktreePath, destination)) {
      warnings.push(`Skipped unsafe preserve destination "${relative}"`);
      continue;
    }
    try {
      const stat = await lstat(source);
      if (!stat.isFile()) continue;
      if (await exists(destination)) continue;
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      warnings.push(`Could not copy preserved file "${relative}": ${message(error)}`);
    }
  }
  return warnings;
}

function isSafePattern(pattern: string): boolean {
  if (!pattern || path.isAbsolute(pattern)) return false;
  return !pattern.split(/[\\/]/).some((part) => part === '..');
}

/** Minimal glob semantics shared with the legacy engine: `**`, `*`, and `?`. */
function globMatcher(pattern: string): (relativePath: string) => boolean {
  const normalized = pattern.split(path.sep).join('/');
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

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
