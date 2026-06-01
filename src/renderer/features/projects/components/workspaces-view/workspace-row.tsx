import { MoreHorizontal, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import type { RepoInstance } from '@shared/projects';
import type { WorktreeEntry } from '@shared/workspaces';
import {
  PickerHostRow,
  PickerRepoRowContent,
  PickerWorktreeRowContent,
  PickerRow,
} from '@renderer/features/tasks/create-task-modal/workspace-picker/workspace-picker-rows';
import type {
  PickerHostItem,
  PickerRepoItem,
  PickerWorktreeItem,
} from '@renderer/features/tasks/create-task-modal/workspace-picker/workspace-picker-items';

export const HOST_ROW_HEIGHT = 24;
export const INSTANCE_ROW_HEIGHT = 56;

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
    }
  | {
      type: 'instance-header';
      instance: RepoInstance;
      isPrimary: boolean;
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

// ---------------------------------------------------------------------------
// HostRow
// ---------------------------------------------------------------------------

const HostRow = observer(function HostRow({
  item,
}: {
  item: Extract<FlatItem, { type: 'host' }>;
}) {
  const hostPickerItem: PickerHostItem = {
    type: 'host',
    hostKey: item.hostKey,
    label: item.label,
    username: item.username,
    connectionId: item.connectionId,
    kind: item.kind,
  };
  return <PickerHostRow item={hostPickerItem} />;
});

// ---------------------------------------------------------------------------
// RepositoryRow
// ---------------------------------------------------------------------------

const RepositoryRow = observer(function RepositoryRow({
  item,
  onRemove,
}: {
  item: Extract<FlatItem, { type: 'instance-header' }>;
  onRemove?: () => void;
}) {
  const repoPickerItem: PickerRepoItem = {
    type: 'repo',
    instance: item.instance,
    mainEntry: item.mainEntry,
    taskCount: item.taskCount,
    isPrimary: item.isPrimary,
  };

  return (
    <div className="group relative">
      <PickerRow depth={1} isSelected={false} isSelectable={false}>
        <PickerRepoRowContent item={repoPickerItem} />
      </PickerRow>
      {onRemove && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="absolute right-2 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-background-2 group-hover:opacity-100"
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

// ---------------------------------------------------------------------------
// WorktreeRow
// ---------------------------------------------------------------------------

function WorktreeRow({
  item,
  onRemove,
}: {
  item: Extract<FlatItem, { type: 'worktree' }>;
  onRemove?: () => void;
}) {
  const worktreePickerItem: PickerWorktreeItem = {
    type: 'worktree',
    entry: item.entry,
    instanceId: item.instanceId,
    taskCount: item.taskCount,
  };

  return (
    <div className="group relative">
      <PickerRow depth={2} isSelected={false} isSelectable={false}>
        <PickerWorktreeRowContent item={worktreePickerItem} />
      </PickerRow>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute right-2 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-background-2 group-hover:opacity-100"
          aria-label="Worktree options"
        >
          <MoreHorizontal absoluteStrokeWidth strokeWidth={2} className="size-4 text-foreground-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="min-w-48">
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <Trash2 />
            Remove worktree
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceRow
// ---------------------------------------------------------------------------

export function WorkspaceRow({
  item,
  onRemove,
}: {
  item: FlatItem;
  onRemove?: () => void;
}) {
  if (item.type === 'host') {
    return <HostRow item={item} />;
  }
  if (item.type === 'instance-header') {
    return <RepositoryRow item={item} onRemove={onRemove} />;
  }
  return <WorktreeRow item={item} onRemove={onRemove} />;
}
