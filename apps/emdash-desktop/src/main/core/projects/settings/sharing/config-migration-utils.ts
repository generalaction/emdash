import { err, ok, type Result } from '@emdash/shared';
import { fsErrorMessage, type ScopedFileSystem } from '@main/core/files/scoped-file-system';
import { log } from '@main/lib/logger';
import type {
  MigrateProjectConfigRequest,
  ProjectConfigMigration,
  ShareableProjectSettings,
  ShareableProjectSettingsWriteField,
} from '@shared/core/project-settings/project-settings';
import { mergeShareableProjectSettings } from '@shared/core/project-settings/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { ProjectProvider } from '../../project-provider';
import { CONFIG_FILE } from './workspace-config-file';

type ScriptField = Extract<ShareableProjectSettingsWriteField, `scripts.${string}`>;

export type MigrationSettingsData = {
  settings: ShareableProjectSettings;
  fields: ShareableProjectSettingsWriteField[];
};

export function writeConfigFailed<T = never>(
  message: string
): Result<T, UpdateProjectSettingsError> {
  return err({ type: 'write-config-failed', message });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function projectPath(project: ProjectProvider, relPath: string): string {
  return project.resolveProjectPath(relPath);
}

export function openProjectFileSystem(
  project: ProjectProvider
): Result<ScopedFileSystem, UpdateProjectSettingsError> {
  return ok(project.fileSystem);
}

export function trimmedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizedCommandLines(commands: string[]): string | undefined {
  const normalized = commands.map((command) => command.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join('\n') : undefined;
}

export function setScript(
  settings: ShareableProjectSettings,
  field: ScriptField,
  value: string
): void {
  settings.scripts ??= {};
  if (field === 'scripts.setup') settings.scripts.setup = value;
  if (field === 'scripts.run') settings.scripts.run = value;
  if (field === 'scripts.teardown') settings.scripts.teardown = value;
}

export function addScript(
  data: MigrationSettingsData,
  field: ScriptField,
  value: string | undefined
): void {
  if (!value) return;
  setScript(data.settings, field, value);
  data.fields.push(field);
}

export async function applyProjectConfigMigration(
  project: ProjectProvider,
  request: MigrateProjectConfigRequest,
  data: MigrationSettingsData,
  migration: ProjectConfigMigration
): Promise<Result<ProjectConfigMigration, UpdateProjectSettingsError>> {
  if (request.destination === 'local') {
    const currentSettings = await project.settings.get();
    const shareableSettings = mergeShareableProjectSettings(currentSettings, data.settings);
    const updateResult = await project.settings.update({
      ...currentSettings,
      ...shareableSettings,
    });
    if (!updateResult.success) return updateResult;
    return ok(migration);
  }

  const fileSystem = openProjectFileSystem(project);
  if (!fileSystem.success) return fileSystem;

  const written = await fileSystem.data.writeText(
    projectPath(project, CONFIG_FILE),
    `${JSON.stringify(data.settings, null, 2)}\n`
  );
  if (!written.success) {
    return writeConfigFailed(`Could not write ${CONFIG_FILE}: ${fsErrorMessage(written.error)}`);
  }

  const clearResult = await project.settings.patch({ clearShareableFields: data.fields });
  if (!clearResult.success) {
    log.warn('Failed to clear imported local project settings', clearResult.error);
    return writeConfigFailed(`Wrote ${CONFIG_FILE}, but failed to clear local project settings.`);
  }

  return ok(migration);
}
