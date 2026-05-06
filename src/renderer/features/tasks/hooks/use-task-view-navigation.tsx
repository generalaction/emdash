import { useCallback, useTransition } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';

export function useTaskViewNavigation() {
  const provisionedTask = useProvisionedTask();
  const [isPending, startTransition] = useTransition();

  const openAgentsView = useCallback(() => {
    startTransition(() => {
      provisionedTask.taskView.setView('agents');
    });
  }, [provisionedTask]);

  const openEditorView = useCallback(() => {
    startTransition(() => {
      provisionedTask.taskView.setView('editor');
    });
  }, [provisionedTask]);

  const openDiffView = useCallback(() => {
    startTransition(() => {
      provisionedTask.taskView.setView('diff');
    });
  }, [provisionedTask]);

  return {
    isPending,
    openAgentsView,
    openEditorView,
    openDiffView,
  };
}
