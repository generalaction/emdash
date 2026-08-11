import { emdashConfigSchema, type EmdashConfig } from '@emdash/core/primitives/emdash-config/api';
import type { Result } from '@emdash/shared';
import z from 'zod';
import type { StoredProjectGitSettings } from './effective-settings';
import type { WorktreeRootContext } from './worktree-root';

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

// --- Stored model (spec: github-git-settings §10) -------------------------
// The persisted per-project base settings after lazy migration. Only explicit
// user choices are stored; absence of a field always means "infer". The
// resolver-facing types live in ./effective-settings.

export const storedDefaultBranchSchema = z.object({
  /** Remote the branch lives on; `null` means a local branch. */
  remote: z.string().nullable(),
  branch: z.string(),
});

export const storedGithubAccountSchema = z.union([
  z.object({ kind: z.literal('account'), accountId: z.string().trim().min(1) }),
  z.object({ kind: z.literal('none') }),
]);

export const storedBaseProjectSettingsSchema = z.object({
  /** Renamed from the legacy `worktreeDirectory` key. */
  worktreeRoot: z.string().trim().optional(),
  defaultBranch: storedDefaultBranchSchema.optional(),
  baseRemote: z.string().optional(),
  pushRemote: z.string().optional(),
  githubAccount: storedGithubAccountSchema.optional(),
  tmux: z.boolean().optional(),
  autoRunSetupScriptOnTaskCreation: z.boolean().optional(),
  autoRunRunScriptOnTaskCreation: z.boolean().optional(),
});

export type StoredBaseProjectSettings = z.infer<typeof storedBaseProjectSettingsSchema>;

/**
 * Permissive read schema for stored base-settings rows: accepts every legacy
 * form (bare-string/`{name, remote}` defaultBranch, `githubAccountId`,
 * `worktreeDirectory`, pre-baseRemote `remote`) alongside the new stored
 * model. The settings provider migrates rows lazily on read; every other
 * reader of the raw JSON must parse with this schema.
 */
export const legacyBaseProjectSettingsSchema = baseProjectSettingsSchema.extend({
  remote: z.string().optional(),
  defaultBranch: z.union([defaultBranchSettingSchema, storedDefaultBranchSchema]).optional(),
  worktreeRoot: z.string().trim().optional(),
  githubAccount: storedGithubAccountSchema.optional(),
});

export type LegacyBaseProjectSettings = z.infer<typeof legacyBaseProjectSettingsSchema>;

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
  /**
   * Stored explicit git choices in the new model (absence = infer) — the
   * renderer's resolver input (spec: github-git-settings §2). The legacy
   * `settings` view stays for the non-git fields until the resolver adoption
   * finishes.
   */
  storedGitSettings: StoredProjectGitSettings;
  /**
   * The worktree-root layers below the per-project override, split so the
   * renderer resolves true provenance ("host default" vs "built-in default")
   * with the identical resolver inputs execution uses (spec §6).
   */
  worktreeRootContext: WorktreeRootContext;
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
