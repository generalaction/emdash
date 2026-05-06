import { AGENT_PROVIDER_IDS, type AgentProviderId } from './agent-provider-registry';

const CONV_SEP = '-conv-';

// Legacy separators — used only for snapshot migration fallback lookups.
const LEGACY_MAIN_SEP = '-main-';
const LEGACY_CHAT_SEP = '-chat-';

export function makePtyId(provider: AgentProviderId | 'shell', conversationId: string): string {
  return `${provider}${CONV_SEP}${conversationId}`;
}

export function parsePtyId(id: string): {
  providerId: AgentProviderId | 'shell';
  conversationId: string;
} | null {
  // Try 'shell' sentinel first, then all known provider IDs longest-first to avoid prefix collisions.
  const candidates: Array<AgentProviderId | 'shell'> = [
    'shell',
    ...[...AGENT_PROVIDER_IDS].sort((a, b) => b.length - a.length),
  ];
  for (const pid of candidates) {
    const prefix = pid + CONV_SEP;
    if (id.startsWith(prefix)) {
      return { providerId: pid, conversationId: id.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Try to parse a legacy PTY ID (pre-refactor format: {prov}-main-{taskId} or {prov}-chat-{convId}).
 * Used only by TerminalSnapshotService for one-time fallback lookups on existing snapshots.
 */
export function parseLegacyPtyId(id: string): {
  providerId: AgentProviderId;
  kind: 'main' | 'chat';
  suffix: string;
} | null {
  const sorted = [...AGENT_PROVIDER_IDS].sort((a, b) => b.length - a.length);
  for (const pid of sorted) {
    if (id.startsWith(pid + LEGACY_MAIN_SEP)) {
      return {
        providerId: pid,
        kind: 'main',
        suffix: id.slice(pid.length + LEGACY_MAIN_SEP.length),
      };
    }
    if (id.startsWith(pid + LEGACY_CHAT_SEP)) {
      return {
        providerId: pid,
        kind: 'chat',
        suffix: id.slice(pid.length + LEGACY_CHAT_SEP.length),
      };
    }
  }
  return null;
}
