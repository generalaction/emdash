import { toast } from '@emdash/ui/react/primitives';
import type { TaskComposition } from '@core/features/workbench/api/browser/task-composition';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { openModal } from '@core/manifests/browser/modal-api';
import {
  copyTextToClipboard,
  openExternal,
} from '@core/primitives/desktop-host/browser/host-client';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
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
      openInTaskView(taskView, normalizedUrl);
      return;
    }
    void openExternal(normalizedUrl).catch((error) => {
      onError?.(error);
    });
  });
}

/**
 * Opens the link in a browser pane of the active task without confirmation.
 * Returns false when there is no task view to host the pane, or the link is not http(s).
 */
export function openLinkInEmdashBrowser(url: string): boolean {
  const normalizedUrl = normalizeExternalHttpUrl(url);
  if (!HTTP_URL_PATTERN.test(normalizedUrl)) return false;

  const taskView = getActiveTaskView();
  if (taskView === undefined) return false;

  openInTaskView(taskView, normalizedUrl);
  return true;
}

export type LinkModifierEvent = Pick<MouseEvent, 'altKey'>;

/**
 * Link activation from a pointer: ⌥-click opens the link directly in the Emdash
 * browser; otherwise (or when no task pane can host it) the choice dialog is shown.
 */
export function openExternalLinkFromMouseEvent(
  event: LinkModifierEvent,
  url: string,
  onError?: (error: unknown) => void
): void {
  if (event.altKey && openLinkInEmdashBrowser(url)) return;
  confirmOpenExternalLink(url, onError);
}

function openInTaskView(taskView: TaskComposition | undefined, url: string): void {
  if (taskView === undefined) return;
  taskView.paneLayout.open('browser', { initialUrl: url });
  taskView.setFocusedRegion('main');
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
