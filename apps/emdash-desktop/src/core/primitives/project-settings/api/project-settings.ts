import { emdashConfigSchema, type EmdashConfig } from '@emdash/core/primitives/emdash-config/api';
import type { Result } from '@emdash/shared';
import z from 'zod';

export const defaultBranchSettingSchema = z.union([
  z.string(),
  z.object({ name: z.string(), remote: z.literal(true) }),
]);

export type DefaultBranchSetting = z.infer<typeof defaultBranchSettingSchema>;

export type ShareableProjectSettings = EmdashConfig;

export const baseProjectSettingsSchema = z.object({
  worktreeDirectory: z.string().trim().optional(),
  defaultBranch: defaultBranchSettingSchema.optional(),
  baseRemote: z.string().optional(),
  pushRemote: z.string().optional(),
  githubAccountId: z.string().trim().min(1).nullable().optional(),
  tmux: z.boolean().optional(),
  autoRunSetupScriptOnTaskCreation: z.boolean().optional(),
  autoRunRunScriptOnTaskCreation: z.boolean().optional(),
});

export type BaseProjectSettings = z.infer<typeof baseProjectSettingsSchema>;

export const legacyBaseProjectSettingsSchema = baseProjectSettingsSchema.extend({
  remote: z.string().optional(),
});

export const projectSettingsSchema = baseProjectSettingsSchema.merge(emdashConfigSchema);

export const legacyProjectConfigSchema = legacyBaseProjectSettingsSchema.merge(emdashConfigSchema);

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export type ProjectSettingsLoadError =
  | { type: 'not_found'; entity: 'workspace'; workspaceId: string }
  | { type: 'fs_error'; message: string };

export type ProjectSettingsLoadResult = Result<ProjectSettings, ProjectSettingsLoadError>;

export type ProjectSettingsPatch = {
  clearShareableFields?: ShareableProjectSettingsWriteField[];
  githubAccountId?: string | null;
};

export type ProjectSettingsPage = {
  settings: ProjectSettings;
  defaults: {
    worktreeDirectory: string;
  };
  writeTargets: ProjectSettingsWriteTargetOption[];
  overrideState: ProjectSettingsOverrideState;
  configMigrations: ProjectConfigMigration[];
  shouldPromptConfigMigration: boolean;
};

export type ProjectSettingsWriteTarget =
  | { type: 'project' }
  | { type: 'task'; taskId: string }
  | { type: 'workspace'; workspaceId: string };

export type ProjectSettingsWriteTargetOption = ProjectSettingsWriteTarget & {
  label: string;
  path: string;
};

// shellSetup is deliberately absent: the per-project DB field was retired in favor
// of per-host defaults (host-settings runtime) overridden by workspace .emdash.json.
export type ShareableProjectSettingsWriteField =
  | 'preservePatterns'
  | 'scripts.prepare'
  | 'scripts.setup'
  | 'scripts.run'
  | 'scripts.teardown';

export const SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS = [
  'preservePatterns',
  'scripts.prepare',
  'scripts.setup',
  'scripts.run',
  'scripts.teardown',
] as const satisfies ShareableProjectSettingsWriteField[];

export type WriteProjectConfigRequest = {
  target: ProjectSettingsWriteTarget;
  fields: ShareableProjectSettingsWriteField[];
};

export type ProjectSettingsOverrideSource = {
  label: string;
  path: string;
  value: string;
};

export type ProjectSettingsOverrideState = Record<
  ShareableProjectSettingsWriteField,
  ProjectSettingsOverrideSource[]
>;

export type ProjectConfigMigrationProvider = 'conductor' | 'superset' | 'paseo' | 'codex';

export type ProjectConfigMigration = {
  provider: ProjectConfigMigrationProvider;
  label: string;
  files: string[];
  fields: ShareableProjectSettingsWriteField[];
  unsupportedFields: string[];
};

export type ProjectConfigMigrationDestination = 'local' | 'shared';

export type MigrateProjectConfigRequest = {
  provider: ProjectConfigMigrationProvider;
  destination: ProjectConfigMigrationDestination;
};

export type MigrateProjectConfigResult = {
  page: ProjectSettingsPage;
  migration: ProjectConfigMigration;
};

export function emptyProjectSettingsOverrideState(): ProjectSettingsOverrideState {
  return {
    preservePatterns: [],
    'scripts.prepare': [],
    'scripts.setup': [],
    'scripts.run': [],
    'scripts.teardown': [],
  };
}
