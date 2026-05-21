import type { Conversation } from '@shared/conversations';
import type { Terminal } from '@shared/terminals';
import type { TabDescriptor, TaskViewSnapshot } from '@shared/view-state';

export function pickConversationsForHydration(
  conversations: Conversation[],
  snapshot: Partial<TaskViewSnapshot> | null
): Conversation[] {
  if (conversations.length <= 1) return conversations;

  const openConversationIds = getOpenConversationIds(snapshot);
  if (openConversationIds.size > 0) {
    const openConversations = conversations.filter((conversation) =>
      openConversationIds.has(conversation.id)
    );
    if (openConversations.length > 0) return openConversations;
  }

  const byRecentInteraction = [...conversations].sort((a, b) => {
    const ta = Date.parse(a.lastInteractedAt ?? '') || 0;
    const tb = Date.parse(b.lastInteractedAt ?? '') || 0;
    if (tb !== ta) return tb - ta;
    return a.id.localeCompare(b.id);
  });

  return [byRecentInteraction[0]];
}

export function pickTerminalsForHydration(
  terminals: Terminal[],
  snapshot: Partial<TaskViewSnapshot> | null
): Terminal[] {
  if (terminals.length === 0) return [];
  if (terminals.length === 1) return terminals;

  const openTerminalIds = getOpenTerminalIds(snapshot);
  if (openTerminalIds.size > 0) {
    return terminals.filter((terminal) => openTerminalIds.has(terminal.id));
  }
  return [];
}

function getOpenConversationIds(snapshot: Partial<TaskViewSnapshot> | null): Set<string> {
  const ids = new Set<string>();
  for (const tab of getSnapshotTabs(snapshot)) {
    if (tab.kind === 'conversation') ids.add(tab.conversationId);
  }
  if (snapshot?.conversations?.tabOrder) {
    for (const id of snapshot.conversations.tabOrder) ids.add(id);
  }
  return ids;
}

function getOpenTerminalIds(snapshot: Partial<TaskViewSnapshot> | null): Set<string> {
  return new Set(snapshot?.terminals?.tabOrder ?? []);
}

function getSnapshotTabs(snapshot: Partial<TaskViewSnapshot> | null): TabDescriptor[] {
  if (!snapshot) return [];
  if (snapshot.tabGroups) {
    return snapshot.tabGroups.groups.flatMap((group) => group.tabManager.tabs);
  }
  return snapshot.tabManager?.tabs ?? [];
}
