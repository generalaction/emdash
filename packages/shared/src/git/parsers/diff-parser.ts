import type { DiffLine } from '../models/diff';
import type { GitChangeStatus } from '../models/status';

const DIFF_HEADER_PREFIXES = [
  'diff ',
  'index ',
  '--- ',
  '+++ ',
  '@@',
  'new file mode',
  'old file mode',
  'deleted file mode',
  'similarity index',
  'rename from',
  'rename to',
  'Binary files',
];

export function mapGitChangeStatus(code: string): GitChangeStatus {
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('A') || code.includes('?')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

export function parseDiffLines(stdout: string): { lines: DiffLine[]; isBinary: boolean } {
  const lines: DiffLine[] = [];

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (DIFF_HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;

    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === '\\') continue;
    if (prefix === ' ') {
      lines.push({ left: content, right: content, type: 'context' });
    } else if (prefix === '-') {
      lines.push({ left: content, type: 'del' });
    } else if (prefix === '+') {
      lines.push({ right: content, type: 'add' });
    } else {
      lines.push({ left: line, right: line, type: 'context' });
    }
  }

  return {
    lines,
    isBinary: lines.length === 0 && stdout.includes('Binary files'),
  };
}
