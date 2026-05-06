import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { type ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { agentConfig } from '@renderer/utils/agentConfig';
import { AgentStatusIndicator } from '../components/agent-status-indicator';
import { cn } from '@renderer/utils/utils';

const ROW_HEIGHT = 32

const ConversationRow = observer(function ConversationRow({
  conversation,
  isActive,
  onClick,
  onDoubleClick,
}: {
  conversation: ConversationStore;
  isActive: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const config = agentConfig[conversation.data.providerId];
  const title = formatConversationTitleForDisplay(
    conversation.data.providerId,
    conversation.data.title
  );

  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background-1 text-foreground-muted hover:text-foreground transition-colors", 
        isActive && 'bg-background-2 hover:bg-background-2 text-foreground' 
      )}
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
      <span className="min-w-0 flex-1 truncate">{title}</span>
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
  const { tabManager } = taskView;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const conversations = Array.from(provisioned.conversations.conversations.values());

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const handleCreate = () => {
    showCreateConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        tabManager.openConversation(conversationId);
      },
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-2 pt-2 pb-1">
        <MicroLabel>Conversations</MicroLabel>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-2">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const conversation = conversations[virtualItem.index]!;
            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <ConversationRow
                  conversation={conversation}
                  isActive={
                    taskView.view === 'agents' &&
                    tabManager.activeConversation?.data.id === conversation.data.id
                  }
                  onClick={() => tabManager.openConversationPreview(conversation.data.id)}
                  onDoubleClick={() => tabManager.openConversation(conversation.data.id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 px-2 py-2">
        <Button size="sm" variant="ghost" className="w-full justify-start" onClick={handleCreate}>
          <Plus className="size-3.5" />
          New conversation
        </Button>
      </div>
    </div>
  );
});
