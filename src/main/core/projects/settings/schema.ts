import z from 'zod';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';

export const defaultBranchSettingSchema = z.union([
  z.string(),
  z.object({ name: z.string(), remote: z.literal(true) }),
]);

export type DefaultBranchSetting = z.infer<typeof defaultBranchSettingSchema>;

export const projectSettingsSchema = z.object({
  preservePatterns: z
    .array(z.string())
    .optional()
    .default([
      '.env',
      '.env.keys',
      '.env.local',
      '.env.*.local',
      '.envrc',
      'docker-compose.override.yml',
      '.emdash.json',
    ]),
  shellSetup: z.string().optional(),
  tmux: z.boolean().optional(),
  scripts: z
    .object({
      setup: z.string().optional(),
      run: z.string().optional(),
      teardown: z.string().optional(),
    })
    .optional(),
  worktreeDirectory: z.string().trim().optional(),
  defaultBranch: defaultBranchSettingSchema.optional(),
  remote: z.string().optional(),
  workspaceProvider: z
    .object({
      type: z.literal('script'),
      provisionCommand: z.string().min(1),
      terminateCommand: z.string().min(1),
    })
    .optional(),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export interface ProjectSettingsProvider {
  getDefaultBranch(): Promise<string>;
  getRemote(): Promise<string>;
  getWorktreeDirectory(): Promise<string>;
  get(): Promise<ProjectSettings>;
  update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>>;
  ensure(): Promise<void>;
}
