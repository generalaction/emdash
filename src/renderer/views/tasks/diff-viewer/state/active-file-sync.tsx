import { useEffect } from 'react';
import { useGitChangesContext } from './git-changes-provider';
import { useGitViewContext } from './git-view-provider';

export function ActiveFileSync() {
  const { activeFile, setActiveFile } = useGitViewContext();
  const { fileChanges, stagedFileChanges, unstagedFileChanges } = useGitChangesContext();

  useEffect(() => {
    if (!activeFile) return;

    const inCurrentList = activeFile.isStaged
      ? stagedFileChanges.some((f) => f.path === activeFile.path)
      : unstagedFileChanges.some((f) => f.path === activeFile.path);

    if (inCurrentList) return;

    const movedToStaged = stagedFileChanges.some((f) => f.path === activeFile.path);
    const movedToUnstaged = unstagedFileChanges.some((f) => f.path === activeFile.path);

    if (movedToStaged) {
      setActiveFile({ path: activeFile.path, isStaged: true, scrollBehavior: 'auto' });
    } else if (movedToUnstaged) {
      setActiveFile({ path: activeFile.path, isStaged: false, scrollBehavior: 'auto' });
    } else {
      setActiveFile(null);
    }
  }, [fileChanges, activeFile, stagedFileChanges, unstagedFileChanges, setActiveFile]);

  return null;
}
