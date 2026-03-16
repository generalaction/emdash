import { X } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import AgentLogo from '@renderer/components/AgentLogo';
import { Button } from '@renderer/components/ui/button';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { useConversationsContext } from '@renderer/features/conversations/conversation-data-provider';
import { agentConfig } from '@renderer/lib/agentConfig';
import { cn } from '@renderer/lib/utils';
import { useTaskViewContext } from '../task-view-wrapper';

export function ConversationsTabs({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { conversationsByTaskId, deleteConversation } = useConversationsContext();
  const { activeConversationId, setActiveConversationId } = useTaskViewContext();
  const showCreateConversationModal = useShowModal('createConversationModal');

  const conversations = useMemo(
    () => conversationsByTaskId[taskId] ?? [],
    [conversationsByTaskId, taskId]
  );

  const activeId = activeConversationId ?? conversations[0]?.id ?? '';

  const handleRemoveConversation = useCallback(
    (conversationId: string) => {
      deleteConversation({ projectId, taskId, conversationId });
      if (activeConversationId === conversationId) {
        const index = conversations.findIndex((c) => c.id === conversationId);
        const nextId = conversations[index + 1]?.id ?? conversations[index - 1]?.id ?? '';
        setActiveConversationId(nextId);
      }
    },
    [
      deleteConversation,
      activeConversationId,
      conversations,
      setActiveConversationId,
      projectId,
      taskId,
    ]
  );

  return (
    <div className="flex gap-2 justify-between p-2">
      <div className="flex gap-1">
        {conversations.map((conversation) => {
          const config = agentConfig[conversation.providerId];
          return (
            <button
              key={conversation.id}
              onClick={() => setActiveConversationId(conversation.id)}
              className={cn(
                'group px-2 text-sm border border-border rounded-md hover:bg-muted flex items-center gap-1.5 relative',
                activeId === conversation.id && 'bg-muted'
              )}
            >
              {config.logo && (
                <AgentLogo
                  logo={config.logo}
                  alt={config.alt}
                  isSvg={config.isSvg}
                  invertInDark={config.invertInDark}
                  className="h-3.5 w-3.5"
                />
              )}
              <span className="max-w-16 truncate">{conversation.title}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute opacity-0 group-hover:opacity-100 bg-muted right-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveConversation(conversation.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </button>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          showCreateConversationModal({
            projectId,
            taskId,
            onSuccess: ({ conversationId }) => setActiveConversationId(conversationId),
          })
        }
      >
        Create
      </Button>
    </div>
  );
}
