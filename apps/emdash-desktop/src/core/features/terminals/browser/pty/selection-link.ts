/**
 * Selection-content classification for terminal overlays.
 *
 * Ported from Pane's SelectionPopover (frontend/src/components/terminal/SelectionPopover.tsx)
 * so the selection popover shows the same conditional items: Copy always;
 * Open in Browser + Open URL when the selection contains a URL; Open in Pane +
 * Show in Explorer when the selection is a file path.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/;

// File path shapes — Unix absolute/relative (with optional ./ ~/ prefixes),
// Windows absolute paths, and relative paths with an extension, optionally
// carrying a :line / :line:col suffix.
const FILE_PATH_PATTERNS = [
  /^[.~]?\/[\w\-.\\/]+/, // Unix absolute or relative paths starting with / ./ ~/
  /^[A-Za-z]:[\\/][\w\-.\\/]+/, // Windows absolute paths C:\ or C:/
  /^[\w\-./\\]+\.[a-z]{1,10}(:\d+)*$/i, // Relative paths with extension like foo.ts, foo.ts:42, dir/foo.ts:12:3
];

export type SelectionLinkKind =
  | { kind: 'url'; url: string }
  | { kind: 'file'; rawPath: string; path: string; line?: number }
  | { kind: 'other' };

/** Strip a trailing :line / :line:col suffix and report the pieces. */
export function parseFileLinkText(text: string): { path: string; line?: number } {
  const trimmed = text.trim();
  // Leftmost `:\d+` whose remainder runs to the end — strips `:line:col` in
  // one match while a greedy `.*:` would bind only the final number.
  const match = /:(\d+)(?::\d+)?$/.exec(trimmed);
  if (match) {
    const path = trimmed.slice(0, match.index);
    // Guard against prose like "timeout:30" — only strip when the remainder
    // still looks like a path (contains a separator or an extension dot).
    if (path && /[/\\]|\.[^\d]/.test(path)) {
      return {
        path,
        line: Number.parseInt(match[1], 10) || undefined,
      };
    }
  }
  return { path: trimmed };
}

export function classifySelectionLink(text: string): SelectionLinkKind {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'other' };

  const urlMatch = URL_PATTERN.exec(trimmed);
  if (urlMatch) return { kind: 'url', url: urlMatch[0] };

  if (isFilePathText(trimmed)) {
    const { path, line } = parseFileLinkText(trimmed);
    return { kind: 'file', rawPath: trimmed, path, line };
  }

  return { kind: 'other' };
}

function isFilePathText(trimmed: string): boolean {
  return FILE_PATH_PATTERNS.some((pattern) => pattern.test(trimmed));
}
