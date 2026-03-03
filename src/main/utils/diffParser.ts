/** Maximum bytes for fetching file content in diffs. */
export const MAX_DIFF_CONTENT_BYTES = 512 * 1024;

/** Maximum bytes for `git diff` output (larger than content limit due to headers/context). */
export const MAX_DIFF_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Headers emitted by `git diff` that should be skipped when parsing hunks. */
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

export type DiffLine = { left?: string; right?: string; type: 'context' | 'add' | 'del' };

export interface DiffResult {
  lines: DiffLine[];
  isBinary?: boolean;
  originalContent?: string;
  modifiedContent?: string;
}

/** Strip exactly one trailing newline, if present. */
export function stripTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

/** Parse raw `git diff` output into structured diff lines, skipping headers. */
export function parseDiffLines(stdout: string): { lines: DiffLine[]; isBinary: boolean } {
  const result: DiffLine[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (DIFF_HEADER_PREFIXES.some((p) => line.startsWith(p))) continue;
    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === '\\') continue;
    if (prefix === ' ') result.push({ left: content, right: content, type: 'context' });
    else if (prefix === '-') result.push({ left: content, type: 'del' });
    else if (prefix === '+') result.push({ right: content, type: 'add' });
    else result.push({ left: line, right: line, type: 'context' });
  }
  const isBinary = result.length === 0 && stdout.includes('Binary files');
  return { lines: result, isBinary };
}
