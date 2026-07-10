import { ExecError, type BoundExec } from '@emdash/core/exec';
import {
  toRangeString,
  toRefString,
  type DiffHunk,
  type DiffLine,
  type DiffTarget,
  type FileDiff,
  type GitChange,
} from '@emdash/core/git';
import { checkoutFailures } from '../errors';
import { parseNumstat } from './log';
import { mapGitChangeStatus } from './status';

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses `git diff` unified output for a single file into a FileDiff.
 * Expects output produced with `--no-color`; multi-file output is not supported.
 */
export function parseUnifiedFileDiff(output: string, filePath: string): FileDiff {
  const diff: FileDiff = {
    path: filePath,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  };

  let hunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of output.split('\n')) {
    if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
      diff.binary = true;
      continue;
    }
    if (line.startsWith('index ')) {
      const spec = line.slice('index '.length).split(' ')[0] ?? '';
      const [oldOid, newOid] = spec.split('..');
      if (oldOid && !/^0+$/.test(oldOid)) diff.oldOid = oldOid;
      if (newOid && !/^0+$/.test(newOid)) diff.newOid = newOid;
      continue;
    }

    const header = HUNK_HEADER_RE.exec(line);
    if (header) {
      const oldStart = Number.parseInt(header[1] ?? '0', 10);
      const oldLines = header[2] !== undefined ? Number.parseInt(header[2], 10) : 1;
      const newStart = Number.parseInt(header[3] ?? '0', 10);
      const newLines = header[4] !== undefined ? Number.parseInt(header[4], 10) : 1;
      hunk = { header: line, oldStart, oldLines, newStart, newLines, lines: [] };
      diff.hunks.push(hunk);
      oldLineNo = oldStart;
      newLineNo = newStart;
      continue;
    }

    if (!hunk) continue;

    const marker = line.charAt(0);
    const content = line.slice(1);
    let diffLine: DiffLine | null = null;
    switch (marker) {
      case '+':
        diffLine = { type: 'add', content, newLineNo };
        newLineNo += 1;
        diff.additions += 1;
        break;
      case '-':
        diffLine = { type: 'del', content, oldLineNo };
        oldLineNo += 1;
        diff.deletions += 1;
        break;
      case ' ':
        diffLine = { type: 'context', content, oldLineNo, newLineNo };
        oldLineNo += 1;
        newLineNo += 1;
        break;
      case '\\':
        diffLine = { type: 'no-newline', content: line };
        break;
      default:
        hunk = null;
        break;
    }
    if (diffLine) hunk?.lines.push(diffLine);
  }

  return diff;
}

export function resolveDiffTarget(base: DiffTarget): { cached: boolean; ref: string } {
  if ('base' in base) return { cached: false, ref: toRangeString(base) };
  if (base.kind === 'staged') return { cached: true, ref: '--cached' };
  if (base.kind === 'head') return { cached: false, ref: 'HEAD' };
  return { cached: false, ref: toRefString(base) };
}

export function extractHunkPatch(diffText: string, hunkHeader: string): string | null {
  const lines = diffText.split('\n');
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunkIndex === -1) return null;

  const headerLines = lines.slice(0, firstHunkIndex);
  let start = -1;
  for (let i = firstHunkIndex; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('@@') && (line === hunkHeader || line.startsWith(hunkHeader))) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('@@') || line.startsWith('diff --git')) {
      end = i;
      break;
    }
  }

  const patchLines = [...headerLines, ...lines.slice(start, end)];
  while (patchLines.length > 0 && patchLines[patchLines.length - 1] === '') {
    patchLines.pop();
  }
  return `${patchLines.join('\n')}\n`;
}

export async function getUntrackedFileDiff(
  exec: BoundExec,
  relativePath: string,
  displayPath = relativePath
): Promise<FileDiff | null> {
  let isTracked = true;
  try {
    await exec.exec(['ls-files', '--error-unmatch', '--', relativePath]);
  } catch (error) {
    if (!checkoutFailures.isUntrackedPath(error)) throw error;
    isTracked = false;
  }
  if (isTracked) return null;
  try {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    await exec.exec(['diff', '--no-color', '--no-index', '--', nullDevice, relativePath]);
    return null;
  } catch (error) {
    if (error instanceof ExecError && error.exitCode === 1) {
      return parseUnifiedFileDiff(error.stdout, displayPath);
    }
    throw error;
  }
}

export async function getChangedFiles(
  exec: BoundExec,
  base: DiffTarget,
  toAbsolutePath: (filePath: string) => string
): Promise<GitChange[]> {
  const resolved = resolveDiffTarget(base);
  const diffArgs = resolved.cached
    ? ['diff', '--numstat', '--cached']
    : ['diff', '--numstat', resolved.ref];
  const nameArgs = resolved.cached
    ? ['diff', '--name-status', '--cached']
    : ['diff', '--name-status', resolved.ref];

  let numstatResult: Awaited<ReturnType<BoundExec['exec']>>;
  let nameStatusResult: Awaited<ReturnType<BoundExec['exec']>>;
  try {
    [numstatResult, nameStatusResult] = await Promise.all([
      exec.exec(diffArgs),
      exec.exec(nameArgs),
    ]);
  } catch (error) {
    if ('kind' in base && base.kind === 'head' && checkoutFailures.isUnbornHead(error)) return [];
    throw error;
  }
  const numstat = parseNumstat(numstatResult.stdout);
  const changes: GitChange[] = [];

  for (const line of nameStatusResult.stdout.trim().split('\n').filter(Boolean)) {
    const [code = '', ...parts] = line.split('\t');
    const filePath = parts[parts.length - 1]?.trim();
    if (!filePath) continue;
    const stat = numstat.get(filePath);
    changes.push({
      path: toAbsolutePath(filePath),
      status: mapGitChangeStatus(code),
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
    });
  }

  return changes;
}
