import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GitBranch, ArrowUpRight, AlertCircle, Pencil, Pin, PinOff } from 'lucide-react';
import TaskDeleteButton from './TaskDeleteButton';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { ChangesBadge } from './TaskChanges';
import { Spinner } from './ui/spinner';
import { usePrStatus } from '../hooks/usePrStatus';
import { useTaskBusy } from '../hooks/useTaskBusy';
import PrPreviewTooltip from './PrPreviewTooltip';
import { normalizeTaskName, MAX_TASK_NAME_LENGTH } from '../lib/taskNames';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import { Archive } from 'lucide-react';

function stopPropagation(e: React.MouseEvent): void {
  e.stopPropagation();
}

interface Task {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running' | 'creating';
  agentId?: string;
  useWorktree?: boolean;
}

interface TaskItemProps {
  task: Task;
  onDelete?: () => void | Promise<void | boolean>;
  onRename?: (newName: string) => void | Promise<void>;
  onArchive?: () => void | Promise<void | boolean>;
  onPin?: () => void | Promise<void>;
  isPinned?: boolean;
  showDelete?: boolean;
  showDirectBadge?: boolean;
}

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onDelete,
  onRename,
  onArchive,
  onPin,
  isPinned,
  showDelete,
  showDirectBadge = true,
}) => {
  const { totalAdditions, totalDeletions, isLoading } = useTaskChanges(task.path, task.id);
  const { pr } = usePrStatus(task.path);
  const isRunning = useTaskBusy(task.id);

  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);

  const handleStartEdit = useCallback(() => {
    if (!onRename) return;
    setEditValue(task.name);
    isSubmittingRef.current = false;
    setIsEditing(true);
  }, [onRename, task.name]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditValue(task.name);
  }, [task.name]);

  const handleConfirmEdit = useCallback(async () => {
    // Prevent double calls from Enter + blur
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const normalized = normalizeTaskName(editValue);
    if (!normalized) {
      handleCancelEdit();
      return;
    }
    if (normalized === normalizeTaskName(task.name)) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    await onRename?.(normalized);
  }, [editValue, task.name, onRename, handleCancelEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelEdit();
      }
    },
    [handleConfirmEdit, handleCancelEdit]
  );

  useEffect(() => {
    if (isEditing && inputRef.current) {
      // Small delay to ensure context menu has closed and input is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  const taskContent = (
    <div className="flex min-w-0 items-center justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
        {isRunning || task.status === 'running' || task.status === 'creating' ? (
          <Spinner size="sm" className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleConfirmEdit}
            maxLength={MAX_TASK_NAME_LENGTH}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            onClick={stopPropagation}
          />
        ) : (
          <>
            {isPinned && <Pin className="h-3 w-3 flex-shrink-0 text-muted-foreground" />}
            <span className="block truncate text-xs font-medium text-foreground">{task.name}</span>
            {task.status === 'creating' && (
              <span className='text-xs text-muted-foreground animate-pulse ml-1'>
                Creating...
              </span>
            )}
          </>
        )}
        {showDirectBadge && task.useWorktree === false && (
          <span
            className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="Running directly on branch (no worktree isolation)"
          >
            <AlertCircle className="h-2.5 w-2.5" />
            Direct
          </span>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {showDelete && onDelete ? (
          <TaskDeleteButton
            taskName={task.name}
            taskId={task.id}
            taskPath={task.path}
            useWorktree={task.useWorktree}
            onConfirm={async () => {
              try {
                setIsDeleting(true);
                await onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
            isDeleting={isDeleting}
            aria-label={`Delete Task ${task.name}`}
            className={`text-muted-foreground ${
              isDeleting ? '' : 'opacity-0 group-hover/task:opacity-100'
            }`}
          />
        ) : null}
        <div aria-hidden={isLoading ? 'true' : 'false'}>
          {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
            <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
          ) : pr ? (
            <PrPreviewTooltip pr={pr} side="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (pr.url) window.electronAPI.openExternal(pr.url);
                }}
                className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={`${pr.title || 'Pull Request'} (#${pr.number})`}
              >
                {pr.isDraft
                  ? 'Draft'
                  : String(pr.state).toUpperCase() === 'OPEN'
                    ? 'View PR'
                    : `PR ${String(pr.state).charAt(0).toUpperCase() + String(pr.state).slice(1).toLowerCase()}`}
                <ArrowUpRight className="size-3" />
              </button>
            </PrPreviewTooltip>
          ) : null}
        </div>
      </div>
    </div>
  );

  // Wrap with context menu if rename, archive, or pin is available
  if (onRename || onArchive || onPin) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{taskContent}</ContextMenuTrigger>
        <ContextMenuContent>
          {onPin && (
            <ContextMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onPin();
              }}
            >
              {isPinned ? (
                <>
                  <PinOff className="mr-2 h-3.5 w-3.5" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-3.5 w-3.5" />
                  Pin
                </>
              )}
            </ContextMenuItem>
          )}
          {onRename && (
            <ContextMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleStartEdit();
              }}
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Rename
            </ContextMenuItem>
          )}
          {onArchive && (
            <ContextMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
            >
              <Archive className="mr-2 h-3.5 w-3.5" />
              Archive
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return taskContent;
};
