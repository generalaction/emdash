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
import { MAX_CONVERSATION_TITLE_LENGTH } from '@shared/conversations';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

const ROW_HEIGHT = 32;

const ConversationRow = observer(function ConversationRow({
  conversationId,
}: {
  conversationId: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const committedRef = useRef(false);
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const { tabManager, tabGroupManager } = taskView;
  const showConfirm = useShowModal('confirmActionModal');

  const handleRenameInputRef = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
    input?.select();
  }, []);

  const handleRename = useCallback(() => {
    committedRef.current = false;
    window.setTimeout(() => setIsEditing(true), 0);
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
  const commitRename = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim().slice(0, MAX_CONVERSATION_TITLE_LENGTH);
    if (trimmed && trimmed !== rawTitle) {
      handleRenameSubmit(trimmed);
    } else {
      setIsEditing(false);
    }
  };

  const handleRenameSubmit = (newTitle: string) => {
    setIsEditing(false);
    void conversations.renameConversation(conversationId, newTitle);
  };

  const handleDoubleClick = () => {
    tabGroupManager.openConversation(conversationId);
    handleRename();
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

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          role="button"
          tabIndex={0}
          onClick={() => tabGroupManager.openConversationPreview(conversationId)}
          onDoubleClick={handleDoubleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              tabGroupManager.openConversationPreview(conversationId);
            }
          }}
          className={cn(
            'flex w-full items-center gap-2 h-8 rounded-md px-2 text-left text-sm text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
            isActive && 'bg-background-2 text-foreground hover:bg-background-2'
          )}
        >
          {config ? (
            <span className="flex size-4 shrink-0 items-center justify-center">
              <AgentLogo
                logo={config.logo}
                logoDark={config.logoDark}
                alt={config.alt}
                isSvg={config.isSvg}
                invertInDark={config.invertInDark}
                className="block size-4"
              />
            </span>
          ) : null}
          {isEditing ? (
            <input
              ref={handleRenameInputRef}
              className="min-w-0 flex-1 rounded bg-background-1 px-1.5 py-0.5 text-sm text-foreground ring-1 ring-foreground/20 outline-none focus:ring-foreground/40"
              defaultValue={rawTitle}
              maxLength={MAX_CONVERSATION_TITLE_LENGTH}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onBlur={(e) => commitRename(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename(e.currentTarget.value);
                else if (e.key === 'Escape') {
                  committedRef.current = true;
                  setIsEditing(false);
                }
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
          )}
          <span className="shrink-0">
            {conversation.indicatorStatus ? (
              <AgentStatusIndicator status={conversation.indicatorStatus} disableTooltip />
            ) : (
              <RelativeTime
                value={conversation.data.lastInteractedAt ?? ''}
                className="flex h-full items-center pr-1 font-mono text-xs text-foreground-passive"
                compact
              />
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent finalFocus={false}>
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
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between pt-2 pr-2 pb-1 pl-4">
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
