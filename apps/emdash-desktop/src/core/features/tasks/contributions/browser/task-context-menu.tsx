import { ContextMenu, toast } from '@emdash/ui/react/primitives';
import { Archive, Copy, MessageSquare, Pencil, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import React from 'react';

interface TaskContextMenuProps {
  children: React.ReactNode;
  isPinned: boolean;
  canPin: boolean;
  isArchived: boolean;
  archiveDisabledReason?: string;
  branchName?: string;
  onPin: () => void;
  onUnpin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRestore?: () => void;
  onReconnect?: () => void;
  onConvertAutomation?: () => void;
  onDelete: () => void;
}

export function TaskContextMenu({
  children,
  isPinned,
  canPin,
  isArchived,
  archiveDisabledReason,
  branchName,
  onPin,
  onUnpin,
  onRename,
  onArchive,
  onRestore,
  onReconnect,
  onConvertAutomation,
  onDelete,
}: TaskContextMenuProps) {
  const archiveDisabledReasonId = React.useId();
  const handleCopyBranchName = async () => {
    if (!branchName) return;

    try {
      await navigator.clipboard.writeText(branchName);
      toast('Branch name copied');
    } catch {
      toast.error('Copy failed', {
        description: 'The branch name could not be copied to the clipboard.',
      });
    }
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Content>
        {canPin &&
          (isPinned ? (
            <ContextMenu.Item onClick={onUnpin}>
              <PinOff className="size-4" />
              Unpin task
            </ContextMenu.Item>
          ) : (
            <ContextMenu.Item onClick={onPin}>
              <Pin className="size-4" />
              Pin task
            </ContextMenu.Item>
          ))}
        <ContextMenu.Item onClick={onRename}>
          <Pencil className="size-4" />
          Rename
        </ContextMenu.Item>
        {onReconnect && (
          <ContextMenu.Item onClick={onReconnect}>
            <RotateCcw className="size-4" />
            Reconnect
          </ContextMenu.Item>
        )}
        {onConvertAutomation && (
          <ContextMenu.Item onClick={onConvertAutomation}>
            <MessageSquare className="size-4" />
            Convert to regular task
          </ContextMenu.Item>
        )}
        {!isArchived && (
          <ContextMenu.Item
            disabled={!!archiveDisabledReason}
            aria-describedby={archiveDisabledReason ? archiveDisabledReasonId : undefined}
            onClick={onArchive}
          >
            <Archive className="size-4" />
            Archive
          </ContextMenu.Item>
        )}
        {archiveDisabledReason && (
          <span id={archiveDisabledReasonId} className="sr-only">
            {archiveDisabledReason}
          </span>
        )}
        {isArchived && onRestore && (
          <ContextMenu.Item onClick={onRestore}>
            <RotateCcw className="size-4" />
            Restore
          </ContextMenu.Item>
        )}
        {branchName && (
          <ContextMenu.Item onClick={() => void handleCopyBranchName()}>
            <Copy className="size-4" />
            Copy branch name
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
