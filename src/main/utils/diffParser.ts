import type {
  DiffLine,
  DiffLineEnding,
  DiffMode,
  DiffPayload,
  DiffWarning,
} from '../../shared/diff/types';

/** Maximum bytes for fetching file content in diffs. */
export const MAX_DIFF_CONTENT_BYTES = 512 * 1024;

/** Maximum bytes for `git diff` output (larger than content limit due to headers/context). */
export const MAX_DIFF_OUTPUT_BYTES = 10 * 1024 * 1024;

const DIFF_METADATA_PREFIXES = [
  'diff --git ',
  'index ',
  '--- ',
  '+++ ',
  'new file mode ',
  'old file mode ',
  'new mode ',
  'old mode ',
  'deleted file mode ',
  'similarity index ',
  'dissimilarity index ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
  'Binary files ',
  'GIT binary patch',
  'literal ',
  'delta ',
];
const NO_NEWLINE_MARKER = '\\ No newline at end of file';
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?:.*)?$/;
const HIDDEN_BIDI_CHARS_RE = /[\u202A-\u202E\u2066-\u2069]/;

export type { DiffLine, DiffLineEnding, DiffMode, DiffWarning };
export type DiffResult = DiffPayload;

export interface ParsedDiffLinesResult {
  lines: DiffLine[];
  isBinary: boolean;
  hasHunk: boolean;
}

/** Strip exactly one trailing newline, if present. */
export function stripTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

function isDiffMetadataLine(line: string): boolean {
  return DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/** Parse raw `git diff` output into structured diff lines, with resilient hunk-state parsing. */
export function parseDiffLines(stdout: string): ParsedDiffLinesResult {
  const result: DiffLine[] = [];
  let isBinary = false;
  let inHunk = false;
  let hasHunk = false;

  for (const line of stdout.split('\n')) {
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      isBinary = true;
      inHunk = false;
      continue;
    }

    if (HUNK_HEADER_RE.test(line)) {
      inHunk = true;
      hasHunk = true;
      continue;
    }

    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }

    if (inHunk) {
      if (line === NO_NEWLINE_MARKER) {
        continue;
      }

      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === ' ') {
        result.push({ left: content, right: content, type: 'context' });
        continue;
      }
      if (prefix === '-') {
        result.push({ left: content, type: 'del' });
        continue;
      }
      if (prefix === '+') {
        result.push({ right: content, type: 'add' });
        continue;
      }
      if (prefix === '\\') {
        continue;
      }
    }

    if (!line || isDiffMetadataLine(line)) {
      continue;
    }

    result.push({ left: line, right: line, type: 'context' });
  }

  if (!isBinary && result.length === 0 && stdout.includes('Binary files')) {
    isBinary = true;
  }

  return { lines: result, isBinary, hasHunk };
}

function containsHiddenBidi(text: string | undefined): boolean {
  return typeof text === 'string' && HIDDEN_BIDI_CHARS_RE.test(text);
}

export function detectLineEndingStyle(text: string | undefined): DiffLineEnding {
  if (typeof text !== 'string' || text.length === 0) return 'none';

  let hasLf = false;
  let hasCrLf = false;
  let hasCr = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\r') {
      if (text[i + 1] === '\n') {
        hasCrLf = true;
        i++;
      } else {
        hasCr = true;
      }
      continue;
    }
    if (char === '\n') {
      hasLf = true;
    }
  }

  const kinds = Number(hasLf) + Number(hasCrLf) + Number(hasCr);
  if (kinds > 1) return 'mixed';
  if (hasCrLf) return 'crlf';
  if (hasLf) return 'lf';
  if (hasCr) return 'cr';
  return 'none';
}

export function buildDiffWarnings(args: {
  originalContent?: string;
  modifiedContent?: string;
  lines?: DiffLine[];
}): DiffWarning[] {
  const warnings: DiffWarning[] = [];
  const { originalContent, modifiedContent, lines = [] } = args;

  let hasHiddenBidi = containsHiddenBidi(originalContent) || containsHiddenBidi(modifiedContent);
  if (!hasHiddenBidi) {
    hasHiddenBidi = lines.some(
      (line) => containsHiddenBidi(line.left) || containsHiddenBidi(line.right)
    );
  }
  if (hasHiddenBidi) {
    warnings.push({ kind: 'hidden-bidi' });
  }

  if (originalContent !== undefined && modifiedContent !== undefined) {
    const from = detectLineEndingStyle(originalContent);
    const to = detectLineEndingStyle(modifiedContent);
    if (from !== to && (from !== 'none' || to !== 'none')) {
      warnings.push({ kind: 'line-endings-change', from, to });
    }
  }

  return warnings;
}
