import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUpRight, AlertCircle, Pencil, Pin, PinOff, Archive } from 'lucide-react';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { ChangesBadge } from './TaskChanges';

import { Spinner } from './ui/spinner';
import { usePrStatus } from '../hooks/usePrStatus';
import { useTaskBusy } from '../hooks/useTaskBusy';
import { useTaskIdleSince } from '../hooks/useTaskIdleSince';

import PrPreviewTooltip from './PrPreviewTooltip';
import { normalizeTaskName, MAX_TASK_NAME_LENGTH } from '../lib/taskNames';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

function stopPropagation(e: React.MouseEvent): void {
  e.stopPropagation();
}

function formatCompactDate(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return '';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

function formatTimeSince(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return '';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

interface Task {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string;
  useWorktree?: boolean;
  updatedAt?: string;
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
  onDelete: _onDelete,
  onRename,
  onArchive,
  onPin,
  isPinned,
  showDelete: _showDelete,
  showDirectBadge = true,
}) => {
  const { totalAdditions, totalDeletions, isLoading } = useTaskChanges(task.path, task.id);
  const { pr } = usePrStatus(task.path);
  const isRunning = useTaskBusy(task.id);
  const idleSince = useTaskIdleSince(task.id, isRunning);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.name);

  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const blurGuardRef = useRef(false);
  const blurGuardTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleStartEdit = useCallback(() => {
    if (!onRename) return;
    setEditValue(task.name);
    isSubmittingRef.current = false;
    blurGuardRef.current = true;
    setIsEditing(true);
    // Keep blur guard active long enough for Radix context menu close
    // animation (~150ms) and focus restoration to complete
    clearTimeout(blurGuardTimerRef.current);
    blurGuardTimerRef.current = setTimeout(() => {
      blurGuardRef.current = false;
    }, 300);
  }, [onRename, task.name]);

  const handleCancelEdit = useCallback(() => {
    blurGuardRef.current = false;
    clearTimeout(blurGuardTimerRef.current);
    setIsEditing(false);
    setEditValue(task.name);
  }, [task.name]);

  const handleConfirmEdit = useCallback(async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    blurGuardRef.current = false;
    clearTimeout(blurGuardTimerRef.current);

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
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  const hasChanges = !isLoading && (totalAdditions > 0 || totalDeletions > 0);
  const compact = formatCompactDate(task.updatedAt);

  // Right side: PR badge only, OR changes + date, OR just date
  const rightBadge = pr ? (
    <PrPreviewTooltip pr={pr} side="top">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (pr.url) window.electronAPI.openExternal(pr.url);
        }}
        className="inline-flex items-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title={`${pr.title || 'Pull Request'} (#${pr.number})`}
      >
        {pr.isDraft
          ? 'Draft'
          : String(pr.state).toUpperCase() === 'OPEN'
            ? 'View PR'
            : `PR ${String(pr.state).charAt(0).toUpperCase() + String(pr.state).slice(1).toLowerCase()}`}
      </button>
    </PrPreviewTooltip>
  ) : (
    <div className="flex items-center gap-1.5">
      {hasChanges && (
        <ChangesBadge additions={totalAdditions} deletions={totalDeletions} className="text-xs" />
      )}
      {compact && <span className="text-xs font-medium text-muted-foreground">{compact}</span>}
    </div>
  );

  const taskContent = (
    <div className="flex min-w-0 items-center gap-1.5">
      {/* Left icon slot — same width as the project folder icon */}
      <div className="flex w-5 flex-shrink-0 items-center justify-center">
        {onArchive && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 outline-none hover:bg-black/5 focus-visible:outline-none group-hover/task:opacity-100 dark:hover:bg-white/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchive();
                  }}
                  aria-label="Archive task"
                >
                  <Archive className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={4}>
                Archive
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {(isRunning || task.status === 'running') && (
          <Spinner size="sm" className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (blurGuardRef.current) {
                // Re-focus: blur was caused by context menu close/focus restoration
                requestAnimationFrame(() => {
                  inputRef.current?.focus();
                });
                return;
              }
              handleConfirmEdit();
            }}
            maxLength={MAX_TASK_NAME_LENGTH}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-sm font-medium text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            onClick={stopPropagation}
            onMouseDown={stopPropagation}
          />
        ) : (
          <>
            {isPinned && (
              <Pin
                className="h-3 w-3 flex-shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onPin?.();
                }}
              />
            )}
            <span className="block truncate text-sm font-medium text-foreground">{task.name}</span>
            {idleSince !== null && (
              <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                ({formatTimeSince(idleSince)})
              </span>
            )}
          </>
        )}
        {showDirectBadge && task.useWorktree === false && (
          <span
            className="inline-flex items-center gap-0.5 rounded bg-muted px-0.5 py-0.5 text-xs font-medium text-muted-foreground"
            title="Running directly on branch (no worktree isolation)"
          >
            <AlertCircle className="h-2.5 w-2.5" />
            Direct
          </span>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center">{rightBadge}</div>
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
