import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPENCODE_ALLOW_ALL_PERMISSIONS = JSON.stringify({ '*': 'allow' });
const GEMINI_TRUST_WORKSPACE = 'true';

export function resolveProviderEnv(
  providerConfig: ProviderCustomConfig | undefined,
  options: { providerId?: AgentProviderId; autoApprove?: boolean } = {}
): Record<string, string> | undefined {
  const env: Record<string, string> = {};

  if (options.providerId === 'opencode' && options.autoApprove) {
    env.OPENCODE_PERMISSION = OPENCODE_ALLOW_ALL_PERMISSIONS;
  }

  if (options.providerId === 'gemini' && options.autoApprove) {
    env.GEMINI_CLI_TRUST_WORKSPACE = GEMINI_TRUST_WORKSPACE;
  }

  for (const [key, value] of Object.entries(providerConfig?.env ?? {})) {
    if (ENV_NAME_PATTERN.test(key)) env[key] = value;
  }

  return Object.keys(env).length > 0 ? env : undefined;
}
