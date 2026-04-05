import type { FileChange } from '../hooks/useFileChanges';
import type { GitPlatformGetPullRequestBaseDiffResult } from '../../shared/git/platform';

// Dedup cache for PR diff fetches — prevents duplicate IPC calls when multiple
// components (FileChangesPanel, DiffViewer) request the same diff simultaneously.
type PrDiffResult = GitPlatformGetPullRequestBaseDiffResult;
const pendingFetches = new Map<string, Promise<PrDiffResult>>();

export async function fetchPrBaseDiff(
  worktreePath: string,
  prNumber: number
): Promise<PrDiffResult> {
  const key = `${worktreePath}:${prNumber}`;
  const existing = pendingFetches.get(key);
  if (existing) return existing;

  const promise = window.electronAPI
    .gitPlatformGetPullRequestBaseDiff({ worktreePath, prNumber })
    .finally(() => pendingFetches.delete(key));
  pendingFetches.set(key, promise);
  return promise;
}

/**
 * Parse a unified diff string into FileChange[] objects.
 * Handles added, deleted, renamed, and modified files.
 */
export function parseDiffToFileChanges(diffText: string): FileChange[] {
  if (!diffText || !diffText.trim()) return [];

  const files: FileChange[] = [];
  // Split on diff headers
  const diffSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of diffSections) {
    const lines = section.split('\n');
    if (lines.length === 0) continue;

    // Parse file paths from the header: "a/path b/path"
    // Use --- and +++ lines for reliable path extraction (handles spaces in paths)
    let oldPath: string | undefined;
    let newPath: string | undefined;
    for (const l of lines.slice(1, 10)) {
      if (l.startsWith('--- a/')) oldPath = l.slice(6);
      else if (l.startsWith('--- /dev/null')) oldPath = '/dev/null';
      else if (l.startsWith('+++ b/')) newPath = l.slice(6);
      else if (l.startsWith('+++ /dev/null')) newPath = '/dev/null';
    }
    // Fallback to header regex for edge cases (e.g. binary files without ---/+++ lines)
    if (!oldPath || !newPath) {
      const headerMatch = lines[0].match(/^a\/(.+) b\/(.+)$/);
      if (!headerMatch) continue;
      oldPath = oldPath ?? headerMatch[1];
      newPath = newPath ?? headerMatch[2];
    }

    // Detect file status from diff metadata
    let status: FileChange['status'] = 'modified';
    const sectionHead = lines.slice(0, 10).join('\n');

    if (sectionHead.includes('new file mode')) {
      status = 'added';
    } else if (sectionHead.includes('deleted file mode')) {
      status = 'deleted';
    } else if (sectionHead.includes('rename from') || oldPath !== newPath) {
      status = 'renamed';
    }

    // Count additions and deletions from diff hunks
    let additions = 0;
    let deletions = 0;
    let inHunk = false;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;

      // A new diff header or file-level metadata ends the hunk
      if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
        continue;
      }

      if (line.startsWith('+')) {
        additions++;
      } else if (line.startsWith('-')) {
        deletions++;
      }
    }

    const filePath = status === 'deleted' ? oldPath : newPath;
    files.push({
      path: filePath,
      status,
      additions,
      deletions,
      isStaged: false,
    });
  }

  return files;
}
