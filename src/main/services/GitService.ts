import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export type GitChange = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  isStaged: boolean;
};

export type GitCommit = {
  sha: string;
  shortSha: string;
  summary: string;
  relativeDate?: string;
  date?: string;
  authorName?: string;
};

export async function getStatus(workspacePath: string): Promise<GitChange[]> {
  // Return empty if not a git repo
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: workspacePath,
    });
  } catch {
    return [];
  }

  const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: workspacePath,
  });

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

    if (filePath.endsWith('codex-stream.log')) continue;

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
        cwd: workspacePath,
      });
      if (staged.stdout && staged.stdout.trim()) sumNumstat(staged.stdout);
    } catch {}

    try {
      const unstaged = await execFileAsync('git', ['diff', '--numstat', '--', filePath], {
        cwd: workspacePath,
      });
      if (unstaged.stdout && unstaged.stdout.trim()) sumNumstat(unstaged.stdout);
    } catch {}

    if (additions === 0 && deletions === 0 && statusCode.includes('?')) {
      const absPath = path.join(workspacePath, filePath);
      try {
        const stat = fs.existsSync(absPath) ? fs.statSync(absPath) : undefined;
        if (stat && stat.isFile()) {
          const buf = fs.readFileSync(absPath);
          let count = 0;
          for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) count++;
          additions = count;
        }
      } catch {}
    }

    changes.push({ path: filePath, status, additions, deletions, isStaged });
  }

  return changes;
}

export async function stageFile(workspacePath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['add', '--', filePath], { cwd: workspacePath });
}

export async function revertFile(
  workspacePath: string,
  filePath: string
): Promise<{ action: 'unstaged' | 'reverted' }> {
  // Check if file is staged
  try {
    const { stdout: stagedStatus } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only', '--', filePath],
      {
        cwd: workspacePath,
      }
    );

    if (stagedStatus.trim()) {
      // File is staged, unstage it (but keep working directory changes)
      await execFileAsync('git', ['reset', 'HEAD', '--', filePath], { cwd: workspacePath });
      return { action: 'unstaged' };
    }
  } catch {
    // Ignore errors, continue with checkout
  }

  // File is not staged, revert working directory changes
  await execFileAsync('git', ['checkout', 'HEAD', '--', filePath], { cwd: workspacePath });
  return { action: 'reverted' };
}

export async function getFileDiff(
  workspacePath: string,
  filePath: string
): Promise<{ lines: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> }> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath],
      { cwd: workspacePath }
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
        const abs = path.join(workspacePath, filePath);
        if (fs.existsSync(abs)) {
          const content = fs.readFileSync(abs, 'utf8');
          return { lines: content.split('\n').map((l) => ({ right: l, type: 'add' as const })) };
        } else {
          const { stdout: prev } = await execFileAsync('git', ['show', `HEAD:${filePath}`], {
            cwd: workspacePath,
          });
          return { lines: prev.split('\n').map((l) => ({ left: l, type: 'del' as const })) };
        }
      } catch {
        return { lines: [] };
      }
    }

    return { lines: result };
  } catch {
    try {
      const abs = path.join(workspacePath, filePath);
      const content = fs.readFileSync(abs, 'utf8');
      const lines = content.split('\n');
      return { lines: lines.map((l) => ({ right: l, type: 'add' as const })) };
    } catch {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath],
          { cwd: workspacePath }
        );
        const linesRaw = stdout.split('\n');
        const result: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> =
          [];
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
              cwd: workspacePath,
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
}

export async function getCommitHistory(
  workspacePath: string,
  limit = 20
): Promise<{ branch: string; commits: GitCommit[] }> {
  // Ensure repo exists
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: workspacePath,
    });
  } catch {
    return { branch: '', commits: [] };
  }

  let branch = '';
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspacePath,
    });
    branch = (stdout || '').trim();
  } catch {
    branch = '';
  }

  // Resolve default branch for comparison (prefer remote default)
  let defaultBranch = 'main';
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'],
      { cwd: workspacePath }
    );
    const db = (stdout || '').trim();
    if (db) defaultBranch = db;
  } catch {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'show', 'origin'], {
        cwd: workspacePath,
      });
      const line =
        (stdout || '')
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.toLowerCase().startsWith('head branch')) || '';
      const parts = line.split(':');
      const branchName = parts[1]?.trim();
      if (branchName) defaultBranch = branchName;
    } catch {
      // keep fallback main
    }
  }

  // Determine comparison ref: prefer tracking upstream, then origin/default, then local default
  let baseRef: string | null = null;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      { cwd: workspacePath }
    );
    const upstream = (stdout || '').trim();
    if (upstream && upstream !== 'HEAD') baseRef = upstream;
  } catch {
    baseRef = null;
  }

  const remoteDefault = `origin/${defaultBranch}`;
  const hasRef = async (ref: string) => {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', ref], { cwd: workspacePath });
      return true;
    } catch {
      return false;
    }
  };

  if (!baseRef && (await hasRef(remoteDefault))) {
    baseRef = remoteDefault;
  }
  if (
    !baseRef &&
    branch &&
    defaultBranch &&
    branch !== defaultBranch &&
    (await hasRef(defaultBranch))
  ) {
    baseRef = defaultBranch;
  }

  if (!baseRef) {
    return { branch, commits: [] };
  }

  let compareRange = `${baseRef}..HEAD`;
  if (baseRef === branch) {
    // If somehow the resolved ref equals the current branch, don't log anything
    return { branch, commits: [] };
  }

  // If merge-base exists, prefer it to avoid duplicate commits when branch diverged
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', baseRef], {
      cwd: workspacePath,
    });
    const mb = (stdout || '').trim();
    if (mb) compareRange = `${mb}..HEAD`;
  } catch {
    // ignore, keep default range
  }
  const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? Number(limit) : 20, 1), 50);
  const format = '%H%x1f%h%x1f%s%x1f%cr%x1f%ci%x1f%an%x1e';
  try {
    const args = ['log', compareRange];
    args.push('-n', String(safeLimit), `--pretty=format:${format}`);
    const { stdout } = await execFileAsync('git', args, { cwd: workspacePath });

    const commits: GitCommit[] = (stdout || '')
      .split('\x1e')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [sha, shortSha, summary, relativeDate, date, authorName] = entry.split('\x1f');
        return {
          sha,
          shortSha,
          summary: summary || '',
          relativeDate,
          date,
          authorName,
        };
      });

    return { branch, commits };
  } catch {
    return { branch, commits: [] };
  }
}

export async function getCommitDetails(workspacePath: string, commitSha: string): Promise<string> {
  const sha = (commitSha || '').trim();
  if (!sha) throw new Error('Commit SHA is required');
  await execFileAsync('git', ['rev-parse', '--verify', sha], { cwd: workspacePath });
  const { stdout } = await execFileAsync(
    'git',
    ['show', '--stat', '--pretty=fuller', '--color=never', sha],
    { cwd: workspacePath }
  );
  return stdout || '';
}

export async function revertCommit(workspacePath: string, commitSha: string): Promise<void> {
  const sha = (commitSha || '').trim();
  if (!sha) throw new Error('Commit SHA is required');
  await execFileAsync('git', ['rev-parse', '--verify', sha], { cwd: workspacePath });
  await execFileAsync('git', ['revert', '--no-edit', sha], { cwd: workspacePath });
}
