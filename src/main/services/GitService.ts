import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseDiffLines,
  stripTrailingNewline,
  MAX_DIFF_CONTENT_BYTES,
  MAX_DIFF_OUTPUT_BYTES,
} from '../utils/diffParser';
import { parseGitStatusOutput, parseNumstatOutput } from '../utils/gitStatusParser';
import type { DiffResult } from '../utils/diffParser';
import {
  buildAddedDiffLines,
  buildDeletedDiffLines,
  buildOptionalDiffWarnings,
  isMaxBufferError,
  type CappedTextResult,
} from './git-core/diffShared';
import { updateIndexShared } from './git-core/indexShared';
import { revertFileShared } from './git-core/revertShared';
import {
  applyUntrackedLineCounts,
  buildStatusChanges,
  MAX_UNTRACKED_LINECOUNT_BYTES,
} from './git-core/statusShared';
import { resolveWorkingTreeDiffResult } from './git-core/workingTreeDiffShared';
import type { GitChange, GitIndexUpdateArgs } from '../../shared/git/types';

const execFileAsync = promisify(execFile);
const FORCE_LOAD_DIFF_CONTENT_BYTES = 5 * 1024 * 1024;
const FORCE_LOAD_DIFF_OUTPUT_BYTES = 30 * 1024 * 1024;

async function countFileNewlinesCapped(filePath: string, maxBytes: number): Promise<number | null> {
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
    stream.on('data', (chunk: string | Buffer) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === 0x0a) count++;
      }
    });
    stream.on('error', () => resolve(null));
    stream.on('end', () => resolve(count));
  });
}

async function readFileTextCapped(filePath: string, maxBytes: number): Promise<CappedTextResult> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return { exists: false, tooLarge: false };
  }

  if (!stat.isFile()) {
    return { exists: false, tooLarge: false };
  }
  if (stat.size > maxBytes) {
    return { exists: true, tooLarge: true };
  }

  try {
    const contentBuffer = await fs.promises.readFile(filePath);
    if (contentBuffer.includes(0x00)) {
      return { exists: true, tooLarge: false, isBinary: true };
    }

    const content = contentBuffer.toString('utf8');
    return {
      exists: true,
      tooLarge: false,
      content: stripTrailingNewline(content),
    };
  } catch {
    return { exists: true, tooLarge: false };
  }
}

async function readGitTextCapped(
  taskPath: string,
  objectSpec: string,
  maxBytes: number
): Promise<CappedTextResult> {
  try {
    const { stdout: sizeStdout } = await execFileAsync('git', ['cat-file', '-s', objectSpec], {
      cwd: taskPath,
    });
    const size = parseInt(sizeStdout.trim(), 10);
    if (Number.isFinite(size) && size > maxBytes) {
      return { exists: true, tooLarge: true };
    }
  } catch {
    return { exists: false, tooLarge: false };
  }

  try {
    const { stdout } = (await execFileAsync('git', ['show', objectSpec], {
      cwd: taskPath,
      maxBuffer: maxBytes,
      encoding: 'buffer',
    })) as { stdout: Buffer };

    if (stdout.includes(0x00)) {
      return { exists: true, tooLarge: false, isBinary: true };
    }

    return {
      exists: true,
      tooLarge: false,
      content: stripTrailingNewline(stdout.toString('utf8')),
    };
  } catch (error) {
    if (isMaxBufferError(error)) {
      return { exists: true, tooLarge: true };
    }
    return { exists: true, tooLarge: false };
  }
}

async function resolveReviewBaseRef(taskPath: string, baseRef: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', baseRef, 'HEAD'], {
      cwd: taskPath,
    });
    const mergeBase = stdout.trim();
    if (mergeBase) return mergeBase;
  } catch {
    // Fall back to the requested base ref when merge-base cannot be resolved.
  }

  return baseRef;
}

export async function getStatus(taskPath: string): Promise<GitChange[]> {
  try {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: taskPath,
      });
    } catch {
      return [];
    }

    // Run git commands in parallel with flags tuned for performance:
    //   --no-optional-locks: avoid blocking on concurrent git processes
    //   --no-ahead-behind:   skip commit-graph walk for tracking info
    const statusPromise = (async () => {
      try {
        const { stdout } = await execFileAsync(
          'git',
          [
            '--no-optional-locks',
            'status',
            '--porcelain=v2',
            '-z',
            '--no-ahead-behind',
            '--untracked-files=all',
          ],
          {
            cwd: taskPath,
            maxBuffer: MAX_DIFF_OUTPUT_BYTES,
          }
        );
        return stdout;
      } catch {
        // Fallback for older git versions that do not support porcelain v2.
        const { stdout } = await execFileAsync(
          'git',
          ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'],
          {
            cwd: taskPath,
            maxBuffer: MAX_DIFF_OUTPUT_BYTES,
          }
        );
        return stdout;
      }
    })();

    const stagedPromise = execFileAsync(
      'git',
      ['--no-optional-locks', 'diff', '--numstat', '--cached'],
      {
        cwd: taskPath,
        maxBuffer: MAX_DIFF_OUTPUT_BYTES,
      }
    ).catch(() => ({
      stdout: '',
      stderr: '',
    }));

    const unstagedPromise = execFileAsync('git', ['--no-optional-locks', 'diff', '--numstat'], {
      cwd: taskPath,
      maxBuffer: MAX_DIFF_OUTPUT_BYTES,
    }).catch(() => ({
      stdout: '',
      stderr: '',
    }));

    const [statusOutput, stagedResult, unstagedResult] = await Promise.all([
      statusPromise,
      stagedPromise,
      unstagedPromise,
    ]);

    if (!statusOutput.trim()) return [];

    const entries = parseGitStatusOutput(statusOutput);

    const stagedMap = parseNumstatOutput(stagedResult.stdout);
    const unstagedMap = parseNumstatOutput(unstagedResult.stdout);
    const { changes, untrackedPathsNeedingCounts } = buildStatusChanges(
      entries,
      stagedMap,
      unstagedMap
    );

    if (untrackedPathsNeedingCounts.length === 0) {
      return changes;
    }

    const counts = await Promise.all(
      untrackedPathsNeedingCounts.map((filePath) =>
        countFileNewlinesCapped(path.join(taskPath, filePath), MAX_UNTRACKED_LINECOUNT_BYTES)
      )
    );
    const untrackedMap = new Map<string, number | null>();
    for (let i = 0; i < untrackedPathsNeedingCounts.length; i++) {
      untrackedMap.set(untrackedPathsNeedingCounts[i], counts[i] ?? null);
    }

    return applyUntrackedLineCounts(changes, untrackedMap);
  } catch {
    return [];
  }
}

function normalizeLocalRelativeFilePath(taskPath: string, filePath: string): string {
  const absPath = path.resolve(taskPath, filePath);
  const resolvedTaskPath = path.resolve(taskPath);
  if (!absPath.startsWith(resolvedTaskPath + path.sep) && absPath !== resolvedTaskPath) {
    throw new Error('File path is outside the worktree');
  }

  const relativePath = path.relative(resolvedTaskPath, absPath);
  const normalizedPath = relativePath.split(path.sep).join('/');
  if (!normalizedPath || normalizedPath === '.') {
    throw new Error('Invalid file path');
  }

  return normalizedPath;
}

export async function updateIndex(taskPath: string, args: GitIndexUpdateArgs): Promise<void> {
  await updateIndexShared(args, {
    stageAll: async () => {
      await execFileAsync('git', ['add', '-A'], { cwd: taskPath });
    },
    resetAll: async () => {
      try {
        await execFileAsync('git', ['reset', 'HEAD', '--', '.'], { cwd: taskPath });
        return true;
      } catch {
        return false;
      }
    },
    listStagedPaths: async () => {
      const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
        cwd: taskPath,
      });
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    },
    stagePaths: async (filePaths) => {
      await execFileAsync('git', ['add', '--', ...filePaths], { cwd: taskPath });
    },
    resetPaths: async (filePaths) => {
      try {
        await execFileAsync('git', ['reset', 'HEAD', '--', ...filePaths], { cwd: taskPath });
        return true;
      } catch {
        return false;
      }
    },
    resetPath: async (filePath) => {
      try {
        await execFileAsync('git', ['reset', 'HEAD', '--', filePath], { cwd: taskPath });
        return true;
      } catch {
        return false;
      }
    },
    removePathFromIndex: async (filePath) => {
      await execFileAsync('git', ['rm', '--cached', '--', filePath], { cwd: taskPath });
    },
  });
}

export async function revertFile(
  taskPath: string,
  filePath: string
): Promise<{ action: 'reverted' }> {
  return revertFileShared(filePath, {
    normalizeFilePath: (pathInput) => normalizeLocalRelativeFilePath(taskPath, pathInput),
    existsInHead: async (safePath) => {
      try {
        await execFileAsync('git', ['cat-file', '-e', `HEAD:${safePath}`], { cwd: taskPath });
        return true;
      } catch {
        return false;
      }
    },
    deleteUntracked: async (safePath) => {
      const absPath = path.resolve(taskPath, safePath);
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
      }
    },
    checkoutHead: async (safePath) => {
      try {
        await execFileAsync('git', ['checkout', 'HEAD', '--', safePath], { cwd: taskPath });
      } catch (error) {
        throw new Error(
          `Failed to revert file: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  });
}

export async function getFileDiff(
  taskPath: string,
  filePath: string,
  baseRef?: string,
  forceLarge?: boolean
): Promise<DiffResult> {
  const safeFilePath = normalizeLocalRelativeFilePath(taskPath, filePath);
  const diffContentLimit = forceLarge ? FORCE_LOAD_DIFF_CONTENT_BYTES : MAX_DIFF_CONTENT_BYTES;
  const diffOutputLimit = forceLarge ? FORCE_LOAD_DIFF_OUTPUT_BYTES : MAX_DIFF_OUTPUT_BYTES;

  const reviewBaseRef = baseRef ? await resolveReviewBaseRef(taskPath, baseRef) : undefined;
  const originalRef = reviewBaseRef || 'HEAD';

  // Helper: fetch content at the base ref with size guard
  const getOriginalContent = async (): Promise<CappedTextResult> => {
    return readGitTextCapped(taskPath, `${originalRef}:${safeFilePath}`, diffContentLimit);
  };

  const getModifiedContent = async (): Promise<CappedTextResult> => {
    if (baseRef) {
      return readGitTextCapped(taskPath, `HEAD:${safeFilePath}`, diffContentLimit);
    }

    return readFileTextCapped(path.join(taskPath, safeFilePath), diffContentLimit);
  };

  const [original, modified] = await Promise.all([getOriginalContent(), getModifiedContent()]);

  // Fast path: if we already know this file is binary or too large, skip expensive diff generation.
  if (original.isBinary || modified.isBinary) {
    return { lines: [], mode: 'binary', isBinary: true };
  }
  if (original.tooLarge || modified.tooLarge) {
    return resolveWorkingTreeDiffResult({
      diffStdout: undefined,
      diffLines: [],
      hasHunk: false,
      diffTooLarge: true,
      diffFailed: false,
      original,
      modified,
    });
  }

  // Step 1: Run git diff
  let diffStdout: string | undefined;
  let diffTooLarge = false;
  let diffFailed = false;
  try {
    const diffArgs = baseRef
      ? ['diff', '--no-color', '--unified=2000', originalRef, 'HEAD', '--', safeFilePath]
      : ['diff', '--no-color', '--unified=2000', 'HEAD', '--', safeFilePath];
    const { stdout } = await execFileAsync('git', diffArgs, {
      cwd: taskPath,
      maxBuffer: diffOutputLimit,
    });
    diffStdout = stdout;
  } catch (error) {
    diffTooLarge = isMaxBufferError(error);
    diffFailed = !diffTooLarge;
    // git diff failed (no HEAD, untracked file, etc.) — fall through to content-only path
  }

  // Step 2: Parse diff and check mode
  let diffLines: DiffResult['lines'] = [];
  let hasHunk = false;
  if (diffStdout !== undefined) {
    const parsed = parseDiffLines(diffStdout);
    if (parsed.isBinary) {
      return { lines: [], mode: 'binary', isBinary: true };
    }
    diffLines = parsed.lines;
    hasHunk = parsed.hasHunk;
  }

  return resolveWorkingTreeDiffResult({
    diffStdout,
    diffLines,
    hasHunk,
    diffTooLarge,
    diffFailed,
    original,
    modified,
  });
}

/** Commit staged files (no push). Returns the commit hash. */
export async function commit(
  taskPath: string,
  message: string,
  options: { noVerify?: boolean } = {}
): Promise<{ hash: string }> {
  if (!message || !message.trim()) {
    throw new Error('Commit message cannot be empty');
  }
  const args = ['commit', '-m', message];
  if (options.noVerify) {
    args.push('--no-verify');
  }
  await execFileAsync('git', args, { cwd: taskPath });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: taskPath });
  return { hash: stdout.trim() };
}

/** Push current branch to origin. Sets upstream if needed. */
export async function push(taskPath: string): Promise<{ output: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['push'], { cwd: taskPath });
    return { output: stdout.trim() };
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || '';
    // Only fallback to --set-upstream if git tells us there's no upstream
    if (stderr.includes('has no upstream branch') || stderr.includes('no upstream configured')) {
      const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], {
        cwd: taskPath,
      });
      const { stdout } = await execFileAsync(
        'git',
        ['push', '--set-upstream', 'origin', branch.trim()],
        { cwd: taskPath }
      );
      return { output: stdout.trim() };
    }
    throw error;
  }
}

/** Pull from remote. */
export async function pull(taskPath: string): Promise<{ output: string }> {
  const { stdout } = await execFileAsync('git', ['pull'], { cwd: taskPath });
  return { output: stdout.trim() };
}

/** Get commit log for the current branch. */
export async function getLog(
  taskPath: string,
  maxCount: number = 50,
  skip: number = 0,
  knownAheadCount?: number
): Promise<{
  commits: Array<{
    hash: string;
    subject: string;
    body: string;
    author: string;
    authorEmail: string;
    date: string;
    isPushed: boolean;
    tags: string[];
  }>;
  aheadCount: number;
}> {
  // Use caller-provided aheadCount for pagination consistency, otherwise compute it.
  // Strategy: try upstream tracking branch first, then origin/<branch>, then origin/HEAD.
  // If none work, assume all commits are pushed (aheadCount = 0).
  let aheadCount = knownAheadCount ?? -1;
  if (aheadCount < 0) {
    aheadCount = 0;
    try {
      // Best case: branch has an upstream tracking ref
      const { stdout: countOut } = await execFileAsync(
        'git',
        ['rev-list', '--count', '@{upstream}..HEAD'],
        { cwd: taskPath }
      );
      aheadCount = parseInt(countOut.trim(), 10) || 0;
    } catch {
      try {
        // Fallback: compare against origin/<current-branch>
        const { stdout: branchOut } = await execFileAsync(
          'git',
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd: taskPath }
        );
        const currentBranch = branchOut.trim();
        const { stdout: countOut } = await execFileAsync(
          'git',
          ['rev-list', '--count', `origin/${currentBranch}..HEAD`],
          { cwd: taskPath }
        );
        aheadCount = parseInt(countOut.trim(), 10) || 0;
      } catch {
        try {
          // Last resort: compare against origin/HEAD (default branch)
          const { stdout: defaultBranchOut } = await execFileAsync(
            'git',
            ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
            { cwd: taskPath }
          );
          const defaultBranch = defaultBranchOut.trim();
          const { stdout: countOut } = await execFileAsync(
            'git',
            ['rev-list', '--count', `${defaultBranch}..HEAD`],
            { cwd: taskPath }
          );
          aheadCount = parseInt(countOut.trim(), 10) || 0;
        } catch {
          // Cannot determine remote state (no remote, detached HEAD, offline, etc.)
          // Default to 0 ahead so all commits show as pushed. This avoids false "unpushed"
          // indicators when there's genuinely no remote to compare against.
          aheadCount = 0;
        }
      }
    }
  }

  const FIELD_SEP = '---FIELD_SEP---';
  const RECORD_SEP = '---RECORD_SEP---';
  const format = `${RECORD_SEP}%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%ae${FIELD_SEP}%b`;
  const { stdout } = await execFileAsync(
    'git',
    ['log', `--max-count=${maxCount}`, `--skip=${skip}`, `--pretty=format:${format}`, '--'],
    { cwd: taskPath }
  );

  if (!stdout.trim()) return { commits: [], aheadCount };

  const commits = stdout
    .split(RECORD_SEP)
    .filter((entry) => entry.trim())
    .map((entry, index) => {
      const parts = entry.trim().split(FIELD_SEP);
      // %D outputs ref decorations like "tag: v0.4.2, origin/main, HEAD -> main"
      const refs = parts[4] || '';
      const tags = refs
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.startsWith('tag: '))
        .map((r) => r.slice(5));
      return {
        hash: parts[0] || '',
        subject: parts[1] || '',
        body: (parts[6] || '').trim(),
        author: parts[2] || '',
        authorEmail: parts[5] || '',
        date: parts[3] || '',
        isPushed: skip + index >= aheadCount,
        tags,
      };
    });

  return { commits, aheadCount };
}

/** Get the latest commit info (subject + body). */
export async function getLatestCommit(
  taskPath: string
): Promise<{ hash: string; subject: string; body: string; isPushed: boolean } | null> {
  const { commits } = await getLog(taskPath, 1);
  return commits[0] || null;
}

/** Get files changed in a specific commit. */
export async function getCommitFiles(
  taskPath: string,
  commitHash: string
): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
  // Use --root to handle initial commits (no parent) and
  // -m --first-parent to handle merge commits (compare against first parent only)
  const { stdout } = await execFileAsync(
    'git',
    [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '-r',
      '-m',
      '--first-parent',
      '--numstat',
      commitHash,
    ],
    { cwd: taskPath }
  );

  const { stdout: nameStatus } = await execFileAsync(
    'git',
    [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '-r',
      '-m',
      '--first-parent',
      '--name-status',
      commitHash,
    ],
    { cwd: taskPath }
  );

  const statLines = stdout.trim().split('\n').filter(Boolean);
  const statusLines = nameStatus.trim().split('\n').filter(Boolean);

  const statusMap = new Map<string, string>();
  for (const line of statusLines) {
    const [code, ...pathParts] = line.split('\t');
    const filePath = pathParts[pathParts.length - 1] || '';
    const status =
      code === 'A'
        ? 'added'
        : code === 'D'
          ? 'deleted'
          : code?.startsWith('R')
            ? 'renamed'
            : 'modified';
    statusMap.set(filePath, status);
  }

  return statLines.map((line) => {
    const [addStr, delStr, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    return {
      path: filePath,
      status: statusMap.get(filePath) || 'modified',
      additions: addStr === '-' ? 0 : parseInt(addStr || '0', 10) || 0,
      deletions: delStr === '-' ? 0 : parseInt(delStr || '0', 10) || 0,
    };
  });
}

/** Get diff for a specific file in a specific commit. */
export async function getCommitFileDiff(
  taskPath: string,
  commitHash: string,
  filePath: string,
  forceLarge?: boolean
): Promise<DiffResult> {
  const safeFilePath = normalizeLocalRelativeFilePath(taskPath, filePath);
  const diffContentLimit = forceLarge ? FORCE_LOAD_DIFF_CONTENT_BYTES : MAX_DIFF_CONTENT_BYTES;
  const diffOutputLimit = forceLarge ? FORCE_LOAD_DIFF_OUTPUT_BYTES : MAX_DIFF_OUTPUT_BYTES;

  // Helper: fetch content at a given ref with size guard
  const getContentAt = async (ref: string): Promise<CappedTextResult> => {
    return readGitTextCapped(taskPath, `${ref}:${safeFilePath}`, diffContentLimit);
  };

  // Check if this is a root commit (no parent)
  let hasParent = true;
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `${commitHash}~1`], { cwd: taskPath });
  } catch {
    hasParent = false;
  }

  if (!hasParent) {
    const modified = await getContentAt(commitHash);
    const modifiedContent = modified.content;

    if (modified.isBinary) {
      const result = { lines: [], mode: 'binary' as const, isBinary: true };
      return result;
    }
    if (modified.tooLarge) {
      const result = { lines: [], mode: 'largeText' as const };
      return result;
    }
    if (modifiedContent === undefined) {
      const result = { lines: [], mode: 'unrenderable' as const };
      return result;
    }
    if (modifiedContent === '') {
      const result = { lines: [], mode: 'text' as const, modifiedContent };
      return result;
    }
    const lines = buildAddedDiffLines(modifiedContent);
    const result = {
      lines,
      mode: 'text' as const,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(undefined, modifiedContent, lines),
    };
    return result;
  }

  const [original, modified] = await Promise.all([
    getContentAt(`${commitHash}~1`),
    getContentAt(commitHash),
  ]);
  if (original.isBinary || modified.isBinary) {
    const result = { lines: [], mode: 'binary' as const, isBinary: true };
    return result;
  }
  if (original.tooLarge || modified.tooLarge) {
    const originalContent = original.content;
    const modifiedContent = modified.content;
    const result = {
      lines: [],
      mode: 'largeText' as const,
      originalContent,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, []),
    };
    return result;
  }

  // Run diff
  let diffStdout: string | undefined;
  let diffTooLarge = false;
  let diffFailed = false;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', safeFilePath],
      { cwd: taskPath, maxBuffer: diffOutputLimit }
    );
    diffStdout = stdout;
  } catch (error) {
    diffTooLarge = isMaxBufferError(error);
    diffFailed = !diffTooLarge;
    // diff too large or git error — fall through to content-only path
  }

  let diffLines: DiffResult['lines'] = [];
  let hasHunk = false;
  if (diffStdout !== undefined) {
    const { lines, isBinary, hasHunk: parsedHasHunk } = parseDiffLines(diffStdout);
    if (isBinary) {
      const result = { lines: [], mode: 'binary' as const, isBinary: true };
      return result;
    }
    diffLines = lines;
    hasHunk = parsedHasHunk;
  }

  const originalContent = original.content;
  const modifiedContent = modified.content;
  const warnings = buildOptionalDiffWarnings(originalContent, modifiedContent, diffLines);

  if (diffTooLarge || original.tooLarge || modified.tooLarge) {
    const result = {
      lines: diffLines,
      mode: 'largeText' as const,
      originalContent,
      modifiedContent,
      warnings,
    };
    return result;
  }

  if (diffLines.length > 0) {
    const result = {
      lines: diffLines,
      mode: 'text' as const,
      originalContent,
      modifiedContent,
      warnings,
    };
    return result;
  }

  if (!hasHunk && diffStdout !== undefined && diffStdout.trim()) {
    const result = {
      lines: [],
      mode: 'unrenderable' as const,
      originalContent,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, []),
    };
    return result;
  }

  // Fallback: diff failed or empty — determine from content
  if (modifiedContent !== undefined && modifiedContent !== '') {
    const lines = buildAddedDiffLines(modifiedContent);
    const result = {
      lines,
      mode: 'text' as const,
      originalContent,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, lines),
    };
    return result;
  }
  if (originalContent !== undefined) {
    const lines = buildDeletedDiffLines(originalContent);
    const result = {
      lines,
      mode: 'text' as const,
      originalContent,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, lines),
    };
    return result;
  }
  const fallbackMode: DiffResult['mode'] = diffFailed ? 'unrenderable' : 'text';
  const result = {
    lines: [],
    mode: fallbackMode,
    originalContent,
    modifiedContent,
  };
  return result;
}

/** Soft-reset the latest commit. Returns the commit message that was reset. */
export async function softResetLastCommit(
  taskPath: string
): Promise<{ subject: string; body: string }> {
  // Check if HEAD~1 exists (i.e., this isn't the initial commit)
  try {
    await execFileAsync('git', ['rev-parse', '--verify', 'HEAD~1'], { cwd: taskPath });
  } catch {
    throw new Error('Cannot undo the initial commit');
  }

  // Check if the commit has been pushed (safety guard — UI also hides the button)
  const { commits: log } = await getLog(taskPath, 1);
  if (log[0]?.isPushed) {
    throw new Error('Cannot undo a commit that has already been pushed');
  }

  const { stdout: subject } = await execFileAsync('git', ['log', '-1', '--pretty=format:%s'], {
    cwd: taskPath,
  });
  const { stdout: body } = await execFileAsync('git', ['log', '-1', '--pretty=format:%b'], {
    cwd: taskPath,
  });

  await execFileAsync('git', ['reset', '--soft', 'HEAD~1'], { cwd: taskPath });

  return { subject: subject.trim(), body: body.trim() };
}
