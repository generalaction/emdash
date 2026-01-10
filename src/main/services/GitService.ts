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

export async function stageFile(taskPath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['add', '--', filePath], { cwd: taskPath });
}

export async function revertFile(
  taskPath: string,
  filePath: string
): Promise<{ action: 'unstaged' | 'reverted' }> {
  // Check if file is staged
  try {
    const { stdout: stagedStatus } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only', '--', filePath],
      {
        cwd: taskPath,
      }
    );

    if (stagedStatus.trim()) {
      // File is staged, unstage it (but keep working directory changes)
      await execFileAsync('git', ['reset', 'HEAD', '--', filePath], { cwd: taskPath });
      return { action: 'unstaged' };
    }
  } catch {}

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
        if (fs.existsSync(abs)) {
          const content = fs.readFileSync(abs, 'utf8');
          return { lines: content.split('\n').map((l) => ({ right: l, type: 'add' as const })) };
        } else {
          const { stdout: prev } = await execFileAsync('git', ['show', `HEAD:${filePath}`], {
            cwd: taskPath,
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
      const abs = path.join(taskPath, filePath);
      const content = fs.readFileSync(abs, 'utf8');
      const lines = content.split('\n');
      return { lines: lines.map((l) => ({ right: l, type: 'add' as const })) };
    } catch {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath],
          { cwd: taskPath }
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
}
