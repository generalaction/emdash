import z from 'zod';

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
  .transform((patterns) => patterns.filter((pattern) => pattern !== '.emdash.json'));

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
  remote: z.string().optional(),
  tmux: z.boolean().optional(),
  workspaceProvider: z
    .object({
      type: z.literal('script'),
      provisionCommand: z.string().min(1),
      terminateCommand: z.string().min(1),
    })
    .optional(),
});

export type BaseProjectSettings = z.infer<typeof baseProjectSettingsSchema>;

export const projectSettingsSchema = baseProjectSettingsSchema.merge(
  shareableProjectSettingsSchema
);

export const legacyProjectConfigSchema = projectSettingsSchema;

export function defaultShareableProjectSettings(): ShareableProjectSettings {
  return shareableProjectSettingsWithDefaultsSchema.parse({});
}

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

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

export function emptyProjectSettingsOverrideState(): ProjectSettingsOverrideState {
  return {
    preservePatterns: [],
    shellSetup: [],
    'scripts.setup': [],
    'scripts.run': [],
    'scripts.teardown': [],
  };
}

export function shareableProjectSettingsFieldPath(
  field: ShareableProjectSettingsWriteField
): string[] {
  return field.split('.');
}

export function getShareableProjectSettingsFieldValue(
  settings: ShareableProjectSettings,
  field: ShareableProjectSettingsWriteField
): unknown {
  switch (field) {
    case 'preservePatterns':
      return settings.preservePatterns;
    case 'shellSetup':
      return settings.shellSetup;
    case 'scripts.setup':
      return settings.scripts?.setup;
    case 'scripts.run':
      return settings.scripts?.run;
    case 'scripts.teardown':
      return settings.scripts?.teardown;
  }
}

export function getShareableProjectSettingsFieldDisplayValue(
  settings: ShareableProjectSettings,
  field: ShareableProjectSettingsWriteField
): string | null {
  switch (field) {
    case 'preservePatterns': {
      const value = settings.preservePatterns?.filter((pattern) => pattern.trim());
      return value?.length ? value.join('\n') : null;
    }
    case 'shellSetup':
      return settings.shellSetup?.trim() ? settings.shellSetup : null;
    case 'scripts.setup':
      return settings.scripts?.setup?.trim() ? settings.scripts.setup : null;
    case 'scripts.run':
      return settings.scripts?.run?.trim() ? settings.scripts.run : null;
    case 'scripts.teardown':
      return settings.scripts?.teardown?.trim() ? settings.scripts.teardown : null;
  }
}

export function clearShareableProjectSettingsFields<T extends ProjectSettings>(
  settings: T,
  fields: ShareableProjectSettingsWriteField[]
): T {
  const next: ProjectSettings = {
    ...settings,
    preservePatterns: settings.preservePatterns ? [...settings.preservePatterns] : undefined,
    scripts: settings.scripts ? { ...settings.scripts } : undefined,
  };

  for (const field of fields) {
    switch (field) {
      case 'preservePatterns':
        delete next.preservePatterns;
        break;
      case 'shellSetup':
        delete next.shellSetup;
        break;
      case 'scripts.setup':
        if (next.scripts) delete next.scripts.setup;
        break;
      case 'scripts.run':
        if (next.scripts) delete next.scripts.run;
        break;
      case 'scripts.teardown':
        if (next.scripts) delete next.scripts.teardown;
        break;
    }
  }

  if (next.scripts && Object.values(next.scripts).every((value) => value === undefined)) {
    delete next.scripts;
  }

  return next as T;
}
