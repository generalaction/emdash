import { agentConfig } from './agentConfig';

export interface ConversationTabTitleInput {
  id: string;
  title: string;
  provider?: string | null;
  createdAt: string;
  displayOrder?: number;
}

export interface ConversationTitleUpdate {
  id: string;
  title: string;
}

const LEGACY_TITLES = new Set(['Default Conversation']);
const LEGACY_CHAT_TITLE = /^Chat \d+$/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getManagedTitleMatch(title: string, agentName: string): RegExpMatchArray | null {
  return title.match(new RegExp(`^${escapeRegex(agentName)}(?: (\\d+))?$`));
}

function isLegacyTitle(title: string): boolean {
  return LEGACY_TITLES.has(title) || LEGACY_CHAT_TITLE.test(title);
}

function sortByCreationOrder(
  a: Pick<ConversationTabTitleInput, 'createdAt' | 'displayOrder' | 'id'>,
  b: Pick<ConversationTabTitleInput, 'createdAt' | 'displayOrder' | 'id'>
): number {
  const createdDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdDiff !== 0) return createdDiff;

  const orderA = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;

  return a.id.localeCompare(b.id);
}

function getNextOrdinal(assigned: Set<number>, startAt: number): number {
  let next = startAt;
  while (assigned.has(next)) next += 1;
  return next;
}

export function getConversationAgentName(provider?: string | null): string {
  const providerId = (provider ?? 'claude') as keyof typeof agentConfig;
  return agentConfig[providerId]?.name ?? provider ?? 'Claude Code';
}

export function getConversationTabLabel(conversation: {
  title: string;
  provider?: string | null;
}): string {
  const fallback = getConversationAgentName(conversation.provider);
  const title = conversation.title?.trim();
  if (!title || isLegacyTitle(title)) return fallback;
  return title;
}

export function planConversationTitleUpdates(
  conversations: ConversationTabTitleInput[]
): ConversationTitleUpdate[] {
  const grouped = new Map<string, ConversationTabTitleInput[]>();

  for (const conversation of conversations) {
    const providerKey = conversation.provider ?? 'claude';
    const existing = grouped.get(providerKey);
    if (existing) {
      existing.push(conversation);
    } else {
      grouped.set(providerKey, [conversation]);
    }
  }

  const updates: ConversationTitleUpdate[] = [];

  for (const [providerKey, group] of grouped) {
    const agentName = getConversationAgentName(providerKey);
    const ordered = [...group].sort(sortByCreationOrder);
    const assignedOrdinals = new Set<number>();

    for (const conversation of ordered) {
      const match = getManagedTitleMatch(conversation.title, agentName);
      const ordinal = match?.[1] ? Number(match[1]) : null;
      if (ordinal && Number.isFinite(ordinal)) {
        assignedOrdinals.add(ordinal);
      }
    }

    let nextOrdinal = assignedOrdinals.size > 0 ? Math.max(...assignedOrdinals) + 1 : 1;
    const multipleForProvider = ordered.length > 1;

    for (const conversation of ordered) {
      const title = conversation.title?.trim() ?? '';
      const match = getManagedTitleMatch(title, agentName);
      const explicitOrdinal = match?.[1] ? Number(match[1]) : null;
      const isManagedUnnumbered = Boolean(match && !match[1]);
      const legacy = isLegacyTitle(title);

      let desiredTitle = title;

      if (multipleForProvider) {
        if (explicitOrdinal && Number.isFinite(explicitOrdinal)) {
          desiredTitle = `${agentName} ${explicitOrdinal}`;
        } else if (isManagedUnnumbered) {
          const ordinal = assignedOrdinals.has(1)
            ? getNextOrdinal(assignedOrdinals, nextOrdinal)
            : 1;
          assignedOrdinals.add(ordinal);
          if (ordinal >= nextOrdinal) nextOrdinal = ordinal + 1;
          desiredTitle = `${agentName} ${ordinal}`;
        } else if (legacy) {
          const ordinal = getNextOrdinal(assignedOrdinals, nextOrdinal);
          assignedOrdinals.add(ordinal);
          nextOrdinal = ordinal + 1;
          desiredTitle = `${agentName} ${ordinal}`;
        }
      } else if (legacy) {
        desiredTitle = agentName;
      }

      if (desiredTitle !== title) {
        updates.push({ id: conversation.id, title: desiredTitle });
      }
    }
  }

  return updates;
}
