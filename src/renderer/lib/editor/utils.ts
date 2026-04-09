const MARKDOWN_EXTENSIONS = ['md', 'mdx'];

/** Returns true if the file path points to a markdown file. */
export function isMarkdownPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? MARKDOWN_EXTENSIONS.includes(ext) : false;
}

/** Alias for {@link isMarkdownPath}. */
export const isMarkdownFile = isMarkdownPath;

// ---------------------------------------------------------------------------
// Line-level diff
// ---------------------------------------------------------------------------

export interface DiffLine {
  lineNumber: number;
  type: 'add' | 'modify' | 'delete';
}

/**
 * Compute line-level diff between `original` (git HEAD) and `modified` (buffer).
 * Returns annotations for the *modified* text using a simple LCS walk.
 *
 * - 'add'    — line exists only in modified
 * - 'delete' — a line was removed; reported at the adjacent modified line number
 * - 'modify' — a delete immediately followed by an add at the same position
 */
export function computeLineDiff(original: string, modified: string): DiffLine[] {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const O = origLines.length;
  const M = modLines.length;

  // Build LCS table.
  const dp: number[][] = Array.from({ length: O + 1 }, () => new Array<number>(M + 1).fill(0));
  for (let i = O - 1; i >= 0; i--) {
    for (let j = M - 1; j >= 0; j--) {
      dp[i][j] =
        origLines[i] === modLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the edit script and collect annotations.
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < O || j < M) {
    if (i < O && j < M && origLines[i] === modLines[j]) {
      // Unchanged line.
      i++;
      j++;
    } else if (j < M && (i >= O || dp[i][j + 1] >= dp[i + 1][j])) {
      // Pure addition — but check if the next original line is a deletion
      // at the same position (del+add = modify).
      if (i < O && (j + 1 >= M || dp[i + 1][j + 1] < dp[i][j + 1])) {
        // del immediately before this add → 'modify'
        result.push({ lineNumber: j + 1, type: 'modify' });
        i++;
      } else {
        result.push({ lineNumber: j + 1, type: 'add' });
      }
      j++;
    } else {
      // Deletion — no new modified line; report at next modified line if any.
      if (j < M) {
        result.push({ lineNumber: j + 1, type: 'delete' });
      }
      i++;
    }
  }

  // Deduplicate: if both 'modify' and 'delete' are emitted for the same line,
  // keep only 'modify'.
  const seen = new Map<number, DiffLine>();
  for (const d of result) {
    const existing = seen.get(d.lineNumber);
    if (!existing || d.type === 'modify') {
      seen.set(d.lineNumber, d);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.lineNumber - b.lineNumber);
}

// ---------------------------------------------------------------------------
// Monaco editor options
// ---------------------------------------------------------------------------

/** Default Monaco editor options shared across all editor instances. */
export const DEFAULT_EDITOR_OPTIONS = {
  minimap: { enabled: true },
  fontSize: 13,
  lineNumbers: 'on' as const,
  rulers: [],
  wordWrap: 'on' as const,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection' as const,
  cursorBlinking: 'smooth' as const,
  smoothScrolling: true,
  formatOnPaste: true,
  formatOnType: true,
};
