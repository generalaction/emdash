import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ok, err, type Result } from '../../../lib/result';
import { log } from '../../lib/logger';

const lifecycleScriptsSchema = z.object({
  setup: z.string().optional(),
  run: z.string().optional(),
  teardown: z.string().optional(),
});

export const projectSettingsSchema = z.object({
  preservePatterns: z.array(z.string()).optional(),
  scripts: lifecycleScriptsSchema.optional(),
  shellSetup: z.string().optional(),
  tmux: z.boolean().optional(),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  preservePatterns: [
    '.env',
    '.env.keys',
    '.env.local',
    '.env.*.local',
    '.envrc',
    'docker-compose.override.yml',
  ],
  scripts: { setup: '', run: '', teardown: '' },
};

export type EnsureProjectSettingsError =
  | { kind: 'read_failed'; message: string }
  | { kind: 'invalid_json'; message: string }
  | { kind: 'invalid_schema'; message: string };

export function ensureProjectSettings(
  projectPath: string
): Result<ProjectSettings, EnsureProjectSettingsError> {
  const configPath = path.join(projectPath, '.emdash.json');

  if (!fs.existsSync(configPath)) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_PROJECT_SETTINGS, null, 2), 'utf8');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('ensureProjectSettings: failed to write default config', { configPath, message });
    }
    return ok(DEFAULT_PROJECT_SETTINGS);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: 'read_failed', message });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: 'invalid_json', message });
  }

  const result = projectSettingsSchema.safeParse(parsed);
  if (!result.success) {
    return err({ kind: 'invalid_schema', message: result.error.message });
  }

  return ok(result.data);
}
