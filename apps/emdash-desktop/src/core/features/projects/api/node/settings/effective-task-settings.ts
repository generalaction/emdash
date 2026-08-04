import {
  defaultEmdashConfig,
  emdashConfigSchema,
  parseEmdashConfig,
} from '@emdash/core/primitives/emdash-config/api';
import { log } from '@emdash/shared/logger';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import type { ProjectSettings } from '@core/primitives/project-settings/api';
import { mergeShareableProjectSettings } from '@core/primitives/project-settings/api';
import { fileKey, type FilesClientScope } from '@core/services/runtime-broker/node/files';

export async function getEffectiveTaskSettings(args: {
  projectSettings: ProjectSettingsProvider;
  taskFiles: FilesClientScope;
  taskConfigPath: string;
}): Promise<ProjectSettings> {
  const { projectSettings, taskFiles, taskConfigPath } = args;
  const parsedSettings = emdashConfigSchema.safeParse(await projectSettings.get());
  const localShareableSettings = parsedSettings.success ? parsedSettings.data : {};
  const defaults = defaultEmdashConfig();
  const exists = await taskFiles.client.fs.exists(fileKey(taskFiles, taskConfigPath));
  if (!exists.success) {
    log.warn('Failed to check task .emdash.json, falling back to project settings', exists.error);
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }
  if (!exists.data) {
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }

  const content = await taskFiles.client.fs.readText(fileKey(taskFiles, taskConfigPath));
  if (!content.success) {
    log.warn('Failed to read task .emdash.json, falling back to project settings', content.error);
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }
  if (content.data.truncated) {
    log.warn('Task .emdash.json was truncated, falling back to project settings', {
      path: taskConfigPath,
      totalSize: content.data.totalSize,
    });
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }

  const parsed = parseEmdashConfig(content.data.content);
  if (!parsed.success) {
    log.warn('Failed to parse task .emdash.json, falling back to project settings', {
      error: parsed.error,
    });
  }
  return mergeShareableProjectSettings(
    defaults,
    parsed.success ? parsed.data : {},
    localShareableSettings
  );
}
