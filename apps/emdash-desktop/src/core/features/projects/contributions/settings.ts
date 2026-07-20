import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { LocalProjectSettings, ProjectSettings } from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';
import { normalizeBranchPrefix } from '@core/primitives/tasks/api';
import { getDefaultLocalWorktreeDirectory } from '../node/worktree-defaults';

const projectSettingsSchema = z.object({
  pushOnCreate: z.boolean(),
  branchPrefix: z.string().transform(normalizeBranchPrefix),
  appendRandomBranchSuffix: z.boolean(),
  tmuxByDefault: z.boolean(),
});

const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string(),
  defaultWorktreeDirectory: z.string(),
  writeAgentConfigToGitIgnore: z.boolean(),
});

export const projectSettingsContribution = defineSettingsContribution<'project', ProjectSettings>({
  key: 'project',
  schema: projectSettingsSchema,
  defaults: {
    pushOnCreate: true,
    branchPrefix: 'emdash',
    appendRandomBranchSuffix: true,
    tmuxByDefault: false,
  },
});

export const localProjectSettingsContribution = defineSettingsContribution<
  'localProject',
  LocalProjectSettings
>({
  key: 'localProject',
  schema: localProjectSettingsSchema,
  defaults: () => ({
    defaultProjectsDirectory: join(homedir(), 'emdash', 'repositories'),
    defaultWorktreeDirectory: getDefaultLocalWorktreeDirectory(),
    writeAgentConfigToGitIgnore: true,
  }),
});
