import { fileKey, type FilesClientScope } from '@main/core/files/runtime-process/client';
import { log } from '@main/lib/logger';
import {
  defaultShareableProjectSettings,
  shareableProjectSettingsSchema,
  type ProjectSettings,
} from '@shared/core/project-settings/project-settings';
import { mergeShareableProjectSettings } from '@shared/core/project-settings/project-settings-fields';
import type { ProjectSettingsProvider } from './provider';

export async function getEffectiveTaskSettings(args: {
  projectSettings: ProjectSettingsProvider;
  taskFiles: FilesClientScope;
  taskConfigPath: string;
}): Promise<ProjectSettings> {
  const { projectSettings, taskFiles, taskConfigPath } = args;
  const parsedSettings = shareableProjectSettingsSchema.safeParse(await projectSettings.get());
  const localShareableSettings = parsedSettings.success ? parsedSettings.data : {};
  const defaults = defaultShareableProjectSettings();
  const exists = await taskFiles.client.fs.exists(fileKey(taskFiles, taskConfigPath));
  if (!exists.success) {
    log.warn('Failed to check task .emdash.json, falling back to project settings', exists.error);
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }
  if (!exists.data) {
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }

  try {
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
    const projectFileSettings = shareableProjectSettingsSchema.parse(
      JSON.parse(content.data.content)
    );
    return mergeShareableProjectSettings(defaults, projectFileSettings, localShareableSettings);
  } catch (err) {
    log.warn('Failed to parse task .emdash.json, falling back to project settings', err);
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }
}
