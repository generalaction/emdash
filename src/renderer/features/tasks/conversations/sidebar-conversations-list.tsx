import { useVirtualizer } from '@tanstack/react-virtual';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import {
  useConversations,
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
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
  conversationId,
}: {
  conversationId: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const pendingRenameRef = useRef(false);
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const { tabManager, tabGroupManager } = taskView;
  const showConfirm = useShowModal('confirmActionModal');

  const handleRenameInputRef = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
    input?.select();
  }, []);

  const handleRename = useCallback(() => {
    pendingRenameRef.current = true;
  }, []);

  const handleContextMenuOpenChangeComplete = useCallback((open: boolean) => {
    if (!open && pendingRenameRef.current) {
      pendingRenameRef.current = false;
      setIsEditing(true);
    }
  }, []);

  const conversation = conversations.conversations.get(conversationId);
  if (!conversation) return null;

  const isActive = tabManager.activeConversationId === conversationId;
  const config = agentConfig[conversation.data.providerId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.data.providerId,
    conversation.data.title
  );
  const rawTitle = conversation.data.title ?? '';

  const handleRenameSubmit = (newTitle: string) => {
    setIsEditing(false);
    void conversations.renameConversation(conversationId, newTitle);
  };

  const handleDelete = () => {
    showConfirm({
      title: 'Delete conversation',
      description: `"${displayTitle}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        void conversations.deleteConversation(conversationId);
      },
    });
  };

  if (isEditing) {
    return (
      <div className="flex h-full w-full items-center px-2">
        <input
          ref={handleRenameInputRef}
          className="w-full rounded bg-background-1 px-1.5 py-0.5 text-sm text-foreground outline-none ring-1 ring-foreground/20 focus:ring-foreground/40"
          defaultValue={rawTitle}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value && value !== rawTitle) {
              handleRenameSubmit(value);
            } else {
              setIsEditing(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const value = e.currentTarget.value.trim();
              if (value && value !== rawTitle) {
                handleRenameSubmit(value);
              } else {
                setIsEditing(false);
              }
            } else if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <ContextMenu onOpenChangeComplete={handleContextMenuOpenChangeComplete}>
      <ContextMenuTrigger>
        <button
          onClick={() => tabGroupManager.openConversationPreview(conversationId)}
          onDoubleClick={() => tabGroupManager.openConversation(conversationId)}
          className={cn(
            'flex w-full items-center gap-2 h-8 rounded-md px-2 text-left text-sm text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
            isActive && 'bg-background-2 text-foreground hover:bg-background-2'
          )}
        >
          {config ? (
            <span className="shrink-0">
              <AgentLogo
                logo={config.logo}
                alt={config.alt}
                isSvg={config.isSvg}
                invertInDark={config.invertInDark}
                className="size-4"
              />
            </span>
          ) : null}
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
        <ContextMenuItem onClick={handleRename}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={handleDelete}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export const SidebarConversationsList = observer(function SidebarConversationsList() {
  const { projectId, taskId } = useTaskViewContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const { tabGroupManager } = taskView;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const conversationIds = Array.from(conversations.conversations.values())
    .sort((a, b) => {
      const aTime = a.data.lastInteractedAt ? new Date(a.data.lastInteractedAt).getTime() : 0;
      const bTime = b.data.lastInteractedAt ? new Date(b.data.lastInteractedAt).getTime() : 0;
      return bTime - aTime;
    })
    .map((c) => c.data.id);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: conversationIds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const handleCreate = () => {
    showCreateConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        tabGroupManager.openConversation(conversationId);
      },
    });
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
            const conversationId = conversationIds[virtualItem.index]!;
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
                <ConversationRow conversationId={conversationId} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
