import z from 'zod';

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
    ]),
  shellSetup: z.string().optional(),
  tmux: z.boolean().optional(),
  scripts: z
    .object({
      setup: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .default(''), // array or string
      run: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .default(''),
      teardown: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .default(''),
    })
    .optional(),
  worktreeDirectory: z.string().optional(),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export interface ProjectSettingsProvider {
  getWorktreeDirectory(): Promise<string>;
  get(): Promise<ProjectSettings>;
  update(settings: ProjectSettings): Promise<void>;
  ensure(): Promise<void>;
}
