import { AgentProviderId } from '@shared/agent-provider-registry';

type ConversationTitleInput = {
  providerId: AgentProviderId;
  title: string;
};

function parseDefaultTitleIndex(title: string, providerId: AgentProviderId): number | null {
  const prefix = `${providerId} (`;
  if (!title.startsWith(prefix) || !title.endsWith(')')) return null;

  const rawIndex = title.slice(prefix.length, -1);
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 1) return null;
  if (String(index) !== rawIndex) return null;
  return index;
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

  return `${providerId} (${next})`;
}
