import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { provisionedTask } from '@renderer/views/tasks/task-view-state';
import { useTaskViewContext } from '../../task-view-context';
import { getTaskStore } from '../../task-view-state';
import { useGitViewContext } from './git-view-provider';

/**
 * Keeps the activeFile in sync when staged/unstaged lists change (e.g. after a stage/unstage
 * operation). If the active file moved to the other list, the type is updated accordingly.
 * If the file disappeared entirely, activeFile is cleared.
 *
 * Files with type='git' (PR / ref diffs) are not tracked in the working-tree lists and are
 * left unchanged.
 */
export const ActiveFileSync = observer(function ActiveFileSync() {
  const { projectId, taskId } = useTaskViewContext();
  const git = provisionedTask(getTaskStore(projectId, taskId))?.git;

  const { activeFile, setActiveFile } = useGitViewContext();

  useEffect(() => {
    if (!activeFile) return;
    if (!git) return;

    // PR / ref diffs are not part of staged/unstaged lists — leave them alone.
    if (activeFile.type === 'git') return;

    const { stagedFileChanges, unstagedFileChanges } = git;
    const isStaged = activeFile.type === 'staged';
    const inCurrentList = isStaged
      ? stagedFileChanges.some((f) => f.path === activeFile.path)
      : unstagedFileChanges.some((f) => f.path === activeFile.path);

    if (inCurrentList) return;

    const movedToStaged = stagedFileChanges.some((f) => f.path === activeFile.path);
    const movedToUnstaged = unstagedFileChanges.some((f) => f.path === activeFile.path);

    if (movedToStaged) {
      setActiveFile({
        path: activeFile.path,
        type: 'staged',
        originalRef: 'HEAD',
        scrollBehavior: 'auto',
      });
    } else if (movedToUnstaged) {
      setActiveFile({
        path: activeFile.path,
        type: 'disk',
        originalRef: 'HEAD',
        scrollBehavior: 'auto',
      });
    } else {
      setActiveFile(null);
    }
  }, [git, git?.fileChanges, activeFile, setActiveFile]);

  return null;
});
