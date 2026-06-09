import { useVirtualizer } from '@tanstack/react-virtual';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import {
  useConversations,
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { useMultiSelect } from '@renderer/lib/hooks/use-multi-select';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
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
import { MAX_CONVERSATION_TITLE_LENGTH } from '@shared/core/conversations/conversations';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

const ROW_HEIGHT = 32;
const getConversationId = (id: string) => id;

const ConversationRow = observer(function ConversationRow({
  conversationId,
  isSelected,
  hasSelection,
  onToggleSelect,
}: {
  conversationId: string;
  isSelected: boolean;
  hasSelection: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
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
    if (hasSelection) return;
    tabGroupManager.openConversation(conversationId);
    handleRename();
  };

  const handleRowClick = (shiftKey: boolean) => {
    if (shiftKey || hasSelection) {
      onToggleSelect(shiftKey);
      return;
    }
    tabGroupManager.openConversationPreview(conversationId);
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
          onClick={(e) => handleRowClick(e.shiftKey)}
          onDoubleClick={handleDoubleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleRowClick(e.shiftKey);
            }
          }}
          className={cn(
            'group flex w-full items-center gap-2 h-8 rounded-md px-2 text-left text-sm text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
            isActive && 'bg-background-2 text-foreground hover:bg-background-2',
            isSelected && 'bg-background-2 text-foreground hover:bg-background-2'
          )}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'shrink-0 transition-opacity',
              isSelected || hasSelection
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
            )}
          >
            <Checkbox
              checked={isSelected}
              onClick={(e) => onToggleSelect(e.shiftKey)}
              aria-label="Select conversation"
            />
          </div>
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

function SelectionBar({
  count,
  onClear,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
}) {
  if (count === 0) return null;

  return (
    <ListPopoverCard className="justify-between">
      <span className="whitespace-nowrap text-foreground-muted">{count} selected</span>
      <div className="flex items-center gap-2">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="size-3.5" />
          Delete
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClear} aria-label="Clear selection">
          <X className="size-3.5" />
        </Button>
      </div>
    </ListPopoverCard>
  );
}

export const SidebarConversationsList = observer(function SidebarConversationsList() {
  const { projectId, taskId } = useTaskViewContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const { tabGroupManager } = taskView;
  const showConfirm = useShowModal('confirmActionModal');
  const showCreateConversationModal = useShowModal('createConversationModal');
  const conversationIds = Array.from(conversations.conversations.values())
    .sort((a, b) => {
      const aTime = a.data.lastInteractedAt ? new Date(a.data.lastInteractedAt).getTime() : 0;
      const bTime = b.data.lastInteractedAt ? new Date(b.data.lastInteractedAt).getTime() : 0;
      return bTime - aTime;
    })
    .map((c) => c.data.id);
  const {
    selectedIds,
    selectedCount,
    selectedOrderedIds: selectedConversationIds,
    clear: clearSelection,
    toggle: toggleSelect,
  } = useMultiSelect({ items: conversationIds, getId: getConversationId });

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: conversationIds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const handleBulkDelete = () => {
    const ids = selectedConversationIds;
    if (ids.length === 0) return;

    showConfirm({
      title: ids.length === 1 ? 'Delete conversation' : 'Delete conversations',
      description:
        ids.length === 1
          ? '1 conversation will be permanently deleted. This action cannot be undone.'
          : `${ids.length} conversations will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        ids.forEach((id) => void conversations.deleteConversation(id));
        clearSelection();
      },
    });
  };

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
    <div className="relative flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between pt-2 pr-2 pb-1 pl-4">
        <MicroLabel>Conversations</MicroLabel>
        <Button size="icon-sm" variant="ghost" onClick={handleCreate}>
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div
        ref={parentRef}
        className={cn('min-h-0 flex-1 overflow-y-auto px-2', selectedCount > 0 && 'pb-20')}
      >
        <div
          style={{
            height: virtualizer.getTotalSize() + (selectedCount > 0 ? 80 : 0),
            position: 'relative',
          }}
        >
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
                <ConversationRow
                  conversationId={conversationId}
                  isSelected={selectedIds.has(conversationId)}
                  hasSelection={selectedCount > 0}
                  onToggleSelect={(shiftKey) => toggleSelect(conversationId, { range: shiftKey })}
                />
              </div>
            );
          })}
        </div>
      </div>

      <SelectionBar count={selectedCount} onClear={clearSelection} onDelete={handleBulkDelete} />
    </div>
  );
});
