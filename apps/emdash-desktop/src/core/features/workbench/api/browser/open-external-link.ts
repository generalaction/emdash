import { toast } from '@emdash/ui/react/primitives';
import { getAppSettingValueSnapshot } from '@core/features/settings/api/browser/app-settings-client';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { openModal } from '@core/manifests/browser/modal-api';
import {
  copyTextToClipboard,
  openExternal,
} from '@core/primitives/desktop-host/browser/host-client';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { normalizeExternalHttpUrl } from './external-url';

const HTTP_URL_PATTERN = /^https?:\/\//i;

type TaskView = NonNullable<ReturnType<typeof getTaskComposition>>;

export function confirmOpenExternalLink(url: string, onError?: (error: unknown) => void): void {
  const normalizedUrl = normalizeExternalHttpUrl(url);

  if (!HTTP_URL_PATTERN.test(normalizedUrl)) {
    return;
  }

  const taskView = getActiveTaskView();
  const preferredTarget = getAppSettingValueSnapshot('browser')?.openLinksIn ?? 'ask';

  if (preferredTarget === 'emdash-browser' && taskView) {
    openInEmdashBrowser(taskView, normalizedUrl);
    return;
  }

  if (preferredTarget !== 'ask') {
    openInExternalBrowser(normalizedUrl, onError);
    return;
  }

  void openModal('confirmExternalLinkModal', {
    url: normalizedUrl,
    canOpenInEmdashBrowser: taskView !== undefined,
    onCopy: () => copyExternalLink(normalizedUrl),
  }).then((outcome) => {
    if (!outcome.success) return;
    if (outcome.data === 'emdash-browser') {
      if (taskView) openInEmdashBrowser(taskView, normalizedUrl);
      return;
    }
    openInExternalBrowser(normalizedUrl, onError);
  });
}

function openInEmdashBrowser(taskView: TaskView, url: string): void {
  taskView.paneLayout.open('browser', { initialUrl: url });
  taskView.setFocusedRegion('main');
}

function openInExternalBrowser(url: string, onError?: (error: unknown) => void): void {
  void openExternal(url).catch((error) => {
    onError?.(error);
  });
}

async function copyExternalLink(url: string): Promise<boolean> {
  try {
    const result = await copyTextToClipboard(url);
    if (!result.success) {
      showCopyFailure();
      return false;
    }
    toast('Link copied');
    return true;
  } catch {
    showCopyFailure();
    return false;
  }
}

function showCopyFailure(): void {
  toast.error('Copy failed', { description: 'The link could not be copied to the clipboard.' });
}

function getActiveTaskView() {
  const ref = getNavigation().currentRef;
  if (ref.viewId !== 'task') return undefined;
  const { projectId, taskId } = ref.params as {
    projectId?: string;
    taskId?: string;
  };
  if (!projectId || !taskId) return undefined;
  return getTaskComposition(projectId, taskId);
}
