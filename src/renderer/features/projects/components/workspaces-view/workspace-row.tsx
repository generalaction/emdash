import {
  ChevronRight,
  FolderGit2,
  GitBranch,
  Laptop,
  MoreHorizontal,
  Server,
  Trash2,
  TreePine,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { appState } from '@renderer/lib/stores/app-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import type { RepoInstance } from '@shared/projects';
import type { ConnectionState } from '@shared/ssh';
import type { WorktreeEntry } from '@shared/workspaces';

export const HOST_ROW_HEIGHT = 40;
export const INSTANCE_ROW_HEIGHT = 40;

export type FlatItem =
  | {
      type: 'host';
      hostKey: string;
      label: string;
      /** For local hosts: machine name displayed before the "This machine" pill. */
      username?: string;
      /** For SSH hosts: the connection ID used to look up live state. */
      connectionId?: string;
      kind: 'local' | 'ssh';
      isExpanded: boolean;
    }
  | {
      type: 'instance-header';
      instance: RepoInstance;
      isPrimary: boolean;
      isExpanded: boolean;
      worktreeCount: number;
      taskCount: number;
      mainEntry?: WorktreeEntry;
      projectId: string;
      depth?: number;
    }
  | {
      type: 'worktree';
      entry: WorktreeEntry;
      instanceId: string;
      taskCount: number;
      repoName: string;
      hasUncommittedChanges: boolean;
      projectId: string;
    };

export function splitWorkspacePath(absPath: string): string[] {
  return absPath.split('/').filter(Boolean);
}

function BranchLabel({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <GitBranch
        absoluteStrokeWidth
        strokeWidth={2}
        className="size-3 shrink-0 text-foreground-muted"
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

function connectionStatePill(state: ConnectionState) {
  const styles: Record<ConnectionState, string> = {
    connected: 'border-border-success text-foreground-success bg-background-success',
    connecting: 'border-border-info text-foreground-info bg-background-info',
    reconnecting: 'border-border-warning text-foreground-warning bg-background-warning',
    disconnected: 'border-border text-foreground-passive',
    error: 'border-border-destructive text-foreground-destructive bg-background-destructive',
  };
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-xs', styles[state])}>
      {state}
    </span>
  );
}

const HostRow = observer(function HostRow({
  item,
  onToggle,
}: {
  item: Extract<FlatItem, { type: 'host' }>;
  onToggle: () => void;
}) {
  const connState =
    item.kind === 'ssh' && item.connectionId
      ? appState.sshConnections.stateFor(item.connectionId)
      : null;

  return (
    <div className="group flex h-10 w-full items-center gap-2 rounded-lg px-2 bg-background-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={item.isExpanded}
        aria-label={item.isExpanded ? 'Collapse' : 'Expand'}
        className="relative flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background-2"
      >
        {item.kind === 'ssh' ? (
          <Server
            absoluteStrokeWidth
            strokeWidth={1.5}
            className="absolute size-4 text-foreground-passive opacity-100 transition-opacity duration-150 group-hover:opacity-0"
          />
        ) : (
          <Laptop
            absoluteStrokeWidth
            strokeWidth={1.5}
            className="absolute size-4 text-foreground-passive opacity-100 transition-opacity duration-150 group-hover:opacity-0"
          />
        )}
        <ChevronRight
          absoluteStrokeWidth
          strokeWidth={2}
          className={cn(
            'absolute size-4 text-foreground-muted opacity-0 transition-all duration-150 group-hover:opacity-100',
            item.isExpanded && 'rotate-90'
          )}
        />
      </button>

      {item.kind === 'local' ? (
        <div className="flex items-center gap-2">
          {item.username && (
            <span className="text-sm text-foreground-muted">{item.username}</span>
          )}
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground-passive">
            {item.label}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground-muted">{item.label}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground-passive">
            ssh
          </span>
          {connState && connectionStatePill(connState)}
        </div>
      )}
    </div>
  );
});

const RepositoryRow = observer(function RepositoryRow({
  item,
  onToggle,
  onRemove,
}: {
  item: Extract<FlatItem, { type: 'instance-header' }>;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const displayPath = item.mainEntry
    ? splitWorkspacePath(item.mainEntry.path)
    : item.instance.path
      ? splitWorkspacePath(item.instance.path)
      : [];

  const name =
    item.instance.label ??
    displayPath[displayPath.length - 1] ??
    (item.instance.kind === 'byoi' ? 'Sandbox' : item.instance.kind);

  const branch = item.mainEntry?.branch ?? null;
  const fullPath = item.instance.path ?? item.mainEntry?.path ?? '';

  return (
    <div
      className={cn(
        'group relative flex h-10 w-full items-center gap-2 rounded-lg px-2 transition-colors hover:bg-background-1'
      )}
    >
      {/* Expand/collapse button — icon fades to chevron on hover */}
      {item.instance.kind !== 'byoi' ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={item.isExpanded}
          aria-label={item.isExpanded ? 'Collapse' : 'Expand'}
          className="relative flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background-2"
        >
          <FolderGit2
            absoluteStrokeWidth
            strokeWidth={1.5}
            className="absolute size-4 text-foreground-passive opacity-100 transition-opacity duration-150 group-hover:opacity-0"
          />
          <ChevronRight
            absoluteStrokeWidth
            strokeWidth={2}
            className={cn(
              'absolute size-4 text-foreground-passive opacity-0 transition-all duration-150 group-hover:opacity-100',
              item.isExpanded && 'rotate-90'
            )}
          />
        </button>
      ) : (
        <div className="flex size-7 shrink-0 items-center justify-center">
          <FolderGit2
            absoluteStrokeWidth
            strokeWidth={1.5}
            className="size-4 text-foreground-muted"
          />
        </div>
      )}

      {/* Label + tags */}
      <span className="max-w-40 truncate text-sm text-foreground-muted group-hover:text-foreground" title={name}>{name}</span>
      {/* {item.instance.isFork && <GitFork className="size-3 shrink-0 text-foreground-muted" />}
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-foreground-passive">
        Repository
      </span> */}
      {item.taskCount > 0 && (
        <span className="shrink-0 rounded-full border border-border-info px-2 py-0.5 text-xs text-foreground-info">
          used by {item.taskCount} {item.taskCount === 1 ? 'task' : 'tasks'}
        </span>
      )}

      {/* Spacer */}
      <div className="min-w-0 flex-1" />

      {/* Right side: full path + branch tag */}
      {fullPath && (
        <span
          className="max-w-48 truncate text-xs text-foreground-passive"
          title={fullPath}
          dir="rtl"
        >
          {fullPath}
        </span>
      )}
      {branch && (
        <BranchLabel
          text={branch}
          className="shrink-0 text-xs text-foreground-muted"
        />
      )}

      {/* Three-dots menu — absolutely positioned, visible on hover */}
      {onRemove && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="absolute right-2 flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-background-2 group-hover:opacity-100"
            aria-label="Repository options"
          >
            <MoreHorizontal absoluteStrokeWidth strokeWidth={2} className="size-4 text-foreground-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 />
              Remove repository
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});

function WorktreeRow({
  item,
  onRemove,
}: {
  item: Extract<FlatItem, { type: 'worktree' }>;
  onRemove?: () => void;
}) {
  const displayPath = splitWorkspacePath(item.entry.path);
  const name = displayPath[displayPath.length - 1] ?? item.entry.path;

  return (
    <div className="group relative flex h-10 w-full items-center rounded-lg px-2 hover:bg-background-1 transition-colors">
      <div className="min-w-7 h-full flex items-center justify-center">
        <div className="w-px h-full bg-background-2" />
      </div>
      <div className="flex size-7 shrink-0 items-center justify-center">
        <TreePine
          absoluteStrokeWidth
          strokeWidth={1.5}
          className="size-4 text-foreground-passive"
        />
      </div>
      <span className="max-w-40 truncate text-sm text-foreground-muted group-hover:text-foreground" title={name}>{name}</span>
      {/* <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-foreground-passive">
        worktree
      </span> */}
      {item.taskCount > 0 && (
        <span className="shrink-0 rounded-full border border-border-info px-2 py-0.5 text-xs text-foreground-info">
          used by {item.taskCount} {item.taskCount === 1 ? 'task' : 'tasks'}
        </span>
      )}


      <div className="min-w-0 flex-1" />
      <span
        className="max-w-48 truncate text-xs text-foreground-passive"
        title={item.entry.path}
        dir="rtl"
      >
        {item.entry.path}
      </span>
      {item.entry.branch && (
        <BranchLabel
          text={item.entry.branch}
          className="shrink-0 text-xs text-foreground-muted"
        />
      )}

      {/* Three-dots menu — absolutely positioned, visible on hover */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute right-2 flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-background-2 group-hover:opacity-100 bg-background-1"
          aria-label="Worktree options"
        >
          <MoreHorizontal absoluteStrokeWidth strokeWidth={2} className="size-4 text-foreground-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="min-w-48">
          <DropdownMenuItem variant="destructive"  onClick={onRemove}>
            <Trash2 />
            Remove worktree
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function WorkspaceRow({
  item,
  onToggle,
  onRemove,
}: {
  item: FlatItem;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  if (item.type === 'host') {
    return <HostRow item={item} onToggle={onToggle} />;
  }
  if (item.type === 'instance-header') {
    return <RepositoryRow item={item} onToggle={onToggle} onRemove={onRemove} />;
  }
  return <WorktreeRow item={item} onRemove={onRemove} />;
}
