import { Archive, Copy, Pencil, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import React from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';

interface TaskContextMenuProps {
  children: React.ReactNode;
  isPinned: boolean;
  canPin: boolean;
  isArchived: boolean;
  branchName?: string;
  onPin: () => void;
  onUnpin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRestore?: () => void;
  onReconnect?: () => void;
  onDelete: () => void;
}

export function TaskContextMenu({
  children,
  isPinned,
  canPin,
  isArchived,
  branchName,
  onPin,
  onUnpin,
  onRename,
  onArchive,
  onRestore,
  onReconnect,
  onDelete,
}: TaskContextMenuProps) {
  const handleCopyBranchName = async () => {
    if (!branchName) return;

    try {
      await navigator.clipboard.writeText(branchName);
      toast({ title: 'Branch name copied' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'The branch name could not be copied to the clipboard.',
        variant: 'destructive',
      });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {canPin &&
          (isPinned ? (
            <ContextMenuItem onClick={onUnpin}>
              <PinOff className="size-4" />
              Unpin task
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={onPin}>
              <Pin className="size-4" />
              Pin task
            </ContextMenuItem>
          ))}
        <ContextMenuItem onClick={onRename}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
        {onReconnect && (
          <ContextMenuItem onClick={onReconnect}>
            <RotateCcw className="size-4" />
            Reconnect
          </ContextMenuItem>
        )}
        {!isArchived && (
          <ContextMenuItem onClick={onArchive}>
            <Archive className="size-4" />
            Archive
          </ContextMenuItem>
        )}
        {isArchived && onRestore && (
          <ContextMenuItem onClick={onRestore}>
            <RotateCcw className="size-4" />
            Restore
          </ContextMenuItem>
        )}
        {branchName && (
          <ContextMenuItem onClick={() => void handleCopyBranchName()}>
            <Copy className="size-4" />
            Copy branch name
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
