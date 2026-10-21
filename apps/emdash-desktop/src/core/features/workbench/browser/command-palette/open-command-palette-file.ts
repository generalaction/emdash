import { decodeResourceUri, type ResourceUri } from '@emdash/core/primitives/path/api';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { openFile } from '@core/features/workbench/api/browser/open-file';
import type { ViewRef } from '@core/primitives/views/api';

export function openCommandPaletteFile(
  item: { resource: ResourceUri; projectId: string | null; taskId: string | null },
  dismiss: () => void,
  navigate: (ref: ViewRef) => void
): void {
  if (!item.projectId || !item.taskId) return;
  const decoded = decodeResourceUri(item.resource);
  if (!decoded.success) return;

  openFile(decoded.data, {
    context: { projectId: item.projectId, taskId: item.taskId },
    reveal: true,
  });
  dismiss();
  navigate(taskViewDef({ projectId: item.projectId, taskId: item.taskId }));
}
