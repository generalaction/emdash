import { useDraggable } from '@dnd-kit/core';
import { Folder, Pencil, Trash2 } from 'lucide-react';
import { MultiLineListItem } from '@renderer/lib/components/multi-line-list-item';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import type { PromptLibraryFolder, PromptLibraryPrompt } from '@shared/prompt-library';
import { toPromptDndId } from './prompt-library-dnd';

function PromptRowActions({
  item,
  disabled,
  onEdit,
  onDelete,
}: {
  item: PromptLibraryPrompt;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
      <Button
        variant="ghost"
        size="icon-xs"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        disabled={disabled}
        aria-label={`Edit ${item.title}`}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={disabled}
        aria-label={`Delete ${item.title}`}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function PromptContextMenuContent({
  prompt,
  folders,
  onEdit,
  onDelete,
  onMoveToFolder,
}: {
  prompt: PromptLibraryPrompt;
  folders: PromptLibraryFolder[];
  onEdit: () => void;
  onDelete: () => void;
  onMoveToFolder: (folderId: string | undefined) => void;
}) {
  const otherFolders = folders.filter((folder) => folder.id !== prompt.folderId);

  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onEdit}>
        <Pencil className="size-4" />
        Edit
      </ContextMenuItem>
      {folders.length > 0 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Folder className="size-4" />
            <span className="flex-1">Move to folder</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {otherFolders.map((folder) => (
              <ContextMenuItem key={folder.id} onClick={() => onMoveToFolder(folder.id)}>
                {folder.title}
              </ContextMenuItem>
            ))}
            {prompt.folderId ? (
              <>
                {otherFolders.length > 0 ? <ContextMenuSeparator /> : null}
                <ContextMenuItem onClick={() => onMoveToFolder(undefined)}>
                  Remove from folder
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 className="size-4" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

export function PromptLibraryPromptRow({
  prompt,
  folders,
  disabled,
  onEdit,
  onDelete,
  onMoveToFolder,
  className,
  isLast,
}: {
  prompt: PromptLibraryPrompt;
  folders: PromptLibraryFolder[];
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveToFolder: (folderId: string | undefined) => void;
  className?: string;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: toPromptDndId(prompt.id),
    disabled,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full outline-none focus:outline-none focus-visible:outline-none">
        <MultiLineListItem
          isLast={isLast}
          className={cn(
            'py-3 outline-none ring-0 focus-within:outline-none focus-within:ring-0',
            className
          )}
        >
          <div
            ref={setNodeRef}
            className={cn(
              'group flex w-full outline-none focus:outline-none focus-visible:outline-none',
              !disabled && 'cursor-grab active:cursor-grabbing',
              isDragging && 'opacity-40'
            )}
            {...(!disabled ? listeners : undefined)}
            {...(!disabled ? attributes : undefined)}
          >
            <div
              role="button"
              tabIndex={disabled ? -1 : 0}
              className="min-w-0 flex-1 rounded-sm text-left outline-none focus:outline-none focus-visible:outline-none"
              onClick={onEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onEdit();
                }
              }}
            >
              <div className="text-md truncate text-foreground">{prompt.title}</div>
              <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-foreground-muted">
                {prompt.prompt}
              </div>
            </div>
            <PromptRowActions
              item={prompt}
              disabled={disabled}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        </MultiLineListItem>
      </ContextMenuTrigger>
      <PromptContextMenuContent
        prompt={prompt}
        folders={folders}
        onEdit={onEdit}
        onDelete={onDelete}
        onMoveToFolder={onMoveToFolder}
      />
    </ContextMenu>
  );
}
