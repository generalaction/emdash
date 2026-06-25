import { getProvider, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';

type ConversationTitleInput = {
  providerId: AgentProviderId;
  title: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDefaultTitlePrefix(providerId: AgentProviderId): string {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Missing provider definition for "${providerId}"`);
  }
  return provider.name;
}

function parseDefaultTitleIndex(title: string, providerId: AgentProviderId): number | null {
  const defaultTitlePrefix = getDefaultTitlePrefix(providerId);
  const prefixes =
    defaultTitlePrefix.toLowerCase() === providerId.toLowerCase()
      ? [providerId]
      : [providerId, defaultTitlePrefix];
  const pattern = prefixes.map(escapeRegExp).join('|');
  const match = title.match(new RegExp(`^(?:${pattern}) \\(([1-9]\\d*)\\)$`, 'i'));
  if (!match) return null;

  const rawIndex = match[1];
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 1) return null;
  if (String(index) !== rawIndex) return null;
  return index;
}

export function formatConversationTitleForDisplay(
  providerId: AgentProviderId,
  title: string
): string {
  const index = parseDefaultTitleIndex(title, providerId);
  if (index === null) return title;
  return `${getDefaultTitlePrefix(providerId)} (${index})`;
}

export function nextDefaultConversationTitle(
  providerId: AgentProviderId,
  conversations: ConversationTitleInput[]
): string {
  const used = new Set<number>();

  for (const conversation of conversations) {
    if (conversation.providerId !== providerId) continue;
    const index = parseDefaultTitleIndex(conversation.title, providerId);
    if (index !== null) used.add(index);
  }

  let next = 1;
  while (used.has(next)) next += 1;

  return `${getDefaultTitlePrefix(providerId)} (${next})`;
}
