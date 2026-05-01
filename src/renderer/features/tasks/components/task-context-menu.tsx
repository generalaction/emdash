import { Archive, Pencil, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import React from 'react';
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
  onPin,
  onUnpin,
  onRename,
  onArchive,
  onRestore,
  onReconnect,
  onDelete,
}: TaskContextMenuProps) {
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
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
