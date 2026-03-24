import type { GitFileStatus } from '../../shared/git/types';

export interface ParsedGitStatusEntry {
  path: string;
  oldPath?: string;
  statusCode: string;
  status: GitFileStatus;
  isStaged: boolean;
}

export interface ParsedNumstat {
  additions: number | null;
  deletions: number | null;
}

function normalizeStatusCode(statusCode: string): string {
  return statusCode.padEnd(2, '.').slice(0, 2);
}

function mapStatusCodeToStatus(
  statusCode: string,
  rawEntryType?: '1' | '2' | 'u' | '?'
): GitFileStatus {
  if (rawEntryType === '?' || statusCode === '??') return 'added';

  const [indexStatus, worktreeStatus] = normalizeStatusCode(statusCode);

  if (
    rawEntryType === '2' ||
    indexStatus === 'R' ||
    worktreeStatus === 'R' ||
    indexStatus === 'C' ||
    worktreeStatus === 'C'
  ) {
    return 'renamed';
  }

  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added';

  return 'modified';
}

function isStagedFromStatusCode(statusCode: string): boolean {
  const normalized = normalizeStatusCode(statusCode);
  const indexStatus = normalized[0];
  return indexStatus !== '.' && indexStatus !== ' ' && indexStatus !== '?';
}

function parsePorcelainV1Line(line: string): ParsedGitStatusEntry | null {
  if (line.length < 3) return null;

  const statusCode = line.slice(0, 2);
  if (statusCode === '##' || statusCode === '!!') {
    // Branch metadata and ignored-path lines are not file changes.
    return null;
  }
  let filePath = line.slice(3);
  let oldPath: string | undefined;

  if ((statusCode.includes('R') || statusCode.includes('C')) && filePath.includes(' -> ')) {
    const parts = filePath.split(' -> ');
    if (parts.length >= 2) {
      oldPath = parts[0].trim();
      filePath = parts[parts.length - 1].trim();
    }
  }

  return {
    path: filePath,
    statusCode,
    status: mapStatusCodeToStatus(statusCode),
    isStaged: isStagedFromStatusCode(statusCode),
    ...(oldPath ? { oldPath } : {}),
  };
}

/**
 * Parse `git status --porcelain=v2 -z` output.
 *
 * For fallback support, if the payload does not look like porcelain v2 records
 * this parser falls back to porcelain v1 line parsing.
 */
export function parseGitStatusOutput(output: string): ParsedGitStatusEntry[] {
  const tokens = output.split('\0').filter((token) => token.length > 0);
  const entries: ParsedGitStatusEntry[] = [];

  const looksLikePorcelainV2 = tokens.some((token) => /^(?:1|2|u|\?|!|#)\s/.test(token));

  if (!looksLikePorcelainV2) {
    return output
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0)
      .map(parsePorcelainV1Line)
      .filter((entry): entry is ParsedGitStatusEntry => entry !== null);
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const entryType = token[0];

    if (entryType === '#' || entryType === '!') {
      continue;
    }

    if (entryType === '?') {
      const path = token.slice(2);
      entries.push({
        path,
        statusCode: '??',
        status: 'added',
        isStaged: false,
      });
      continue;
    }

    if (entryType === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const fields = token.split(' ');
      if (fields.length < 9) continue;
      const statusCode = fields[1];
      const path = fields.slice(8).join(' ');
      entries.push({
        path,
        statusCode,
        status: mapStatusCodeToStatus(statusCode, '1'),
        isStaged: isStagedFromStatusCode(statusCode),
      });
      continue;
    }

    if (entryType === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
      const fields = token.split(' ');
      if (fields.length < 10) continue;
      const statusCode = fields[1];
      const path = fields.slice(9).join(' ');
      const oldPath = tokens[i + 1];
      if (oldPath !== undefined) i += 1;
      entries.push({
        path,
        oldPath,
        statusCode,
        status: mapStatusCodeToStatus(statusCode, '2'),
        isStaged: isStagedFromStatusCode(statusCode),
      });
      continue;
    }

    if (entryType === 'u') {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const fields = token.split(' ');
      if (fields.length < 11) continue;
      const statusCode = fields[1];
      const path = fields.slice(10).join(' ');
      entries.push({
        path,
        statusCode,
        status: mapStatusCodeToStatus(statusCode, 'u'),
        isStaged: isStagedFromStatusCode(statusCode),
      });
    }
  }

  return entries;
}

function resolveRenamedNumstatPath(filePath: string): string {
  if (!filePath.includes(' => ')) return filePath;

  // In-place rename notation: "src/{Old => New}.tsx"
  if (filePath.includes('{') && filePath.includes('}')) {
    return filePath.replace(/\{[^}]+ => ([^}]+)\}/g, '$1').replace(/\/\//g, '/');
  }

  // Full rename notation: "old.ts => new.ts"
  return filePath.split(' => ').pop()?.trim() ?? filePath;
}

function parseNumstatValue(value: string): number | null {
  if (value === '-') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeNumstatValues(left: number | null | undefined, right: number | null): number | null {
  if (left === null || right === null) return null;
  return (left ?? 0) + right;
}

/**
 * Parse `git diff --numstat` output.
 *
 * Git emits `-` when a value is unknown (for example binary diffs). These
 * unknown values are preserved as `null`.
 */
export function parseNumstatOutput(stdout: string): Map<string, ParsedNumstat> {
  const map = new Map<string, ParsedNumstat>();
  if (!stdout.trim()) return map;

  const lines = stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const additions = parseNumstatValue(parts[0]);
    const deletions = parseNumstatValue(parts[1]);
    const filePath = resolveRenamedNumstatPath(parts.slice(2).join('\t'));
    const current = map.get(filePath);

    if (!current) {
      map.set(filePath, { additions, deletions });
      continue;
    }

    map.set(filePath, {
      additions: mergeNumstatValues(current.additions, additions),
      deletions: mergeNumstatValues(current.deletions, deletions),
    });
  }

  return map;
}

export function combineNumstatValues(
  stagedValue: number | null | undefined,
  unstagedValue: number | null | undefined
): number | null {
  if (stagedValue === null || unstagedValue === null) return null;
  return (stagedValue ?? 0) + (unstagedValue ?? 0);
}
