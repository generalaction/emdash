import type { TabDescriptor, TaskViewSnapshot } from '@shared/view-state';

export function getConversationIdsForInitialHydration(
  snapshot: Partial<TaskViewSnapshot> | null | undefined
): Set<string> {
  const ids = new Set<string>();

  for (const tab of getSnapshotTabs(snapshot)) {
    if (tab.kind === 'conversation') ids.add(tab.conversationId);
  }

  if (snapshot?.conversations?.tabOrder) {
    for (const id of snapshot.conversations.tabOrder) ids.add(id);
  }

  return ids;
}

function getSnapshotTabs(snapshot: Partial<TaskViewSnapshot> | null | undefined): TabDescriptor[] {
  if (!snapshot) return [];
  if (snapshot.tabGroups) {
    return snapshot.tabGroups.groups.flatMap((group) => group.tabManager.tabs);
  }
  return snapshot.tabManager?.tabs ?? [];
}
