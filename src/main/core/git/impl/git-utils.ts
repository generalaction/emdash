import type { DiffLine, GitChangeStatus } from '@shared/git';

/** Maximum bytes for fetching file content in diffs. */
export const MAX_DIFF_CONTENT_BYTES = 512 * 1024;

/** Maximum bytes for `git diff` output (larger than content limit due to headers/context). */
export const MAX_DIFF_OUTPUT_BYTES = 10 * 1024 * 1024;

export const DIFF_IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function getDiffImageMimeType(filePath: string): string | null {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return DIFF_IMAGE_MIME_TYPES[ext] ?? null;
}

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

/**
 * Map a git status code (porcelain or diff-tree) to a typed GitChangeStatus.
 * Works for both two-char porcelain codes (e.g. ' M', 'A ', '??') and
 * single-letter diff-tree codes (e.g. 'A', 'D', 'R100').
 */
export function mapStatus(code: string): GitChangeStatus {
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('A') || code.includes('?')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  return 'modified';
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

/**
 * Strips the remote prefix from a fully-qualified remote tracking ref.
 * e.g. "origin/main" → "main", "main" → "main"
 */
export function bareRefName(ref: string): string {
  const slash = ref.indexOf('/');
  return slash !== -1 ? ref.slice(slash + 1) : ref;
}

export function computeBaseRef(
  baseRef?: string | null,
  remote?: string | null,
  branch?: string | null
): string {
  const remoteName = (() => {
    const trimmed = (remote ?? '').trim();
    if (!trimmed) return '';
    if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) return trimmed;
    return 'origin';
  })();

  const normalize = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('://')) return undefined;

    if (trimmed.includes('/')) {
      const [head, ...rest] = trimmed.split('/');
      const branchPart = rest.join('/').replace(/^\/+/, '');
      if (head && branchPart) return `${head}/${branchPart}`;
      if (!head && branchPart) {
        return remoteName ? `${remoteName}/${branchPart}` : branchPart;
      }
      return undefined;
    }

    const suffix = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    return remoteName ? `${remoteName}/${suffix}` : suffix;
  };

  const defaultBranch = remoteName ? `${remoteName}/main` : 'main';
  return normalize(baseRef) ?? normalize(branch) ?? defaultBranch;
}
