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
import type { DiffLine, DiffResult } from '../utils/diffParser';

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_LINECOUNT_BYTES = 512 * 1024;

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

async function readFileTextCapped(filePath: string, maxBytes: number): Promise<string | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }

  if (!stat.isFile() || stat.size > maxBytes) {
    return null;
  }

  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export type GitChange = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  isStaged: boolean;
};

export async function getStatus(taskPath: string): Promise<GitChange[]> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: taskPath,
    });
  } catch {
    return [];
  }

  const { stdout: statusOutput } = await execFileAsync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    {
      cwd: taskPath,
    }
  );

  if (!statusOutput.trim()) return [];

  const statusLines = statusOutput
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  // Parse status lines into file entries
  const entries: Array<{
    filePath: string;
    status: string;
    statusCode: string;
    isStaged: boolean;
  }> = [];

  for (const line of statusLines) {
    const statusCode = line.substring(0, 2);
    let filePath = line.substring(3);
    if (statusCode.includes('R') && filePath.includes('->')) {
      const parts = filePath.split('->');
      filePath = parts[parts.length - 1].trim();
    }

    let status = 'modified';
    if (statusCode.includes('A') || statusCode.includes('?')) status = 'added';
    else if (statusCode.includes('D')) status = 'deleted';
    else if (statusCode.includes('R')) status = 'renamed';
    else if (statusCode.includes('M')) status = 'modified';

    const isStaged = statusCode[0] !== ' ' && statusCode[0] !== '?';
    entries.push({ filePath, status, statusCode, isStaged });
  }

  // Batch: run ONE staged numstat and ONE unstaged numstat for ALL files at once and parse the file
  // into a map of file paths to their additions and deletions
  // Map { filePath: { add: number, del: number } }
  // Resolve git's rename notation to the new (destination) file path.
  // Formats: "old.ts => new.ts" or "src/{Old => New}.tsx"
  const resolveRenamePath = (file: string): string => {
    if (!file.includes(' => ')) return file;
    // In-place rename with braces: "src/{Old => New}.tsx"
    if (file.includes('{')) {
      return file.replace(/\{[^}]+ => ([^}]+)\}/g, '$1').replace(/\/\//g, '/');
    }
    // Full rename: "old.ts => new.ts"
    return file.split(' => ').pop()!.trim();
  };

  const parseNumstatMap = (stdout: string): Map<string, { add: number; del: number }> => {
    const map = new Map<string, { add: number; del: number }>();
    if (!stdout || !stdout.trim()) return map;
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        const file = resolveRenamePath(parts.slice(2).join('\t'));
        const existing = map.get(file);
        if (existing) {
          existing.add += add;
          existing.del += del;
        } else {
          map.set(file, { add, del });
        }
      }
    }
    return map;
  };

  const [stagedResult, unstagedResult] = await Promise.all([
    execFileAsync('git', ['diff', '--numstat', '--cached'], { cwd: taskPath }).catch(() => ({
      stdout: '',
      stderr: '',
    })),
    execFileAsync('git', ['diff', '--numstat'], { cwd: taskPath }).catch(() => ({
      stdout: '',
      stderr: '',
    })),
  ]);

  const stagedMap = parseNumstatMap(stagedResult.stdout);
  const unstagedMap = parseNumstatMap(unstagedResult.stdout);

  // Count lines for untracked files in parallel
  const untrackedEntries = entries.filter(
    (e) => e.statusCode.includes('?') && !stagedMap.has(e.filePath) && !unstagedMap.has(e.filePath)
  );
  const untrackedCounts = await Promise.all(
    untrackedEntries.map((e) =>
      countFileNewlinesCapped(path.join(taskPath, e.filePath), MAX_UNTRACKED_LINECOUNT_BYTES)
    )
  );
  const untrackedMap = new Map<string, number>();
  untrackedEntries.forEach((e, i) => {
    if (typeof untrackedCounts[i] === 'number') {
      untrackedMap.set(e.filePath, untrackedCounts[i]!);
    }
  });

  // Assemble results
  const changes: GitChange[] = entries.map((e) => {
    const staged = stagedMap.get(e.filePath);
    const unstaged = unstagedMap.get(e.filePath);
    let additions = (staged?.add ?? 0) + (unstaged?.add ?? 0);
    const deletions = (staged?.del ?? 0) + (unstaged?.del ?? 0);

    if (additions === 0 && deletions === 0 && untrackedMap.has(e.filePath)) {
      additions = untrackedMap.get(e.filePath)!;
    }

    return {
      path: e.filePath,
      status: e.status,
      additions,
      deletions,
      isStaged: e.isStaged,
    };
  });

  return changes;
}

export async function stageFile(taskPath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['add', '--', filePath], { cwd: taskPath });
}

export async function stageAllFiles(taskPath: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: taskPath });
}

export async function unstageFile(taskPath: string, filePath: string): Promise<void> {
  try {
    await execFileAsync('git', ['reset', 'HEAD', '--', filePath], { cwd: taskPath });
  } catch {
    // HEAD may not exist (no commits yet) — use rm --cached instead
    await execFileAsync('git', ['rm', '--cached', '--', filePath], { cwd: taskPath });
  }
}

export async function revertFile(
  taskPath: string,
  filePath: string
): Promise<{ action: 'unstaged' | 'reverted' }> {
  // Validate filePath doesn't escape the worktree
  const absPath = path.resolve(taskPath, filePath);
  const resolvedTaskPath = path.resolve(taskPath);
  if (!absPath.startsWith(resolvedTaskPath + path.sep) && absPath !== resolvedTaskPath) {
    throw new Error('File path is outside the worktree');
  }

  // Check if file is tracked in git (exists in HEAD)
  let fileExistsInHead = false;
  try {
    await execFileAsync('git', ['cat-file', '-e', `HEAD:${filePath}`], { cwd: taskPath });
    fileExistsInHead = true;
  } catch {
    // File doesn't exist in HEAD (it's a new/untracked file), delete it
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
    return { action: 'reverted' };
  }

  // File exists in HEAD, revert it
  if (fileExistsInHead) {
    try {
      await execFileAsync('git', ['checkout', 'HEAD', '--', filePath], { cwd: taskPath });
    } catch (error) {
      // If checkout fails, don't delete the file - throw the error instead
      throw new Error(
        `Failed to revert file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { action: 'reverted' };
}

export async function getFileDiff(taskPath: string, filePath: string): Promise<DiffResult> {
  const absPath = path.resolve(taskPath, filePath);
  const resolvedTaskPath = path.resolve(taskPath);
  if (!absPath.startsWith(resolvedTaskPath + path.sep) && absPath !== resolvedTaskPath) {
    throw new Error('File path is outside the worktree');
  }

  // Helper: fetch content at HEAD with size guard
  const getOriginalContent = async (): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${filePath}`], {
        cwd: taskPath,
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return undefined;
    }
  };

  // Helper: read current file from disk with size guard
  const getModifiedContent = async (): Promise<string | undefined> => {
    const content = await readFileTextCapped(path.join(taskPath, filePath), MAX_DIFF_CONTENT_BYTES);
    return content !== null ? stripTrailingNewline(content) : undefined;
  };

  // Step 1: Run git diff
  let diffStdout: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath],
      { cwd: taskPath, maxBuffer: MAX_DIFF_OUTPUT_BYTES }
    );
    diffStdout = stdout;
  } catch {
    // git diff failed (no HEAD, untracked file, etc.) — fall through to content-only path
  }

  // Step 2: Parse diff and check binary
  if (diffStdout !== undefined) {
    const { lines, isBinary } = parseDiffLines(diffStdout);

    if (isBinary) {
      return { lines: [], isBinary: true };
    }

    // Step 3: Fetch content (only for non-binary)
    const [originalContent, modifiedContent] = await Promise.all([
      getOriginalContent(),
      getModifiedContent(),
    ]);

    // Step 4: Handle empty diff (untracked or deleted file that git reports as empty diff)
    if (lines.length === 0) {
      if (modifiedContent !== undefined) {
        return {
          lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
          modifiedContent,
        };
      }
      if (originalContent !== undefined) {
        return {
          lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
          originalContent,
        };
      }
      return { lines: [] };
    }

    return { lines, originalContent, modifiedContent };
  }

  // Fallback: git diff failed — try content-only approach
  const [originalContent, modifiedContent] = await Promise.all([
    getOriginalContent(),
    getModifiedContent(),
  ]);

  if (modifiedContent !== undefined) {
    return {
      lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
      originalContent,
      modifiedContent,
    };
  }
  if (originalContent !== undefined) {
    return {
      lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
      originalContent,
    };
  }
  return { lines: [] };
}

/** Commit staged files (no push). Returns the commit hash. */
export async function commit(taskPath: string, message: string): Promise<{ hash: string }> {
  if (!message || !message.trim()) {
    throw new Error('Commit message cannot be empty');
  }
  await execFileAsync('git', ['commit', '-m', message], { cwd: taskPath });
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
  const format = `${RECORD_SEP}%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%b`;
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
        body: (parts[5] || '').trim(),
        author: parts[2] || '',
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
  filePath: string
): Promise<DiffResult> {
  const absPath = path.resolve(taskPath, filePath);
  const resolvedTaskPath = path.resolve(taskPath);
  if (!absPath.startsWith(resolvedTaskPath + path.sep) && absPath !== resolvedTaskPath) {
    throw new Error('File path is outside the worktree');
  }

  // Helper: fetch content at a given ref with size guard
  const getContentAt = async (ref: string): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync('git', ['show', `${ref}:${filePath}`], {
        cwd: taskPath,
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return undefined;
    }
  };

  // Check if this is a root commit (no parent)
  let hasParent = true;
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `${commitHash}~1`], { cwd: taskPath });
  } catch {
    hasParent = false;
  }

  if (!hasParent) {
    const modifiedContent = await getContentAt(commitHash);
    if (modifiedContent === undefined) {
      return { lines: [] };
    }
    if (modifiedContent === '') {
      return { lines: [], modifiedContent };
    }
    return {
      lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
      modifiedContent,
    };
  }

  // Run diff
  let diffStdout: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', filePath],
      { cwd: taskPath, maxBuffer: MAX_DIFF_OUTPUT_BYTES }
    );
    diffStdout = stdout;
  } catch {
    // diff too large or git error — fall through to content-only path
  }

  let diffLines: DiffLine[] = [];
  if (diffStdout !== undefined) {
    const { lines, isBinary } = parseDiffLines(diffStdout);
    if (isBinary) {
      return { lines: [], isBinary: true };
    }
    diffLines = lines;
  }

  // Fetch content AFTER binary check to avoid fetching binary blobs
  const [originalContent, modifiedContent] = await Promise.all([
    getContentAt(`${commitHash}~1`),
    getContentAt(commitHash),
  ]);

  if (diffLines.length > 0) return { lines: diffLines, originalContent, modifiedContent };

  // Fallback: diff failed or empty — determine from content
  if (modifiedContent !== undefined && modifiedContent !== '') {
    return {
      lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
      originalContent,
      modifiedContent,
    };
  }
  if (originalContent !== undefined) {
    return {
      lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
      originalContent,
      modifiedContent,
    };
  }
  return { lines: [], originalContent, modifiedContent };
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
