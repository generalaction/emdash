import z from 'zod';

export const PROJECT_CONFIG_FILE = '.emdash.json';

export const DEFAULT_PRESERVE_PATTERNS = [
  '.env',
  '.env.keys',
  '.env.local',
  '.env.*.local',
  '.envrc',
  'docker-compose.override.yml',
] as const;

export const defaultBranchSettingSchema = z.union([
  z.string(),
  z.object({ name: z.string(), remote: z.literal(true) }),
]);

export type DefaultBranchSetting = z.infer<typeof defaultBranchSettingSchema>;

const preservePatternsSchema = z
  .array(z.string())
  .transform((patterns) => patterns.filter((pattern) => pattern !== PROJECT_CONFIG_FILE));

export const shareableProjectScriptsSettingsSchema = z.object({
  setup: z.string().optional(),
  run: z.string().optional(),
  teardown: z.string().optional(),
});

export const shareableProjectSettingsSchema = z.object({
  preservePatterns: preservePatternsSchema.optional(),
  shellSetup: z.string().optional(),
  scripts: shareableProjectScriptsSettingsSchema.optional(),
});

export const shareableProjectSettingsWithDefaultsSchema = shareableProjectSettingsSchema.extend({
  preservePatterns: preservePatternsSchema.default([...DEFAULT_PRESERVE_PATTERNS]),
});

export type ShareableProjectSettings = z.infer<typeof shareableProjectSettingsSchema>;

export const baseProjectSettingsSchema = z.object({
  worktreeDirectory: z.string().trim().optional(),
  defaultBranch: defaultBranchSettingSchema.optional(),
  baseRemote: z.string().optional(),
  pushRemote: z.string().optional(),
  githubAccountId: z.string().trim().min(1).nullable().optional(),
  tmux: z.boolean().optional(),
  autoRunSetupScriptOnTaskCreation: z.boolean().optional(),
  autoRunRunScriptOnTaskCreation: z.boolean().optional(),
  workspaceProvider: z
    .object({
      type: z.literal('script'),
      provisionCommand: z.string().min(1),
      terminateCommand: z.string().min(1),
    })
    .optional(),
});

export type BaseProjectSettings = z.infer<typeof baseProjectSettingsSchema>;

export const legacyBaseProjectSettingsSchema = baseProjectSettingsSchema.extend({
  remote: z.string().optional(),
});

export const projectSettingsSchema = baseProjectSettingsSchema.merge(
  shareableProjectSettingsSchema
);

export const legacyProjectConfigSchema = legacyBaseProjectSettingsSchema.merge(
  shareableProjectSettingsSchema
);

export function defaultShareableProjectSettings(): ShareableProjectSettings {
  return shareableProjectSettingsWithDefaultsSchema.parse({});
}

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

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

export type ShareableProjectSettingsWriteField =
  | 'preservePatterns'
  | 'shellSetup'
  | 'scripts.setup'
  | 'scripts.run'
  | 'scripts.teardown';

export const SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS = [
  'preservePatterns',
  'shellSetup',
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
    shellSetup: [],
    'scripts.setup': [],
    'scripts.run': [],
    'scripts.teardown': [],
  };
}
