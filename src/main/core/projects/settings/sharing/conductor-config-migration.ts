import z from 'zod';
import {
  type MigrateProjectConfigRequest,
  type ProjectConfigMigration,
  type ShareableProjectSettings,
  type ShareableProjectSettingsWriteField,
} from '@shared/project-settings';
import { mergeShareableProjectSettings } from '@shared/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { ProjectProvider } from '../../project-provider';
import { parseJsonObject } from '../project-settings-json';
import type { ProjectConfigMigrator } from './config-migration';
import { CONFIG_FILE } from './workspace-config-file';

const CONDUCTOR_CONFIG_FILE = 'conductor.json';
const CONDUCTOR_WORKTREE_INCLUDE_FILE = '.worktreeinclude';

const conductorConfigSchema = z
  .object({
    scripts: z
      .object({
        setup: z.string().optional(),
        run: z.string().optional(),
        archive: z.string().optional(),
      })
      .optional(),
    runScriptMode: z.enum(['concurrent', 'nonconcurrent']).optional(),
    enterpriseDataPrivacy: z.boolean().optional(),
  })
  .passthrough();

type ConductorMigrationData = {
  settings: ShareableProjectSettings;
  files: string[];
  fields: ShareableProjectSettingsWriteField[];
  unsupportedFields: string[];
};

function writeConfigFailed(message: string): Result<never, UpdateProjectSettingsError> {
  return err({ type: 'write-config-failed', message });
}

function trimmedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseWorktreeInclude(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function toConductorMigration(data: ConductorMigrationData): ProjectConfigMigration | null {
  if (data.fields.length === 0) return null;
  return {
    provider: 'conductor',
    label: 'Conductor',
    files: data.files,
    fields: data.fields,
    unsupportedFields: data.unsupportedFields,
  };
}

async function readConductorMigrationData(
  fs: Pick<FileSystemProvider, 'exists' | 'read'>
): Promise<ConductorMigrationData> {
  const data: ConductorMigrationData = {
    settings: {},
    files: [],
    fields: [],
    unsupportedFields: [],
  };

  if (await fs.exists(CONDUCTOR_CONFIG_FILE)) {
    const { content } = await fs.read(CONDUCTOR_CONFIG_FILE);
    const conductorConfig = conductorConfigSchema.parse(parseJsonObject(content));
    data.files.push(CONDUCTOR_CONFIG_FILE);

    const setup = trimmedText(conductorConfig.scripts?.setup);
    const run = trimmedText(conductorConfig.scripts?.run);
    const archive = trimmedText(conductorConfig.scripts?.archive);

    if (setup) {
      data.settings.scripts ??= {};
      data.settings.scripts.setup = setup;
      data.fields.push('scripts.setup');
    }
    if (run) {
      data.settings.scripts ??= {};
      data.settings.scripts.run = run;
      data.fields.push('scripts.run');
    }
    if (archive) {
      data.settings.scripts ??= {};
      data.settings.scripts.teardown = archive;
      data.fields.push('scripts.teardown');
    }

    if (conductorConfig.runScriptMode !== undefined) data.unsupportedFields.push('runScriptMode');
    if (conductorConfig.enterpriseDataPrivacy !== undefined) {
      data.unsupportedFields.push('enterpriseDataPrivacy');
    }
  }

  if (await fs.exists(CONDUCTOR_WORKTREE_INCLUDE_FILE)) {
    const { content } = await fs.read(CONDUCTOR_WORKTREE_INCLUDE_FILE);
    const patterns = parseWorktreeInclude(content);
    if (patterns.length > 0) {
      data.files.push(CONDUCTOR_WORKTREE_INCLUDE_FILE);
      data.settings.preservePatterns = patterns;
      data.fields.push('preservePatterns');
    }
  }

  return data;
}

async function migrateConductorConfig(
  project: ProjectProvider,
  request: MigrateProjectConfigRequest
): Promise<Result<ProjectConfigMigration, UpdateProjectSettingsError>> {
  try {
    const data = await readConductorMigrationData(project.fs);
    const migration = toConductorMigration(data);
    if (!migration) {
      return writeConfigFailed('No supported Conductor settings were found.');
    }

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

    const writeResult = await project.fs.write(
      CONFIG_FILE,
      `${JSON.stringify(data.settings, null, 2)}\n`
    );
    if (!writeResult.success) {
      log.warn('Failed to write migrated project config file', writeResult.error);
      return writeConfigFailed(writeResult.error ?? `Failed to write ${CONFIG_FILE}.`);
    }

    const clearResult = await project.settings.patch({ clearShareableFields: data.fields });
    if (!clearResult.success) {
      log.warn('Failed to clear imported local project settings', clearResult.error);
      return writeConfigFailed(`Wrote ${CONFIG_FILE}, but failed to clear local project settings.`);
    }

    return ok(migration);
  } catch (error) {
    log.warn('Failed to migrate Conductor config to project config', error);
    return writeConfigFailed(error instanceof Error ? error.message : String(error));
  }
}

export const conductorConfigMigrator: ProjectConfigMigrator = {
  provider: 'conductor',
  inspect: async (fs) => toConductorMigration(await readConductorMigrationData(fs)),
  migrate: migrateConductorConfig,
};
