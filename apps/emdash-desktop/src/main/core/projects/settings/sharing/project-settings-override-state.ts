import { fileKey } from '@main/core/files/runtime-process/client';
import { log } from '@main/lib/logger';
import {
  emptyProjectSettingsOverrideState,
  SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS,
  shareableProjectSettingsSchema,
  type ProjectSettingsOverrideState,
} from '@shared/core/project-settings/project-settings';
import { SHAREABLE_FIELD_ACCESSORS } from '@shared/core/project-settings/project-settings-fields';
import type { ProjectSettingsResolvedTarget } from './project-settings-target-resolver';

export async function computeProjectSettingsOverrideState(
  targets: ProjectSettingsResolvedTarget[]
): Promise<ProjectSettingsOverrideState> {
  const state = emptyProjectSettingsOverrideState();

  for (const resolved of targets) {
    try {
      const exists = await resolved.files.client.fs.exists(
        fileKey(resolved.files, resolved.configPath)
      );
      if (!exists.success || !exists.data) continue;

      const content = await resolved.files.client.fs.readText(
        fileKey(resolved.files, resolved.configPath)
      );
      if (!content.success) continue;
      if (content.data.truncated) {
        log.warn('Project settings override source was truncated', {
          path: resolved.configPath,
          totalSize: content.data.totalSize,
        });
        continue;
      }
      const parsed = shareableProjectSettingsSchema.safeParse(JSON.parse(content.data.content));
      if (!parsed.success) continue;

      for (const field of SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS) {
        const value = SHAREABLE_FIELD_ACCESSORS[field].displayValue(parsed.data);
        if (!value) continue;

        state[field].push({
          label: resolved.label,
          path: resolved.path,
          value,
        });
      }
    } catch (error) {
      log.warn('Failed to inspect project settings override source', error);
    }
  }

  return state;
}
