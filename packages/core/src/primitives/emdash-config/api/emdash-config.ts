import z from 'zod';

export const EMDASH_CONFIG_FILE = '.emdash.json';

export function isEmdashConfigPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized === EMDASH_CONFIG_FILE || normalized.endsWith(`/${EMDASH_CONFIG_FILE}`);
}

export const DEFAULT_PRESERVE_PATTERNS = [
  '.env',
  '.env.keys',
  '.env.local',
  '.env.*.local',
  '.envrc',
  'docker-compose.override.yml',
] as const;

const preservePatternsSchema = z
  .array(z.string())
  .transform((patterns) => patterns.filter((pattern) => pattern !== EMDASH_CONFIG_FILE));

export const emdashScriptsConfigSchema = z.object({
  prepare: z.string().optional(),
  setup: z.string().optional(),
  run: z.string().optional(),
  teardown: z.string().optional(),
});

export const emdashConfigSchema = z.object({
  preservePatterns: preservePatternsSchema.optional(),
  shellSetup: z.string().optional(),
  scripts: emdashScriptsConfigSchema.optional(),
});

export const emdashConfigWithDefaultsSchema = emdashConfigSchema.extend({
  preservePatterns: preservePatternsSchema.default([...DEFAULT_PRESERVE_PATTERNS]),
});

export type EmdashConfig = z.infer<typeof emdashConfigSchema>;
export type EmdashScriptsConfig = z.infer<typeof emdashScriptsConfigSchema>;

export type ParseEmdashConfigResult =
  | { success: true; data: EmdashConfig }
  | { success: false; data: EmdashConfig; error: unknown };

export function defaultEmdashConfig(): EmdashConfig {
  return emdashConfigWithDefaultsSchema.parse({});
}

export function parseEmdashConfig(content: string): ParseEmdashConfigResult {
  try {
    return { success: true, data: emdashConfigSchema.parse(JSON.parse(content)) };
  } catch (error) {
    return { success: false, data: defaultEmdashConfig(), error };
  }
}
