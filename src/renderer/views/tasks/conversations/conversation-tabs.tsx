import { X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import AgentLogo from '@renderer/components/agent-logo';
import { Button } from '@renderer/components/ui/button';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { agentConfig } from '@renderer/lib/agentConfig';
import { cn } from '@renderer/lib/utils';
import { getTaskStore, provisionedTask } from '../task-view-state';

function InlineEditInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="max-w-16 bg-transparent outline-none text-xs"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onConfirm(value);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export const ConversationsTabs = observer(function ConversationsTabs({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const conversationMgr = provisionedTask(getTaskStore(projectId, taskId))?.conversations;
  const showCreateConversationModal = useShowModal('createConversationModal');

  const conversations = conversationMgr
    ? Array.from(conversationMgr.conversations.values()).map((c) => c.data)
    : [];
  const activeConversationId = conversationMgr?.tabs.activeTabId;
  const setActiveConversationId = (id: string) => conversationMgr?.tabs.setActiveTab(id);

  const activeId = activeConversationId ?? conversations[0]?.id ?? '';
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleRemoveConversation = useCallback(
    (conversationId: string) => {
      if (conversationMgr) {
        const session = makePtySessionId(projectId, taskId, conversationId);
        frontendPtyRegistry.unregister(session);
        void conversationMgr.deleteConversation(conversationId);
        if (activeConversationId === conversationId) {
          const index = conversations.findIndex((c) => c.id === conversationId);
          const nextId = conversations[index + 1]?.id ?? conversations[index - 1]?.id;
          if (nextId) setActiveConversationId(nextId);
        }
      }
    },
    [conversationMgr, projectId, taskId, activeConversationId, conversations]
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
                      void conversationMgr?.renameConversation(conversation.id, trimmed);
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
});
