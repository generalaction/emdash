import { log } from '@main/lib/logger';
import {
  emptyProjectSettingsOverrideState,
  SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS,
  shareableProjectSettingsSchema,
  type ProjectSettingsOverrideState,
} from '@shared/core/project-settings/project-settings';
import { SHAREABLE_FIELD_ACCESSORS } from '@shared/core/project-settings/project-settings-fields';
import type { ProjectSettingsResolvedTarget } from './project-settings-target-resolver';
import { CONFIG_FILE } from './workspace-config-file';

export async function computeProjectSettingsOverrideState(
  targets: ProjectSettingsResolvedTarget[]
): Promise<ProjectSettingsOverrideState> {
  const state = emptyProjectSettingsOverrideState();

  for (const resolved of targets) {
    try {
      if (!(await resolved.fs.exists(CONFIG_FILE))) continue;

      const { content } = await resolved.fs.read(CONFIG_FILE);
      const parsed = shareableProjectSettingsSchema.safeParse(JSON.parse(content));
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
