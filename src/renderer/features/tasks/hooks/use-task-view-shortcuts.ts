import { useHotkey } from '@tanstack/react-hotkeys';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useTaskViewNavigation } from './use-task-view-navigation';

/**
 * Mounts keyboard shortcuts that are scoped to the active task view:
 * - Switch between task sub-views (conversations, diff, editor)
 * - Navigate to the next / previous task within the same project
 *
 * Must be called inside a component that has access to TaskViewContext.
 */
export function useTaskViewShortcuts() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const { projectId, taskId } = useTaskViewContext();
  const { openAgentsView, openEditorView, openDiffView } = useTaskViewNavigation();
  const { navigate } = useNavigate();
  const taskMgr = getTaskManagerStore(projectId);

  useHotkey(getEffectiveHotkey('taskViewAgents', keyboard), openAgentsView);
  useHotkey(getEffectiveHotkey('taskViewDiff', keyboard), openDiffView);
  useHotkey(getEffectiveHotkey('taskViewEditor', keyboard), openEditorView);

  useHotkey(getEffectiveHotkey('nextProject', keyboard), () => {
    if (!taskMgr) return;
    const ids = Array.from(taskMgr.tasks.keys());
    const idx = ids.indexOf(taskId);
    const nextId = ids[idx + 1];
    if (nextId) navigate('task', { projectId, taskId: nextId });
  });

  useHotkey(getEffectiveHotkey('prevProject', keyboard), () => {
    if (!taskMgr) return;
    const ids = Array.from(taskMgr.tasks.keys());
    const idx = ids.indexOf(taskId);
    if (idx > 0) {
      const prevId = ids[idx - 1];
      if (prevId) navigate('task', { projectId, taskId: prevId });
    }
  });
}
