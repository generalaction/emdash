import type { GitChange, GitChangeStatus } from '@emdash/core/runtimes/git/api';
import { normalizeFileTreePath } from '@core/features/editor/api/browser/file-tree/tree-utils';

export interface FileTreeGitDecorations {
  fileStatusByPath: ReadonlyMap<string, GitChangeStatus>;
  directoryStatusByPath: ReadonlyMap<string, GitChangeStatus>;
}

export function buildFileTreeGitDecorations(changes: readonly GitChange[]): FileTreeGitDecorations {
  const fileStatusByPath = new Map<string, GitChangeStatus>();
  const directoryStatusByPath = new Map<string, GitChangeStatus>();
  const propagatingChanges: Array<{ path: string; status: GitChangeStatus }> = [];

  for (const change of changes) {
    const path = normalizeFileTreePath(change.path);
    fileStatusByPath.set(path, change.status);
    if (change.status !== 'deleted') {
      propagatingChanges.push({ path, status: change.status });
    }
  }

  propagatingChanges.sort((left, right) => left.path.localeCompare(right.path));
  for (const change of propagatingChanges) {
    const { path } = change;
    let separatorIndex = path.lastIndexOf('/');
    while (separatorIndex > 0) {
      const directoryPath = path.slice(0, separatorIndex);
      if (!directoryStatusByPath.has(directoryPath)) {
        directoryStatusByPath.set(directoryPath, change.status);
      }
      separatorIndex = directoryPath.lastIndexOf('/');
    }
  }

  return {
    fileStatusByPath,
    directoryStatusByPath,
  };
}
