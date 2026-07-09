import fs from 'node:fs/promises';
import path from 'node:path';
import type { BoundExec } from '../../../exec';
import { gitErrorMessage } from '../../errors';
import type {
  CheckoutOperation,
  CheckoutStatusModel,
  FileGitStatus,
  GitStatusCode,
} from '../models/status';
import type { GitChangeStatus } from '../schemas';

export const MAX_STATUS_FILES = 10_000;

export class TooManyFilesChangedError extends Error {
  override readonly name = 'TooManyFilesChangedError';

  constructor() {
    super('Too many changed files');
  }
}

export type FileStatus = {
  x: string;
  y: string;
  rename?: string;
  path: string;
  headOid?: string;
  indexOid?: string;
};

export class StatusParser {
  private lastRaw = '';
  private result: FileStatus[] = [];
  tooManyFiles = false;

  get status(): FileStatus[] {
    return this.result;
  }

  update(chunk: string): void {
    let raw = this.lastRaw + chunk;
    let index = 0;
    let nextIndex: number | undefined;

    while ((nextIndex = this.parseEntry(raw, index)) !== undefined) {
      index = nextIndex;
      if (this.result.length > MAX_STATUS_FILES) {
        this.tooManyFiles = true;
        raw = '';
        index = 0;
        break;
      }
    }

    this.lastRaw = raw.slice(index);
  }

  reset(): void {
    this.lastRaw = '';
    this.result = [];
    this.tooManyFiles = false;
  }

  private parseEntry(raw: string, index: number): number | undefined {
    if (index >= raw.length) return undefined;

    const kind = raw.charAt(index);
    switch (kind) {
      case '1':
        return this.parseOrdinary(raw, index);
      case '2':
        return this.parseRename(raw, index);
      case '?':
        return this.parseUntracked(raw, index);
      case 'u':
        return this.parseUnmerged(raw, index);
      case '!':
        return this.skipSimple(raw, index);
      default:
        return undefined;
    }
  }

  private parseOrdinary(raw: string, index: number): number | undefined {
    const parsed = readNullTerminated(raw, index);
    if (!parsed) return undefined;
    const parts = splitPrefix(parsed.value, 8);
    if (!parts) return parsed.nextIndex;
    const [_, xy, _sub, _mH, _mI, _mW, headOid, indexOid, filePath] = parts;
    this.push({
      ...parseXY(xy),
      path: filePath,
      headOid,
      indexOid,
    });
    return parsed.nextIndex;
  }

  private parseRename(raw: string, index: number): number | undefined {
    const first = readNullTerminated(raw, index);
    if (!first) return undefined;
    const second = readNullTerminated(raw, first.nextIndex);
    if (!second) return undefined;
    const parts = splitPrefix(first.value, 9);
    if (!parts) return second.nextIndex;
    const [_, xy, _sub, _mH, _mI, _mW, headOid, indexOid, _score, filePath] = parts;
    this.push({
      ...parseXY(xy),
      rename: filePath,
      path: second.value,
      headOid,
      indexOid,
    });
    return second.nextIndex;
  }

  private parseUntracked(raw: string, index: number): number | undefined {
    const parsed = readNullTerminated(raw, index);
    if (!parsed) return undefined;
    const filePath = parsed.value.startsWith('? ') ? parsed.value.slice(2) : parsed.value;
    this.push({ x: '?', y: '?', path: filePath });
    return parsed.nextIndex;
  }

  private parseUnmerged(raw: string, index: number): number | undefined {
    const parsed = readNullTerminated(raw, index);
    if (!parsed) return undefined;
    const parts = splitPrefix(parsed.value, 10);
    if (!parts) return parsed.nextIndex;
    const [_, xy, _sub, _m1, _m2, _m3, _mW, _h1, _h2, _h3, filePath] = parts;
    this.push({ ...parseXY(xy), path: filePath });
    return parsed.nextIndex;
  }

  private skipSimple(raw: string, index: number): number | undefined {
    return readNullTerminated(raw, index)?.nextIndex;
  }

  private push(status: FileStatus): void {
    const filePath = status.rename ?? status.path;
    if (filePath.length > 0 && filePath[filePath.length - 1] !== '/') {
      this.result.push(status);
    }
  }
}

/**
 * Computes the checkout status model from `git status --porcelain=v2`.
 * Total: expected failures are encoded as the model's `error` variant so
 * subscribers always see the latest truth.
 *
 * Git reports checkout-relative paths; the model exposes absolute paths
 * (joined onto `checkoutPath`) per the repo-wide path convention.
 */
export async function computeStatusModel(
  exec: BoundExec,
  gitDir: string,
  checkoutPath: string
): Promise<CheckoutStatusModel> {
  try {
    const parser = new StatusParser();
    await exec.execStreaming(
      ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '-uall'],
      (chunk) => {
        parser.update(chunk);
        return !parser.tooManyFiles;
      }
    );
    if (parser.tooManyFiles || parser.status.length > MAX_STATUS_FILES) {
      return { kind: 'too-many-files' };
    }
    const operation = await detectOperation(gitDir);
    return buildStatusModel(parser.status, operation, checkoutPath);
  } catch (error) {
    return { kind: 'error', message: gitErrorMessage(error) };
  }
}

export function buildStatusModel(
  entries: FileStatus[],
  operation: CheckoutOperation,
  checkoutPath: string
): CheckoutStatusModel {
  const record: Record<string, FileGitStatus> = {};
  const summary = { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 };

  for (const entry of entries) {
    // For renames the parser puts the new path in `rename` and the original in `path`.
    const currentPath = path.join(checkoutPath, entry.rename ?? entry.path);
    const isConflicted = isConflictCode(entry.x, entry.y);
    const fileStatus: FileGitStatus = {
      path: currentPath,
      index: codeToStatus(entry.x),
      worktree: codeToStatus(entry.y),
      isConflicted,
    };
    if (entry.rename) fileStatus.origPath = path.join(checkoutPath, entry.path);
    record[currentPath] = fileStatus;

    if (isConflicted) {
      summary.conflicted += 1;
      continue;
    }
    if (entry.x === '?') {
      summary.untracked += 1;
      continue;
    }
    if (entry.x !== ' ' && entry.x !== '!') summary.staged += 1;
    if (entry.y !== ' ' && entry.y !== '?' && entry.y !== '!') summary.unstaged += 1;
  }

  return { kind: 'ok', entries: record, summary, operation };
}

/** In-progress operation detection via the worktree git dir's state files. */
export async function detectOperation(gitDir: string): Promise<CheckoutOperation> {
  if (
    (await exists(path.join(gitDir, 'rebase-merge'))) ||
    (await exists(path.join(gitDir, 'rebase-apply')))
  ) {
    return 'rebase';
  }
  if (await exists(path.join(gitDir, 'MERGE_HEAD'))) return 'merge';
  if (await exists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (await exists(path.join(gitDir, 'REVERT_HEAD'))) return 'revert';
  if (await exists(path.join(gitDir, 'BISECT_LOG'))) return 'bisect';
  return 'none';
}

export function mapGitChangeStatus(code: string): GitChangeStatus {
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('A') || code.includes('?')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

function readNullTerminated(
  raw: string,
  index: number
): { value: string; nextIndex: number } | undefined {
  const end = raw.indexOf('\0', index);
  if (end === -1) return undefined;
  return { value: raw.substring(index, end), nextIndex: end + 1 };
}

function splitPrefix(value: string, fieldCount: number): string[] | undefined {
  const fields: string[] = [];
  let index = 0;
  for (let i = 0; i < fieldCount; i++) {
    const nextSpace = value.indexOf(' ', index);
    if (nextSpace === -1) return undefined;
    fields.push(value.slice(index, nextSpace));
    index = nextSpace + 1;
  }
  fields.push(value.slice(index));
  return fields;
}

function parseXY(xy: string): { x: string; y: string } {
  return {
    x: normalizeStatusChar(xy.charAt(0)),
    y: normalizeStatusChar(xy.charAt(1)),
  };
}

function normalizeStatusChar(value: string): string {
  return value === '.' ? ' ' : value;
}

function codeToStatus(code: string): GitStatusCode {
  switch (code) {
    case 'M':
    case 'm':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    case '?':
      return 'untracked';
    case '!':
      return 'ignored';
    default:
      return 'unmodified';
  }
}

function isConflictCode(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
