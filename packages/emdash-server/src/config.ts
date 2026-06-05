import { existsSync as fsExistsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const routeMatchSchema = z.object({
  header: z.string().optional(),
  payload: z.string().optional(), // JSONPath e.g. $.action
  value: z.string(),
});

const routeSchema = z.object({
  match: routeMatchSchema,
  automationToken: z.string(),
  fanOut: z.boolean().optional().default(false),
});

// A server-side automation: when an event arrives for `token`, run `claude` in
// a Docker container against `repoPath` with `prompt`.
const automationSchema = z.object({
  token: z.string(), // matches webhook_events.token
  repoPath: z.string(), // host path, mounted into the container at /work
  prompt: z.string(),
  image: z.string().default('rundash-runner:latest'),
  push: z.boolean().default(false), // git push after the run
  branch: z.string().optional(), // create/checkout before running, if set
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000),
});

const runnerSchema = z
  .object({
    enabled: z.boolean().default(false),
    pollIntervalMs: z.number().int().positive().default(5000),
    maxConcurrent: z.number().int().positive().default(1),
  })
  .default({});

export const configSchema = z.object({
  apiKey: z.string(),
  port: z.number().default(8080),
  host: z.string().default('0.0.0.0'),
  dbPath: z.string(),
  signingSecrets: z.record(z.string(), z.string()).default({}), // token -> hmac secret
  routes: z.array(routeSchema).default([]),
  // Long-lived OAuth token from `claude setup-token`, injected into each
  // container as CLAUDE_CODE_OAUTH_TOKEN. NOT an ANTHROPIC_API_KEY (which would
  // outrank it per Claude docs). See the dockerized-agent-runner spec.
  claudeOauthToken: z.string().optional(),
  runner: runnerSchema,
  automations: z.array(automationSchema).default([]),
});

export type Config = z.infer<typeof configSchema>;
export type Route = z.infer<typeof routeSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type RunnerConfig = z.infer<typeof runnerSchema>;

export function defaultConfigDir(): string {
  // Prefer .rundash-server; fall back to the legacy .emdash-server path so
  // existing deployments keep working without a manual migration.
  const legacy = join(homedir(), '.emdash-server');
  const preferred = join(homedir(), '.rundash-server');
  return fsExistsSync(legacy) && !fsExistsSync(preferred) ? legacy : preferred;
}

export function defaultConfigPath(): string {
  return join(defaultConfigDir(), 'config.json');
}

export function defaultDbPath(): string {
  return join(defaultConfigDir(), 'db.sqlite');
}

export function loadConfig(configPath = defaultConfigPath()): Config {
  if (!fsExistsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}. Run: rundash-server init`);
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
  return configSchema.parse(raw);
}

export function saveConfig(config: Config, configPath = defaultConfigPath()): void {
  mkdirSync(join(configPath, '..'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
