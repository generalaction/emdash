import { FolderGit2, GitBranch, Laptop, Link, Server, TreePine } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type ReactNode } from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import type { ConnectionState } from '@shared/ssh';
import type { PickerHostItem, PickerRepoItem, PickerWorktreeItem } from './workspace-picker-items';
import { repoInstanceName } from './workspace-picker-items';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TypeTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full text-xs text-foreground-passive/50 uppercase tracking-wider">
      {label}
    </span>
  );
}

export function TaskCountBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Tooltip>
      <TooltipTrigger>

    <span className="flex shrink-0 items-center gap-1 text-xs text-foreground-info font-medium ml-1.5">
      <Link absoluteStrokeWidth className="size-3 shrink-0" />
      {count}
    </span>
      </TooltipTrigger>
      <TooltipContent>
        This workspace has {count} tasks associated with it
      </TooltipContent>
    </Tooltip>
  );
}

function PathLine({ path, branch }: { path: string; branch: string | null | undefined }) {
  return (
    <div className="flex min-w-0 items-center w-full gap-2">
      <span
        className="min-w-0 text-xs text-foreground-passive flex items-center gap-1 truncate whitespace-nowrap"
        title={path}
      >
        {path}
      </span>
        <span className="size-0.5 shrink-0 rounded-full bg-border" />
      {branch && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-foreground-passive relative">
          <GitBranch absoluteStrokeWidth strokeWidth={2} className="size-3 shrink-0" />
          <span className="max-w-52 min-w-10 truncate whitespace-nowrap">{branch}</span>
        </span>
      )}
    </div>
  );
}

function connectionStateDot(state: ConnectionState) {
  const styles: Record<ConnectionState, string> = {
    connected: 'bg-foreground-success',
    connecting: 'bg-foreground-info',
    reconnecting: 'bg-foreground-warning',
    disconnected: 'bg-foreground-passive',
    error: 'bg-foreground-destructive',
  };
  return <span className={cn('size-2 shrink-0 rounded-full', styles[state])} />;
}

// ---------------------------------------------------------------------------
// PickerHostRow
// ---------------------------------------------------------------------------

export const PickerHostRow = observer(function PickerHostRow({
  item,
}: {
  item: PickerHostItem;
}) {
  const connState =
    item.kind === 'ssh' && item.connectionId
      ? appState.sshConnections.stateFor(item.connectionId)
      : null;

  return (
    <div className="flex h-6 items-center gap-2 px-2.5 bg-background-2">
      {item.kind === 'local' ? (
        <Laptop absoluteStrokeWidth strokeWidth={1.5} className="size-3 shrink-0 text-foreground-muted" />
      ) : (
        <Server absoluteStrokeWidth strokeWidth={1.5} className="size-3 shrink-0 text-foreground-muted" />
      )}
      <div className="flex items-center gap-1.5 justify-between w-full">

      {item.kind === 'local' ? (
        <>
          {item.username && (
            <span className="text-xs text-foreground-muted">{item.username}</span>
          )}
          <TypeTag label={item.label} />
        </>
      ) : (
        <>
        <span className="flex items-center gap-2">
          <span className="text-xs text-foreground-muted">{item.label}</span>
          {connState && connectionStateDot(connState)}
        </span>
          <TypeTag label="remote machine" />
        </>
      )}
      </div>

    </div>
  );
});

// ---------------------------------------------------------------------------
// PickerRepoRowContent — exported for reuse in picker triggers
// ---------------------------------------------------------------------------

export function PickerRepoRowContent({ item, className }: { item: PickerRepoItem, className?: string }) {
  const name = repoInstanceName(item.instance, item.mainEntry);
  const path = item.mainEntry?.path ?? item.instance.path ?? '';
  const branch = item.mainEntry?.branch;

  return (
    <div className={cn('flex flex-col h-14 gap-0.5 justify-center w-full', className)}>
      <div className="flex items-center gap-1.5">
        <FolderGit2
          absoluteStrokeWidth
          strokeWidth={1.5}
          className="size-3.5 shrink-0 text-foreground-muted"
        />
        <span className="max-w-40 truncate text-sm text-foreground" title={name}>
          {name}
        </span>
        <div className="min-w-0 flex-1" />
        <TaskCountBadge count={item.taskCount} />
        <TypeTag label="Repository" />
      </div>
      {path && (
        <div className="w-full">
          <PathLine path={path} branch={branch} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PickerRow — generic wrapper (replaces PickerRepoRow / PickerWorktreeRow)
// ---------------------------------------------------------------------------

export function PickerRow({
  depth,
  isSelected,
  isSelectable,
  onClick,
  children,
}: {
  /** 0 = host (sticky header), 1 = repo, 2 = worktree */
  depth: 0 | 1 | 2;
  isSelected: boolean;
  isSelectable: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative w-full',
        depth === 0 && 'bg-background-2',
        depth === 1 && 'px-3',
        depth === 2 && 'pl-8 pr-3',
        isSelectable && 'cursor-pointer',
        isSelectable && !isSelected && 'hover:bg-background-2',
        isSelectable && isSelected && 'bg-background-2'
      )}
      role={isSelectable ? 'option' : undefined}
      aria-selected={isSelectable ? isSelected : undefined}
      onClick={isSelectable ? onClick : undefined}
    >
      {depth >= 2 && (
        <div className="absolute left-4 inset-y-0 w-px bg-border " />
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PickerWorktreeRowContent — exported for reuse in picker triggers
// ---------------------------------------------------------------------------

export function PickerWorktreeRowContent({ item, className }: { item: PickerWorktreeItem, className?: string }) {
  const displayPath = item.entry.path.split('/').filter(Boolean);
  const name = displayPath[displayPath.length - 1] ?? item.entry.path;

  return (
    <div className={cn('flex flex-col gap-0.5 h-14 justify-center', className)}>
      <div className="flex items-center gap-1.5">
        <TreePine
          absoluteStrokeWidth
          strokeWidth={1.5}
          className="size-3.5 shrink-0 text-foreground-muted"
        />
        <span className="min-w-0truncate text-sm text-foreground" title={name}>
          {name}
        </span>
        <TaskCountBadge count={item.taskCount} />
        <div className="min-w-0 flex-1" />
        <TypeTag label="Worktree" />
      </div>
      {/* Line 2 */}
      <div >
        <PathLine path={item.entry.path} branch={item.entry.branch} />
      </div>
    </div>
  );
}

