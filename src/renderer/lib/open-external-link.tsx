import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { normalizeExternalHttpUrl } from './external-url';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function confirmOpenExternalLink(url: string, onError?: (error: unknown) => void): void {
  const normalizedUrl = normalizeExternalHttpUrl(url);

  if (!HTTP_URL_PATTERN.test(normalizedUrl)) {
    return;
  }

  const taskView = getActiveTaskView();

  showModal('confirmExternalLinkModal', {
    url: normalizedUrl,
    canOpenInEmdashBrowser: taskView !== undefined,
    onSuccess: (choice) => {
      if (choice === 'emdash-browser') {
        taskView?.tabGroupManager.openBrowser(normalizedUrl);
        taskView?.setFocusedRegion('main');
        return;
      }
      void rpc.app.openExternal(normalizedUrl).catch((error) => {
        onError?.(error);
      });
    },
  });
}

function getActiveTaskView() {
  if (appState.navigation.currentViewId !== 'task') return undefined;
  const params = appState.navigation.viewParamsStore.task;
  const projectId = typeof params?.projectId === 'string' ? params.projectId : undefined;
  const taskId = typeof params?.taskId === 'string' ? params.taskId : undefined;
  if (!projectId || !taskId) return undefined;
  return getTaskView(projectId, taskId);
}
