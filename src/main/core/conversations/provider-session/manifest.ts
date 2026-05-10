import type { AgentProviderId } from '@shared/agent-provider-registry';
import { claudeCapability } from './claude';
import { codexCapability } from './codex';
import { copilotCapability } from './copilot';
import type { ProviderSessionCapability, ProviderSessionManifest, TranscriptReader } from './types';

/**
 * Single registry — adding a provider's transcript / session support means
 * adding one entry here.
 */
const PROVIDER_SESSION_MANIFEST: ProviderSessionManifest = {
  claude: claudeCapability,
  codex: codexCapability,
  copilot: copilotCapability,
};

export function getProviderSessionCapability(
  providerId: AgentProviderId
): ProviderSessionCapability | null {
  return PROVIDER_SESSION_MANIFEST[providerId] ?? null;
}

export function getTranscriptReader(providerId: AgentProviderId): TranscriptReader | null {
  return getProviderSessionCapability(providerId)?.reader ?? null;
}

export function isTranscriptSupported(providerId: AgentProviderId): boolean {
  return Boolean(getProviderSessionCapability(providerId)?.reader);
}
