import z from 'zod';

export const AGENT_CONFIG_FILE = '.agent.json';

export function isAgentConfigPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized === AGENT_CONFIG_FILE || normalized.endsWith(`/${AGENT_CONFIG_FILE}`);
}

const preservePatternsSchema = z
  .array(z.string())
  .transform((patterns) => patterns.filter((pattern) => pattern !== AGENT_CONFIG_FILE));

export const agentScriptsConfigSchema = z.object({
  prepare: z.string().optional(),
  setup: z.string().optional(),
  run: z.string().optional(),
  teardown: z.string().optional(),
});

/**
 * Stale keys from retired features (e.g. `excludePatterns`) are silently stripped by
 * the non-strict object parse, so old `.agent.json` files keep parsing cleanly.
 */
export const agentConfigSchema = z.object({
  /** Gitignored files deliberately carried into new worktrees; empty unless configured. */
  preservePatterns: preservePatternsSchema.optional(),
  shellSetup: z.string().optional(),
  scripts: agentScriptsConfigSchema.optional(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentScriptsConfig = z.infer<typeof agentScriptsConfigSchema>;

export type ParseAgentConfigResult =
  | { success: true; data: AgentConfig }
  | { success: false; data: AgentConfig; error: unknown };

export function defaultAgentConfig(): AgentConfig {
  return agentConfigSchema.parse({});
}

export function parseAgentConfig(content: string): ParseAgentConfigResult {
  try {
    return { success: true, data: agentConfigSchema.parse(JSON.parse(content)) };
  } catch (error) {
    return { success: false, data: defaultAgentConfig(), error };
  }
}
