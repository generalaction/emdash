import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import {
  projectSettingsSchema,
  type ProjectSettings,
  type ProjectSettingsProvider,
} from './schema';

export async function getEffectiveTaskSettings(args: {
  projectSettings: ProjectSettingsProvider;
  taskFs: FileSystemProvider;
}): Promise<ProjectSettings> {
  const { projectSettings, taskFs } = args;
  const exists = await taskFs.exists('.emdash.json');
  if (!exists) {
    return projectSettings.get();
  }

  try {
    const { content } = await taskFs.read('.emdash.json');
    return projectSettingsSchema.parse(JSON.parse(content));
  } catch (err) {
    log.warn('Failed to parse task .emdash.json, falling back to project settings', err);
    return projectSettings.get();
  }
}
