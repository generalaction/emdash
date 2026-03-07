import type { FileChange } from '../hooks/useFileChanges';

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
    const headerMatch = lines[0].match(/^a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];

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
