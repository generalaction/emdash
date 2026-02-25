import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_LINECOUNT_BYTES = 512 * 1024;
const MAX_UNTRACKED_DIFF_BYTES = 512 * 1024;

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

  const changes: GitChange[] = [];
  const statusLines = statusOutput
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

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

    // Check if file is staged (first character of status code indicates staged changes)
    const isStaged = statusCode[0] !== ' ' && statusCode[0] !== '?';
    let additions = 0;
    let deletions = 0;

    const sumNumstat = (stdout: string) => {
      const lines = stdout
        .trim()
        .split('\n')
        .filter((l) => l.trim().length > 0);
      for (const l of lines) {
        const p = l.split('\t');
        if (p.length >= 2) {
          const addStr = p[0];
          const delStr = p[1];
          const a = addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
          const d = delStr === '-' ? 0 : parseInt(delStr, 10) || 0;
          additions += a;
          deletions += d;
        }
      }
    };

    try {
      const staged = await execFileAsync('git', ['diff', '--numstat', '--cached', '--', filePath], {
        cwd: taskPath,
      });
      if (staged.stdout && staged.stdout.trim()) sumNumstat(staged.stdout);
    } catch {}

    try {
      const unstaged = await execFileAsync('git', ['diff', '--numstat', '--', filePath], {
        cwd: taskPath,
      });
      if (unstaged.stdout && unstaged.stdout.trim()) sumNumstat(unstaged.stdout);
    } catch {}

    if (additions === 0 && deletions === 0 && statusCode.includes('?')) {
      const absPath = path.join(taskPath, filePath);
      const count = await countFileNewlinesCapped(absPath, MAX_UNTRACKED_LINECOUNT_BYTES);
      if (typeof count === 'number') {
        additions = count;
      }
    }

    changes.push({ path: filePath, status, additions, deletions, isStaged });
  }

  return changes;
}

export async function stageFile(taskPath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['add', '--', filePath], { cwd: taskPath });
}

export async function stageAllFiles(taskPath: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: taskPath });
}

export async function unstageFile(taskPath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['reset', 'HEAD', '--', filePath], { cwd: taskPath });
}

export async function revertFile(
  taskPath: string,
  filePath: string
): Promise<{ action: 'unstaged' | 'reverted' }> {
  // Check if file is tracked in git (exists in HEAD)
  let fileExistsInHead = false;
  try {
    await execFileAsync('git', ['cat-file', '-e', `HEAD:${filePath}`], { cwd: taskPath });
    fileExistsInHead = true;
  } catch {
    // File doesn't exist in HEAD (it's a new/untracked file), delete it
    const absPath = path.join(taskPath, filePath);
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

export async function getFileDiff(
  taskPath: string,
  filePath: string
): Promise<{ lines: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> }> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath],
      { cwd: taskPath }
    );

    const linesRaw = stdout.split('\n');
    const result: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> = [];
    for (const line of linesRaw) {
      if (!line) continue;
      if (
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('@@')
      )
        continue;
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === ' ') result.push({ left: content, right: content, type: 'context' });
      else if (prefix === '-') result.push({ left: content, type: 'del' });
      else if (prefix === '+') result.push({ right: content, type: 'add' });
      else result.push({ left: line, right: line, type: 'context' });
    }

    if (result.length === 0) {
      try {
        const abs = path.join(taskPath, filePath);
        const content = await readFileTextCapped(abs, MAX_UNTRACKED_DIFF_BYTES);
        if (content !== null) {
          return { lines: content.split('\n').map((l) => ({ right: l, type: 'add' as const })) };
        }
        const { stdout: prev } = await execFileAsync('git', ['show', `HEAD:${filePath}`], {
          cwd: taskPath,
        });
        return { lines: prev.split('\n').map((l) => ({ left: l, type: 'del' as const })) };
      } catch {
        return { lines: [] };
      }
    }

    return { lines: result };
  } catch {
    const abs = path.join(taskPath, filePath);
    const content = await readFileTextCapped(abs, MAX_UNTRACKED_DIFF_BYTES);
    if (content !== null) {
      const lines = content.split('\n');
      return { lines: lines.map((l) => ({ right: l, type: 'add' as const })) };
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath],
        { cwd: taskPath }
      );
      const linesRaw = stdout.split('\n');
      const result: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> = [];
      for (const line of linesRaw) {
        if (!line) continue;
        if (
          line.startsWith('diff ') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('@@')
        )
          continue;
        const prefix = line[0];
        const content = line.slice(1);
        if (prefix === ' ') result.push({ left: content, right: content, type: 'context' });
        else if (prefix === '-') result.push({ left: content, type: 'del' });
        else if (prefix === '+') result.push({ right: content, type: 'add' });
        else result.push({ left: line, right: line, type: 'context' });
      }
      if (result.length === 0) {
        try {
          const { stdout: prev } = await execFileAsync('git', ['show', `HEAD:${filePath}`], {
            cwd: taskPath,
          });
          return { lines: prev.split('\n').map((l) => ({ left: l, type: 'del' as const })) };
        } catch {
          return { lines: [] };
        }
      }
      return { lines: result };
    } catch {
      return { lines: [] };
    }
  }
}

/** Commit staged files (no push). Returns the commit hash. */
export async function commit(taskPath: string, message: string): Promise<{ hash: string }> {
  await execFileAsync('git', ['commit', '-m', message], { cwd: taskPath });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: taskPath });
  return { hash: stdout.trim() };
}

/** Push current branch to origin. Sets upstream if needed. */
export async function push(taskPath: string): Promise<{ output: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['push'], { cwd: taskPath });
    return { output: stdout.trim() };
  } catch {
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
}

/** Get commit log for the current branch. */
export async function getLog(
  taskPath: string,
  maxCount: number = 50
): Promise<
  Array<{
    hash: string;
    subject: string;
    body: string;
    author: string;
    date: string;
    isPushed: boolean;
  }>
> {
  // Get ahead count to determine which commits are unpushed
  let aheadCount = 0;
  try {
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
    try {
      const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: taskPath,
      });
      aheadCount = parseInt(countOut.trim(), 10) || 0;
    } catch {
      aheadCount = 0;
    }
  }

  const SEP = '---COMMIT_SEP---';
  const format = `%H${SEP}%s${SEP}%b${SEP}%an${SEP}%aI`;
  const { stdout } = await execFileAsync(
    'git',
    ['log', `--max-count=${maxCount}`, `--pretty=format:${format}`, '--'],
    { cwd: taskPath }
  );

  if (!stdout.trim()) return [];

  const commits = stdout.split('\n').map((line, index) => {
    const parts = line.split(SEP);
    return {
      hash: parts[0] || '',
      subject: parts[1] || '',
      body: (parts[2] || '').trim(),
      author: parts[3] || '',
      date: parts[4] || '',
      isPushed: index >= aheadCount,
    };
  });

  return commits;
}

/** Get the latest commit info (subject + body). */
export async function getLatestCommit(
  taskPath: string
): Promise<{ hash: string; subject: string; body: string; isPushed: boolean } | null> {
  const log = await getLog(taskPath, 1);
  return log[0] || null;
}

/** Get files changed in a specific commit. */
export async function getCommitFiles(
  taskPath: string,
  commitHash: string
): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
  const { stdout } = await execFileAsync(
    'git',
    ['diff-tree', '--no-commit-id', '-r', '--numstat', commitHash],
    { cwd: taskPath }
  );

  const { stdout: nameStatus } = await execFileAsync(
    'git',
    ['diff-tree', '--no-commit-id', '-r', '--name-status', commitHash],
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
): Promise<{ lines: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> }> {
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', filePath],
    { cwd: taskPath }
  );

  const linesRaw = stdout.split('\n');
  const result: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> = [];
  for (const line of linesRaw) {
    if (!line) continue;
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@')
    )
      continue;
    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === ' ') result.push({ left: content, right: content, type: 'context' });
    else if (prefix === '-') result.push({ left: content, type: 'del' });
    else if (prefix === '+') result.push({ right: content, type: 'add' });
    else result.push({ left: line, right: line, type: 'context' });
  }

  return { lines: result };
}

/** Soft-reset the latest commit. Returns the commit message that was reset. */
export async function softResetLastCommit(
  taskPath: string
): Promise<{ subject: string; body: string }> {
  const { stdout: subject } = await execFileAsync('git', ['log', '-1', '--pretty=format:%s'], {
    cwd: taskPath,
  });
  const { stdout: body } = await execFileAsync('git', ['log', '-1', '--pretty=format:%b'], {
    cwd: taskPath,
  });

  await execFileAsync('git', ['reset', '--soft', 'HEAD~1'], { cwd: taskPath });

  return { subject: subject.trim(), body: body.trim() };
}
