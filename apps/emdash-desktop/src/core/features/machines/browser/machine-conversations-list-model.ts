import { createListView, createTextMatcher } from '@emdash/ui/react/patterns';
import type { MachineConversationItem } from './machine-conversation-rows';

/**
 * The list-view state layer for the machine conversations list: sync source fed
 * by a reactive getter (the component wraps query data in an observable box so
 * the pipeline re-derives) plus immediate client-side search across the title,
 * provider, workspace path, and resolved link names.
 */
export function createMachineConversationsListView(getItems: () => MachineConversationItem[]) {
  return createListView({
    getItemId: (item: MachineConversationItem) => item.conversation.id,
    source: { kind: 'sync', items: getItems },
    search: {
      kind: 'sync',
      predicate: createTextMatcher(({ conversation }: MachineConversationItem) => [
        conversation.title,
        conversation.provider ?? '',
        conversation.workspacePath ?? '',
        conversation.taskName ?? '',
        conversation.projectName ?? '',
      ]),
    },
  });
}

export type MachineConversationsListViewModel = ReturnType<
  typeof createMachineConversationsListView
>;
