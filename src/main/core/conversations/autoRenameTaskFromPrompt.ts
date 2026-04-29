import { log } from '@main/lib/logger';
import { appSettingsService } from '../settings/settings-service';
import { generateTaskName } from '../tasks/generateTaskName';
import { renameTask } from '../tasks/renameTask';

export interface AutoRenameTaskFromPromptParams {
  projectId: string;
  taskId: string;
  isFirstInTask: boolean;
  initialPrompt: string | undefined;
}

const renamedTaskIds = new Set<string>();

export function resetAutoRenamedTasksForTesting(): void {
  renamedTaskIds.clear();
}

export async function autoRenameTaskFromPrompt(
  params: AutoRenameTaskFromPromptParams
): Promise<void> {
  if (!params.isFirstInTask) return;
  const trimmed = params.initialPrompt?.trim();
  if (!trimmed) return;
  if (renamedTaskIds.has(params.taskId)) return;
  try {
    const taskSettings = await appSettingsService.get('tasks');
    if (!taskSettings.autoRenameFromFirstPrompt) return;
    const newName = generateTaskName({ title: trimmed });
    if (!newName) return;
    renamedTaskIds.add(params.taskId);
    await renameTask(params.projectId, params.taskId, newName);
  } catch (err) {
    log.warn('Failed to auto-rename task from first prompt', err);
  }
}
