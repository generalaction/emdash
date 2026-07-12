import type { Result } from '@emdash/shared';
import { fsErrorMessage, type ScopedFileSystem } from '@main/core/files/scoped-file-system';
import { log } from '@main/lib/logger';
import type {
  MigrateProjectConfigRequest,
  ProjectConfigMigration,
} from '@shared/core/project-settings/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { ProjectProvider } from '../../project-provider';
import { codexConfigMigrator } from './codex-config-migration';
import { conductorConfigMigrator } from './conductor-config-migration';
import {
  errorMessage,
  openProjectFileSystem,
  projectPath,
  writeConfigFailed,
} from './config-migration-utils';
import { paseoConfigMigrator } from './paseo-config-migration';
import { supersetConfigMigrator } from './superset-config-migration';
import { CONFIG_FILE } from './workspace-config-file';

export type ProjectConfigMigrator = {
  provider: ProjectConfigMigration['provider'];
  inspect: (
    project: ProjectProvider,
    fileSystem: ScopedFileSystem
  ) => Promise<ProjectConfigMigration | null>;
  migrate: (
    project: ProjectProvider,
    request: MigrateProjectConfigRequest
  ) => Promise<Result<ProjectConfigMigration, UpdateProjectSettingsError>>;
};

const PROJECT_CONFIG_MIGRATORS = [
  conductorConfigMigrator,
  supersetConfigMigrator,
  paseoConfigMigrator,
  codexConfigMigrator,
] as const;

function projectConfigPath(project: ProjectProvider): string {
  return projectPath(project, CONFIG_FILE);
}

export async function inspectProjectConfigMigrations(
  project: ProjectProvider
): Promise<ProjectConfigMigration[]> {
  const fileSystem = openProjectFileSystem(project);
  if (!fileSystem.success) {
    log.warn('Failed to open project file system before config migration', fileSystem.error);
    return [];
  }

  const existingConfig = await fileSystem.data.exists(projectConfigPath(project));
  if (!existingConfig.success) {
    log.warn(`Failed to inspect ${CONFIG_FILE} before config migration`, existingConfig.error);
    return [];
  }
  if (existingConfig.data) return [];

  const migrations = await Promise.all(
    PROJECT_CONFIG_MIGRATORS.map(async (migrator) => {
      try {
        return await migrator.inspect(project, fileSystem.data);
      } catch (error) {
        log.warn(`Failed to inspect ${migrator.provider} config for migration`, error);
        return null;
      }
    })
  );

  return migrations.filter((migration): migration is ProjectConfigMigration => migration !== null);
}

export async function migrateProjectConfigFromProvider(
  project: ProjectProvider,
  request: MigrateProjectConfigRequest
): Promise<Result<ProjectConfigMigration, UpdateProjectSettingsError>> {
  try {
    const fileSystem = openProjectFileSystem(project);
    if (!fileSystem.success) return fileSystem;

    const existingConfig = await fileSystem.data.exists(projectConfigPath(project));
    if (!existingConfig.success) {
      return writeConfigFailed(
        `Could not check existing ${CONFIG_FILE}: ${fsErrorMessage(existingConfig.error)}`
      );
    }
    if (existingConfig.data) {
      return writeConfigFailed(`${CONFIG_FILE} already exists.`);
    }

    const migrator = PROJECT_CONFIG_MIGRATORS.find(
      (candidate) => candidate.provider === request.provider
    );
    if (!migrator) return writeConfigFailed('Unsupported config provider.');

    return await migrator.migrate(project, request);
  } catch (error) {
    log.warn(`Failed to migrate ${request.provider} config to project config`, error);
    return writeConfigFailed(errorMessage(error));
  }
}
