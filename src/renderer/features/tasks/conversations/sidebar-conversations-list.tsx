import { useVirtualizer } from '@tanstack/react-virtual';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import { type ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { MicroLabel } from '@renderer/lib/ui/label';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

const ROW_HEIGHT = 32;

const ConversationRow = observer(function ConversationRow({
  conversation,
  isActive,
  isEditing,
  onClick,
  onDoubleClick,
  onStartEditing,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
}: {
  conversation: ConversationStore;
  isActive: boolean;
  isEditing: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onStartEditing: () => void;
  onRenameSubmit: (newTitle: string) => void;
  onRenameCancel: () => void;
  onDelete: () => void;
}) {
  const config = agentConfig[conversation.data.providerId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.data.providerId,
    conversation.data.title
  );
  const rawTitle = conversation.data.title ?? '';

  if (isEditing) {
    return (
      <div className="flex h-full w-full items-center px-2">
        <input
          className="w-full rounded bg-background-1 px-1.5 py-0.5 text-sm text-foreground outline-none ring-1 ring-foreground/20 focus:ring-foreground/40"
          defaultValue={rawTitle}
          autoFocus
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value && value !== rawTitle) {
              onRenameSubmit(value);
            } else {
              onRenameCancel();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const value = e.currentTarget.value.trim();
              if (value && value !== rawTitle) {
                onRenameSubmit(value);
              } else {
                onRenameCancel();
              }
            } else if (e.key === 'Escape') {
              onRenameCancel();
            }
          }}
        />
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            'flex w-full items-center gap-2 h-8 rounded-md px-2 text-left text-sm text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
            isActive && 'bg-background-2 text-foreground hover:bg-background-2'
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
          <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
          <span className="shrink-0">
            {conversation.indicatorStatus ? (
              <AgentStatusIndicator status={conversation.indicatorStatus} disableTooltip />
            ) : (
              <RelativeTime
                value={conversation.data.lastInteractedAt ?? ''}
                className="text-xs text-foreground-passive font-mono pr-1 h-full flex items-center"
                compact
              />
            )}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onStartEditing}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export const SidebarConversationsList = observer(function SidebarConversationsList() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const { tabManager } = taskView;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const showConfirm = useShowModal('confirmActionModal');
  const conversations = Array.from(provisioned.conversations.conversations.values()).sort(
    (a, b) => {
      const aTime = a.data.lastInteractedAt ? new Date(a.data.lastInteractedAt).getTime() : 0;
      const bTime = b.data.lastInteractedAt ? new Date(b.data.lastInteractedAt).getTime() : 0;
      return bTime - aTime;
    }
  );

  const [editingId, setEditingId] = useState<string | null>(null);

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

  const handleDelete = (conversation: ConversationStore) => {
    const title = formatConversationTitleForDisplay(
      conversation.data.providerId,
      conversation.data.title
    );
    showConfirm({
      title: 'Delete conversation',
      description: `"${title}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        void provisioned.conversations.deleteConversation(conversation.data.id);
      },
    });
  };

  const handleRenameSubmit = (conversation: ConversationStore, newTitle: string) => {
    setEditingId(null);
    void provisioned.conversations.renameConversation(conversation.data.id, newTitle);
  };

  return (
    <div className="flex h-full flex-col w-full">
      <div className="shrink-0 pl-4 pr-2 pt-2 pb-1 flex items-center justify-between">
        <MicroLabel>Conversations</MicroLabel>
        <Button size="icon-sm" variant="ghost" onClick={handleCreate}>
          <Plus className="size-3.5" />
        </Button>
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
                  isActive={tabManager.activeConversationId === conversation.data.id}
                  isEditing={editingId === conversation.data.id}
                  onClick={() => tabManager.openConversationPreview(conversation.data.id)}
                  onDoubleClick={() => tabManager.openConversation(conversation.data.id)}
                  onStartEditing={() => setEditingId(conversation.data.id)}
                  onRenameSubmit={(newTitle) => handleRenameSubmit(conversation, newTitle)}
                  onRenameCancel={() => setEditingId(null)}
                  onDelete={() => handleDelete(conversation)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
