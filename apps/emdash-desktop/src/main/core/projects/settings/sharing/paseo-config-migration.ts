import { err, ok, type Result } from '@emdash/shared';
import z from 'zod';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import {
  type MigrateProjectConfigRequest,
  type ProjectConfigMigration,
  type ShareableProjectSettings,
  type ShareableProjectSettingsWriteField,
} from '@shared/core/project-settings/project-settings';
import { mergeShareableProjectSettings } from '@shared/core/project-settings/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { ProjectProvider } from '../../project-provider';
import { parseJsonObject } from '../project-settings-json';
import type { ProjectConfigMigrator } from './config-migration';
import { CONFIG_FILE } from './workspace-config-file';

const PASEO_CONFIG_FILE = 'paseo.json';

const paseoCommandSchema = z.union([z.string(), z.array(z.string())]);

const paseoScriptSchema = z
  .object({
    command: z.string().optional(),
    type: z.string().optional(),
    port: z.number().optional(),
  })
  .passthrough();

const paseoConfigSchema = z
  .object({
    worktree: z
      .object({
        setup: paseoCommandSchema.optional(),
        teardown: paseoCommandSchema.optional(),
        terminals: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    scripts: z.record(z.string(), paseoScriptSchema).optional(),
  })
  .passthrough();

type PaseoMigrationData = {
  settings: ShareableProjectSettings;
  files: string[];
  fields: ShareableProjectSettingsWriteField[];
  unsupportedFields: string[];
};

function writeConfigFailed(message: string): Result<never, UpdateProjectSettingsError> {
  return err({ type: 'write-config-failed', message });
}

function normalizeCommand(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;

  const commands = Array.isArray(value) ? value : [value];
  const normalized = commands.map((command) => command.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join('\n') : undefined;
}

function setScript(
  settings: ShareableProjectSettings,
  field: ShareableProjectSettingsWriteField,
  value: string
): void {
  settings.scripts ??= {};
  if (field === 'scripts.setup') settings.scripts.setup = value;
  if (field === 'scripts.teardown') settings.scripts.teardown = value;
}

function addScript(
  data: PaseoMigrationData,
  field: ShareableProjectSettingsWriteField,
  value: string | undefined
): void {
  if (!value) return;
  setScript(data.settings, field, value);
  data.fields.push(field);
}

function toPaseoMigration(data: PaseoMigrationData): ProjectConfigMigration | null {
  if (data.fields.length === 0) return null;
  return {
    provider: 'paseo',
    label: 'Paseo',
    files: data.files,
    fields: data.fields,
    unsupportedFields: data.unsupportedFields,
  };
}

function addUnsupportedScripts(
  data: PaseoMigrationData,
  scripts: z.infer<typeof paseoConfigSchema>['scripts']
): void {
  if (!scripts) return;

  for (const [name, script] of Object.entries(scripts)) {
    if (script.command !== undefined) data.unsupportedFields.push(`scripts.${name}.command`);
    if (script.type !== undefined) data.unsupportedFields.push(`scripts.${name}.type`);
    if (script.port !== undefined) data.unsupportedFields.push(`scripts.${name}.port`);
  }
}

async function readPaseoMigrationData(
  fs: Pick<FileSystemProvider, 'exists' | 'read'>
): Promise<PaseoMigrationData> {
  const data: PaseoMigrationData = {
    settings: {},
    files: [],
    fields: [],
    unsupportedFields: [],
  };

  if (!(await fs.exists(PASEO_CONFIG_FILE))) return data;

  const { content } = await fs.read(PASEO_CONFIG_FILE);
  const paseoConfig = paseoConfigSchema.parse(parseJsonObject(content));
  data.files.push(PASEO_CONFIG_FILE);

  addScript(data, 'scripts.setup', normalizeCommand(paseoConfig.worktree?.setup));
  addScript(data, 'scripts.teardown', normalizeCommand(paseoConfig.worktree?.teardown));
  addUnsupportedScripts(data, paseoConfig.scripts);

  if (paseoConfig.worktree?.terminals !== undefined) {
    data.unsupportedFields.push('worktree.terminals');
  }

  return data;
}

async function migratePaseoConfig(
  project: ProjectProvider,
  request: MigrateProjectConfigRequest
): Promise<Result<ProjectConfigMigration, UpdateProjectSettingsError>> {
  try {
    const data = await readPaseoMigrationData(project.fs);
    const migration = toPaseoMigration(data);
    if (!migration) {
      return writeConfigFailed('No supported Paseo settings were found.');
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
    log.warn('Failed to migrate Paseo config to project config', error);
    return writeConfigFailed(error instanceof Error ? error.message : String(error));
  }
}

export const paseoConfigMigrator: ProjectConfigMigrator = {
  provider: 'paseo',
  inspect: async (fs) => toPaseoMigration(await readPaseoMigrationData(fs)),
  migrate: migratePaseoConfig,
};
