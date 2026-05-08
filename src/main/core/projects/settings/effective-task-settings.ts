import {
  defaultShareableProjectSettings,
  shareableProjectSettingsSchema,
  type ProjectSettings,
} from '@shared/project-settings';
import { mergeShareableProjectSettings } from '@shared/project-settings-fields';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { ProjectSettingsProvider } from './provider';

export async function getEffectiveTaskSettings(args: {
  projectSettings: ProjectSettingsProvider;
  taskFs: FileSystemProvider;
}): Promise<ProjectSettings> {
  const { projectSettings, taskFs } = args;
  const localShareableSettings = shareableProjectSettingsSchema.parse(await projectSettings.get());
  const defaults = defaultShareableProjectSettings();
  const exists = await taskFs.exists('.emdash.json');
  if (!exists) {
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }

  try {
    const { content } = await taskFs.read('.emdash.json');
    const projectFileSettings = shareableProjectSettingsSchema.parse(JSON.parse(content));
    return mergeShareableProjectSettings(defaults, projectFileSettings, localShareableSettings);
  } catch (err) {
    log.warn('Failed to parse task .emdash.json, falling back to project settings', err);
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }
}
