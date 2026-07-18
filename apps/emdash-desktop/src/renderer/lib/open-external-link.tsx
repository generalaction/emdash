import { getTaskView } from '@core/features/tasks/browser/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import { openModal } from '@renderer/lib/modal/api';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { appState } from '@renderer/lib/stores/app-state';
import { normalizeExternalHttpUrl } from './external-url';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function confirmOpenExternalLink(url: string, onError?: (error: unknown) => void): void {
  const normalizedUrl = normalizeExternalHttpUrl(url);

  if (!HTTP_URL_PATTERN.test(normalizedUrl)) {
    return;
  }

  const taskView = getActiveTaskView();

  void openModal('confirmExternalLinkModal', {
    url: normalizedUrl,
    canOpenInEmdashBrowser: taskView !== undefined,
    onCopy: () => copyExternalLink(normalizedUrl),
  }).then((outcome) => {
    if (!outcome.success) return;
    if (outcome.data === 'emdash-browser') {
      taskView?.paneLayout.open('browser', { initialUrl: normalizedUrl });
      taskView?.setFocusedRegion('main');
      return;
    }
    void rpc.app.openExternal(normalizedUrl).catch((error) => {
      onError?.(error);
    });
  });
}

async function copyExternalLink(url: string): Promise<boolean> {
  try {
    const result = await rpc.app.clipboardWriteText(url);
    if (!result.success) {
      showCopyFailure();
      return false;
    }
    toast({ title: 'Link copied' });
    return true;
  } catch {
    showCopyFailure();
    return false;
  }
}

function showCopyFailure(): void {
  toast({
    title: 'Copy failed',
    description: 'The link could not be copied to the clipboard.',
    variant: 'destructive',
  });
}

function getActiveTaskView() {
  const ref = appState.navigation.currentRef;
  if (ref.viewId !== 'task') return undefined;
  const { projectId, taskId } = ref.params as {
    projectId?: string;
    taskId?: string;
  };
  if (!projectId || !taskId) return undefined;
  return getTaskView(projectId, taskId);
}
