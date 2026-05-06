import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { agentConfig } from '@renderer/utils/agentConfig';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

const ConversationRow = observer(function ConversationRow({
  conversation,
  isActive,
  onClick,
}: {
  conversation: ConversationStore;
  isActive: boolean;
  onClick: () => void;
}) {
  const config = agentConfig[conversation.data.providerId];
  const title = formatConversationTitleForDisplay(
    conversation.data.providerId,
    conversation.data.title
  );

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background-1 ${
        isActive ? 'bg-background-2' : ''
      }`}
    >
      <span className="shrink-0">
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-4"
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
      <span className="shrink-0">
        <AgentStatusIndicator status={conversation.indicatorStatus} disableTooltip />
      </span>
    </button>
  );
});

export const SidebarConversationsList = observer(function SidebarConversationsList() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const conversationTabs = taskView.conversationTabs;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const conversations = Array.from(provisioned.conversations.conversations.values());

  const handleCreate = () => {
    showCreateConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        conversationTabs.setActiveTab(conversationId);
        taskView.setView('agents');
      },
    });
  };

  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <EmptyState
          label="No conversations yet"
          description="Create one to start working with an agent."
          action={
            <Button size="sm" variant="outline" onClick={handleCreate}>
              <Plus className="size-3.5" />
              New conversation
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      <div className="flex flex-col gap-0.5">
        {conversations.map((conversation) => (
          <ConversationRow
            key={conversation.data.id}
            conversation={conversation}
            isActive={
              taskView.view === 'agents' && conversationTabs.activeTabId === conversation.data.id
            }
            onClick={() => {
              conversationTabs.setActiveTab(conversation.data.id);
              taskView.setView('agents');
            }}
          />
        ))}
      </div>
      <div className="mt-auto pt-2">
        <Button size="sm" variant="ghost" className="w-full justify-start" onClick={handleCreate}>
          <Plus className="size-3.5" />
          New conversation
        </Button>
      </div>
    </div>
  );
});
