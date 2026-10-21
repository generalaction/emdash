import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { focusTracker } from '@core/primitives/telemetry/browser/focus-tracker';
import { getTaskComposition } from './task-composition-selectors';

export interface OpenFileContext {
  projectId: string;
  taskId: string;
}

export interface OpenFileOptions {
  /** Task whose composition hosts the tab. Defaults to the focused task view. */
  context?: OpenFileContext;
  /** Pane placement: the focused pane, or the pane to its right (split if needed). */
  target?: 'active' | 'right';
  /** Open as a preview (italic, replaced-by-next-preview) tab. Defaults to pinned. */
  preview?: boolean;
  /**
   * Also reveal the file in the Files sidebar and move focus to the editor —
   * the "navigate to this file" intent (chat links, command palette). Sidebar
   * clicks leave this off: the tree already shows the file and keeps focus.
   */
  reveal?: boolean;
}

/**
 * The single entry point for opening a file in the editor (spec §10). Routes
 * placement through the pane/tab-layout machinery and never touches content:
 * the file tab acquires buffer and disk facets from the app-global
 * OpenFileStore when it mounts, so there is no existence precheck here —
 * missing files open as a tab showing the store's `error(not-found)`
 * placeholder.
 *
 * Returns false when no task composition could be resolved for the context.
 */
export function openFile(ref: HostFileRef, options: OpenFileOptions = {}): boolean {
  const context = options.context ?? focusedTaskContext();
  if (!context) return false;
  const composition = getTaskComposition(context.projectId, context.taskId);
  if (!composition) return false;

  const path = nativePathFromHost(ref.path);
  composition.paneLayout.open(
    'file',
    { path },
    { preview: options.preview ?? false, target: options.target ?? 'active' }
  );
  if (options.reveal) {
    focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
    composition.setFocusedRegion('main');
    composition.revealWorkspaceFile(path);
  }
  return true;
}

function focusedTaskContext(): OpenFileContext | undefined {
  const current = getNavigation().currentRef;
  if (current.viewId !== taskViewDef.id) return undefined;
  const { projectId, taskId } = current.params as { projectId?: string; taskId?: string };
  return projectId && taskId ? { projectId, taskId } : undefined;
}
