import type { MigrateProjectConfigRequest, ProjectConfigMigration } from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, type Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { ProjectProvider } from '../../project-provider';
import { conductorConfigMigrator } from './conductor-config-migration';
import { paseoConfigMigrator } from './paseo-config-migration';
import { supersetConfigMigrator } from './superset-config-migration';
import { CONFIG_FILE } from './workspace-config-file';

export type ProjectConfigMigrator = {
  provider: ProjectConfigMigration['provider'];
  inspect: (
    fs: Pick<FileSystemProvider, 'exists' | 'read'>
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
] as const;

function writeConfigFailed(message: string): Result<never, UpdateProjectSettingsError> {
  return err({ type: 'write-config-failed', message });
}

export async function inspectProjectConfigMigrations(
  fs: Pick<FileSystemProvider, 'exists' | 'read'>
): Promise<ProjectConfigMigration[]> {
  try {
    if (await fs.exists(CONFIG_FILE)) return [];
  } catch (error) {
    log.warn(`Failed to inspect ${CONFIG_FILE} before config migration`, error);
    return [];
  }

  const migrations = await Promise.all(
    PROJECT_CONFIG_MIGRATORS.map(async (migrator) => {
      try {
        return await migrator.inspect(fs);
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
    if (await project.fs.exists(CONFIG_FILE)) {
      return writeConfigFailed(`${CONFIG_FILE} already exists.`);
    }

    const migrator = PROJECT_CONFIG_MIGRATORS.find(
      (candidate) => candidate.provider === request.provider
    );
    if (!migrator) return writeConfigFailed('Unsupported config provider.');

    return await migrator.migrate(project, request);
  } catch (error) {
    log.warn(`Failed to migrate ${request.provider} config to project config`, error);
    return writeConfigFailed(error instanceof Error ? error.message : String(error));
  }
}
