import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import AgentLogo from '@renderer/components/agent-logo';
import { Button } from '@renderer/components/ui/button';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { agentConfig } from '@renderer/lib/agentConfig';
import { cn } from '@renderer/lib/utils';
import { useTaskViewContext } from '../task-view-context';

const MAX_TITLE_LENGTH = 64;

export function ConversationsTabs({ projectId, taskId }: { projectId: string; taskId: string }) {
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    removeConversation,
    renameConversation,
  } = useTaskViewContext();
  const showCreateConversationModal = useShowModal('createConversationModal');

  const activeId = activeConversationId ?? conversations[0]?.id ?? '';
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleRemoveConversation = useCallback(
    (conversationId: string) => {
      removeConversation(conversationId);
      if (activeConversationId === conversationId) {
        const index = conversations.findIndex((c) => c.id === conversationId);
        const nextId = conversations[index + 1]?.id ?? conversations[index - 1]?.id ?? '';
        setActiveConversationId(nextId);
      }
    },
    [activeConversationId, conversations, removeConversation, setActiveConversationId]
  );

  return (
    <div className="flex gap-2 justify-between p-2">
      <div className="flex gap-1 overflow-x-auto">
        {conversations.map((conversation) => {
          const config = agentConfig[conversation.providerId];
          return (
            <button
              key={conversation.id}
              onClick={() => setActiveConversationId(conversation.id)}
              onDoubleClick={() => setEditingId(conversation.id)}
              className={cn(
                'group px-2.5 text-xs border border-border rounded-md hover:bg-muted flex items-center gap-1.5 relative',
                activeId === conversation.id && 'bg-muted'
              )}
            >
              {config.logo && (
                <AgentLogo
                  logo={config.logo}
                  alt={config.alt}
                  isSvg={config.isSvg}
                  invertInDark={config.invertInDark}
                  className="h-3 w-3"
                />
              )}
              {editingId === conversation.id ? (
                <InlineEditInput
                  initialValue={conversation.title}
                  onConfirm={(newTitle) => {
                    setEditingId(null);
                    const trimmed = newTitle.trim();
                    if (trimmed && trimmed !== conversation.title) {
                      renameConversation({ conversationId: conversation.id, newTitle: trimmed });
                    }
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span className="max-w-16 truncate">{conversation.title}</span>
              )}
              {editingId !== conversation.id && (
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
              )}
            </button>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="xs"
        className="h-7 px-2.5"
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

function InlineEditInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      autoFocus
      type="text"
      defaultValue={initialValue}
      maxLength={MAX_TITLE_LENGTH}
      className="bg-transparent outline-none border-none text-xs w-16 p-0"
      onBlur={(e) => onConfirm(e.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
