import type { GitChangeStatus } from '#runtimes/git/api';
import { mapGitChangeStatus } from './status';

type Numstat = Map<string, { additions: number; deletions: number }>;

/** Parse `--numstat -z` without treating any part of a path as display text. */
export function parseNumstat(stdout: string): Numstat {
  const stats: Numstat = new Map();
  const records = stdout.split('\0')[Symbol.iterator]();
  for (const record of records) {
    if (!record) continue;
    const [addStr, delStr, ...pathParts] = record.split('\t');
    let filePath = pathParts.join('\t');
    if (!filePath) {
      // Renames and copies have an empty path after the counts, then old/new NUL records.
      records.next();
      filePath = records.next().value ?? '';
    }
    if (!filePath) continue;
    const current = stats.get(filePath) ?? { additions: 0, deletions: 0 };
    current.additions += Number.parseInt(addStr ?? '0', 10) || 0;
    current.deletions += Number.parseInt(delStr ?? '0', 10) || 0;
    stats.set(filePath, current);
  }
  return stats;
}

/** Parse `--name-status -z`, associating renames and copies with their destination. */
export function parseNameStatus(stdout: string): [string, GitChangeStatus][] {
  const statuses: [string, GitChangeStatus][] = [];
  const records = stdout.split('\0')[Symbol.iterator]();
  for (const code of records) {
    if (!code) continue;
    let filePath = records.next().value;
    if (code.startsWith('R') || code.startsWith('C')) {
      filePath = records.next().value;
    }
    if (filePath) statuses.push([filePath, mapGitChangeStatus(code)]);
  }
  return statuses;
}
